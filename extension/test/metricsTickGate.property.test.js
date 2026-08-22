const assert = require('node:assert/strict');
const fc = require('fast-check');
const { createMetricsTickGate } = require('../out/metrics/metricsTickGate');

// BL-1066 invariant 1, as declared on the ticket:
//
//   "A poll tick never re-enters a metrics computation that is still
//    running: a tick arriving while one is in flight is skipped or
//    coalesced, never stacked."
//
// The computation is synchronous, so the only way a tick can reach the gate
// while one is running is from INSIDE that computation's own call stack -
// which is exactly the shape a callback-driven panel produces. The generator
// therefore drives ticks that fire further ticks from within their own
// compute, over generated refresh intervals and generated clock advances,
// and the property is over every one of those interleavings.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const REFRESH_INTERVALS_MS = [0, 1000, 300_000];

// The subject the tick names - the panel's target repo. Varying it matters
// because a changed subject deliberately BYPASSES the refresh throttle, and
// the in-flight refusal must still hold when it does.
const subject = () => fc.constantFrom('/repo/a', '/repo/b', undefined);
const tickOp = () =>
  fc.record({ kind: fc.constant('tick'), nested: fc.integer({ min: 0, max: 3 }), subject: subject() });
const advanceOp = () => fc.record({ kind: fc.constant('advance'), ms: fc.integer({ min: 0, max: 600_000 }) });
const opSequence = () => fc.array(fc.oneof(tickOp(), advanceOp()), { minLength: 1, maxLength: 12 });

// Drives one generated interleaving and reports what the gate actually let
// happen: how deep computations ever nested, how many ran, and what every
// mid-computation tick was told.
function driveGate(ops, minIntervalMs) {
  let nowMs = 0;
  const gate = createMetricsTickGate({ minIntervalMs, now: () => nowMs });
  let depth = 0;
  let maxDepth = 0;
  let computeCalls = 0;
  const midFlightOutcomes = [];
  const midFlightSawInFlight = [];

  function tick(nested, tickSubject) {
    return gate.run(() => {
      computeCalls += 1;
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      for (let i = 0; i < nested; i += 1) {
        midFlightSawInFlight.push(gate.isInFlight());
        // nested: 0 - a refused tick runs no compute, so it can fire none.
        midFlightOutcomes.push(tick(0, tickSubject));
      }
      depth -= 1;
      return computeCalls;
    }, tickSubject);
  }

  for (const op of ops) {
    if (op.kind === 'advance') {
      nowMs += op.ms;
    } else {
      tick(op.nested, op.subject);
    }
  }
  return { maxDepth, computeCalls, midFlightOutcomes, midFlightSawInFlight };
}

test('property: a tick arriving mid-computation is always refused, so computations never stack', () => {
  // The generator must demonstrably REACH the in-flight state, not merely be
  // able to - counted here and asserted as a floor below, never assumed.
  let casesReachingMidFlight = 0;
  const numRuns = 300;

  fc.assert(
    fc.property(opSequence(), fc.constantFrom(...REFRESH_INTERVALS_MS), (ops, minIntervalMs) => {
      const observed = driveGate(ops, minIntervalMs);

      assert.ok(
        observed.maxDepth <= 1,
        `computations stacked ${observed.maxDepth} deep with interval ${minIntervalMs}: ${JSON.stringify(ops)}`
      );
      for (const outcome of observed.midFlightOutcomes) {
        assert.equal(outcome, 'in-flight', `a mid-computation tick was allowed to start: ${outcome}`);
      }
      for (const sawInFlight of observed.midFlightSawInFlight) {
        assert.equal(sawInFlight, true, 'the gate reported idle while a computation was running');
      }
      if (observed.midFlightOutcomes.length > 0) {
        casesReachingMidFlight += 1;
      }
    }),
    { numRuns }
  );

  assert.ok(
    casesReachingMidFlight >= numRuns / 4,
    `the generator reached the in-flight state in only ${casesReachingMidFlight} of ${numRuns} cases - too rare to be evidence`
  );
});

test('property: refused ticks are dropped, never queued - the gate computes at most once per refresh interval', () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 20 }),
      fc.integer({ min: 1, max: 300_000 }),
      (nestedCounts, minIntervalMs) => {
        // Every tick fires inside one refresh interval, with no clock
        // advance at all: exactly one computation may run, and no refused
        // tick may resurface as a later extra computation.
        const observed = driveGate(
          nestedCounts.map((nested) => ({ kind: 'tick', nested, subject: '/repo/a' })),
          minIntervalMs
        );
        assert.equal(observed.computeCalls, 1);
        assert.equal(observed.maxDepth, 1);
      }
    )
  );
});
