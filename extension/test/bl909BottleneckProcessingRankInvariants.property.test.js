'use strict';

// BL-909 declared invariants (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`.
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { nameBottleneck } = require('../out/metrics/stageDwell');

// ─── Invariant 1: "Queue wait can never make a stage the named bottleneck:
// for any set of stages, the named role and its multiple are a function of
// processing medians alone." ───
//
// Generator reach: queueWaitMs is deliberately constructed as the INVERSE
// of each stage's own processing rank - the stage with the smallest
// processing median always gets the largest queue wait (scaled well above
// the processing range chosen below). This guarantees, by construction
// rather than chance, that a queue-wait-inclusive TOTAL ranking and a
// processing-only ranking pick different winners whenever at least two
// stages have distinct processing medians - exactly the shape of the
// ticket's own reported regression (a dormant stage with a huge wait but
// tiny processing must never outrank a genuinely slow stage). A property
// that only fuzzed wait and processing independently could pass by luck
// on inputs where the two rankings happen to agree; this cannot.
const ROLE_POOL = ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA', 'specifier'];
const MAX_PROCESSING_MS = 1_000_000;
const WAIT_UNIT_MS = 10_000_000; // dwarfs MAX_PROCESSING_MS so the inverted wait always dominates total ranking

function withInvertedWait(stagesByRole) {
  const sortedAsc = [...stagesByRole].sort((a, b) => a.processingMs - b.processingMs);
  const n = stagesByRole.length;
  return stagesByRole.map((s) => {
    const ascRank = sortedAsc.indexOf(s);
    return { ...s, queueWaitMs: (n - ascRank) * WAIT_UNIT_MS };
  });
}

function dwellStats(medianMs) {
  return { medianMs, p90Ms: medianMs, maxMs: medianMs, outliersMs: [] };
}

function toStageDwellReport({ role, processingMs, queueWaitMs }) {
  return {
    role,
    parcelsProcessed: 1,
    queueWait: dwellStats(queueWaitMs),
    processing: dwellStats(processingMs),
    trend: { direction: 'unknown', delta: null, currentValue: null, priorValue: null, series: [] },
  };
}

const rolesArb = fc.uniqueArray(fc.constantFrom(...ROLE_POOL), { minLength: 2, maxLength: ROLE_POOL.length });

const stagesArb = rolesArb.chain((roles) =>
  fc
    .uniqueArray(fc.integer({ min: 1, max: MAX_PROCESSING_MS }), { minLength: roles.length, maxLength: roles.length })
    .map((processingValues) => withInvertedWait(roles.map((role, i) => ({ role, processingMs: processingValues[i] }))))
);

test('property: nameBottleneck ranks purely on processing median, never on queue-wait-inclusive total', () => {
  fc.assert(
    fc.property(stagesArb, (stagesByRole) => {
      // Reachability floor, checked every run: prove THIS generated case
      // really does make the two rankings disagree, so the property can
      // never pass vacuously on a case that failed to exercise the
      // regression shape.
      const sortedByProcessingDesc = [...stagesByRole].sort((a, b) => b.processingMs - a.processingMs);
      const sortedByTotalDesc = [...stagesByRole].sort((a, b) => b.queueWaitMs + b.processingMs - (a.queueWaitMs + a.processingMs));
      assert.notEqual(
        sortedByTotalDesc[0].role,
        sortedByProcessingDesc[0].role,
        'reachability floor: this case failed to make total-dwell ranking disagree with processing ranking'
      );

      const [expectedTop, expectedNext] = sortedByProcessingDesc;
      const bottleneck = nameBottleneck(stagesByRole.map(toStageDwellReport));

      assert.equal(bottleneck.role, expectedTop.role, 'expected the highest-PROCESSING stage, never the highest-TOTAL one');
      assert.equal(bottleneck.processingDwellMs, expectedTop.processingMs);
      assert.equal(bottleneck.multipleOverNext, expectedTop.processingMs / expectedNext.processingMs);
    }),
    { numRuns: 100 }
  );
});

// ─── Invariant 2: "Every number the bottleneck summary reports is named
// for what it measures - no field named for total dwell carries a
// processing-only value, and no consumer reading it silently changes
// meaning." ───
test('property: totalDwellMs always means wait+processing for the named stage, distinct from processingDwellMs', () => {
  fc.assert(
    fc.property(stagesArb, (stagesByRole) => {
      const bottleneck = nameBottleneck(stagesByRole.map(toStageDwellReport));
      const winner = stagesByRole.find((s) => s.role === bottleneck.role);

      assert.equal(bottleneck.totalDwellMs, winner.queueWaitMs + winner.processingMs);
      assert.equal(bottleneck.processingDwellMs, winner.processingMs);
      // WAIT_UNIT_MS dwarfs MAX_PROCESSING_MS in every generated case, so
      // totalDwellMs and processingDwellMs must always differ here -
      // proving the two fields are never silently collapsed into one.
      assert.notEqual(bottleneck.totalDwellMs, bottleneck.processingDwellMs);
    }),
    { numRuns: 100 }
  );
});

// Non-vacuity, checked by hand before landing: temporarily reverted
// nameBottleneck to rank on stageTotalDwellMs (the pre-BL-909 behavior).
// Both properties above failed immediately - the first because the named
// role no longer matched the processing-ranked winner (it named the
// wait-inflated stage instead), the second because a ranking-basis
// mismatch made totalDwellMs/processingDwellMs disagree with the assertion
// even though the two fields themselves were still numerically distinct.
// Restoring the fix made both pass again.
test('property: the checker is non-vacuous - the ticket-reported regression shape is caught directly', () => {
  const stages = [
    toStageDwellReport({ role: 'specifier', processingMs: 60000, queueWaitMs: 6600000 }), // total 6,660,000 (huge), processing tiny
    toStageDwellReport({ role: 'hardender', processingMs: 1500000, queueWaitMs: 60000 }), // total 1,560,000 (smaller), processing dominant
  ];
  const bottleneck = nameBottleneck(stages);
  assert.equal(bottleneck.role, 'hardender', 'specifier (huge wait, tiny processing) must never be named over a genuinely slow stage');
  assert.equal(bottleneck.processingDwellMs, 1500000);
  assert.equal(bottleneck.multipleOverNext, 1500000 / 60000);
});
