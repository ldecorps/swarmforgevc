const assert = require('node:assert/strict');
const { createMetricsTickGate } = require('../out/metrics/metricsTickGate');

// BL-1066: the panel drove a ~102-second git walk from a 2-second
// setInterval. Two separate things had to become true: a tick must not start
// a computation while one is still running, and a tick must not start one at
// all until the previous result has aged past its own (far slower) refresh
// interval. This gate owns both decisions so the panel's tick body stays a
// call, and so the decisions are testable without booting VS Code.

function fakeClock(startMs = 1_000_000) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

test('the first run computes, reports "ran", and publishes the value as latest', () => {
  const clock = fakeClock();
  const gate = createMetricsTickGate({ minIntervalMs: 300_000, now: clock.now });

  assert.equal(gate.latest(), null);
  assert.equal(gate.run(() => 'first'), 'ran');
  assert.equal(gate.latest(), 'first');
});

test('the first run computes even when the clock starts at zero (below the refresh interval)', () => {
  // `lastCompletedAtMs` starts null; `null` coerces to 0 in subtraction, so
  // if the guard read only `options.now() - lastCompletedAtMs < minIntervalMs`
  // (dropping the explicit `!== null` check), a caller whose `now()` starts
  // near zero - rather than a real Date.now() epoch, always far larger than
  // any sane refresh interval - would read the pre-first-run state as
  // already fresh and wrongly throttle the very first computation.
  let nowMs = 0;
  const gate = createMetricsTickGate({ minIntervalMs: 300_000, now: () => nowMs });

  assert.equal(gate.run(() => 'first'), 'ran');
  assert.equal(gate.latest(), 'first');
});

test('a tick inside the refresh interval is throttled and never calls compute', () => {
  const clock = fakeClock();
  const gate = createMetricsTickGate({ minIntervalMs: 300_000, now: clock.now });
  let computeCalls = 0;
  const compute = () => {
    computeCalls += 1;
    return computeCalls;
  };

  gate.run(compute);
  clock.advance(2000);
  assert.equal(gate.run(compute), 'throttled');
  clock.advance(297_999);
  assert.equal(gate.run(compute), 'throttled');

  assert.equal(computeCalls, 1);
  assert.equal(gate.latest(), 1);
});

test('a tick at exactly the refresh interval recomputes and republishes', () => {
  const clock = fakeClock();
  const gate = createMetricsTickGate({ minIntervalMs: 300_000, now: clock.now });
  let computeCalls = 0;
  const compute = () => {
    computeCalls += 1;
    return computeCalls;
  };

  gate.run(compute);
  clock.advance(300_000);

  assert.equal(gate.run(compute), 'ran');
  assert.equal(computeCalls, 2);
  assert.equal(gate.latest(), 2);
});

test('a tick arriving while a computation is in flight is refused, not stacked', () => {
  const clock = fakeClock();
  const gate = createMetricsTickGate({ minIntervalMs: 300_000, now: clock.now });
  const outcomes = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  let computeCalls = 0;

  const compute = () => {
    computeCalls += 1;
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    // The tick that arrives mid-computation. In a synchronous computation
    // this is the only way a tick can reach the gate at all, and it is
    // exactly the re-entrancy the panel's own callback chain can produce.
    if (computeCalls === 1) {
      outcomes.push(gate.run(compute));
    }
    concurrent -= 1;
    return 'value';
  };

  assert.equal(gate.run(compute), 'ran');
  assert.deepEqual(outcomes, ['in-flight']);
  assert.equal(computeCalls, 1);
  assert.equal(maxConcurrent, 1);
});

test('isInFlight is true only for the duration of the computation', () => {
  const clock = fakeClock();
  const gate = createMetricsTickGate({ minIntervalMs: 300_000, now: clock.now });
  let seenDuring = null;

  assert.equal(gate.isInFlight(), false);
  gate.run(() => {
    seenDuring = gate.isInFlight();
    return 'v';
  });

  assert.equal(seenDuring, true);
  assert.equal(gate.isInFlight(), false);
});

test('a computation that throws clears in-flight, opens its own refresh window, and leaves the last good value standing', () => {
  const clock = fakeClock();
  const gate = createMetricsTickGate({ minIntervalMs: 300_000, now: clock.now });

  gate.run(() => 'good');
  clock.advance(300_000);

  assert.throws(
    () =>
      gate.run(() => {
        throw new Error('git exploded');
      }),
    /git exploded/
  );

  assert.equal(gate.isInFlight(), false);
  assert.equal(gate.latest(), 'good');
  // A failing computation must NOT become a retry-every-tick loop - that is
  // the storm this ticket exists to stop, just with a failing git.
  clock.advance(2000);
  assert.equal(gate.run(() => 'never'), 'throttled');
});

test('changing the subject recomputes immediately rather than serving the previous subject stale', () => {
  const clock = fakeClock();
  const gate = createMetricsTickGate({ minIntervalMs: 300_000, now: clock.now });

  assert.equal(gate.run(() => 'value for A', '/repo/a'), 'ran');
  clock.advance(2000);
  assert.equal(gate.run(() => 'value for A again', '/repo/a'), 'throttled');

  // The panel can be re-pointed at another target mid-interval; the previous
  // target's value must never stand in for the new one.
  assert.equal(gate.run(() => 'value for B', '/repo/b'), 'ran');
  assert.equal(gate.latest(), 'value for B');

  clock.advance(2000);
  assert.equal(gate.run(() => 'value for B again', '/repo/b'), 'throttled');
  assert.equal(gate.latest(), 'value for B');
});

test('a computation that throws while switching subjects does not relabel the old subject stale value as the new subject', () => {
  const clock = fakeClock();
  const gate = createMetricsTickGate({ minIntervalMs: 300_000, now: clock.now });

  assert.equal(gate.run(() => 'value for A', '/repo/a'), 'ran');

  clock.advance(1000);
  assert.throws(
    () =>
      gate.run(() => {
        throw new Error('git exploded on repo b');
      }, '/repo/b'),
    /git exploded on repo b/
  );

  // The failed attempt at B must not make a later B tick believe it already
  // has a fresh B answer standing - it must retry, not throttle onto A's value.
  clock.advance(1000);
  assert.equal(gate.run(() => 'value for B', '/repo/b'), 'ran');
  assert.equal(gate.latest(), 'value for B');
});

test('an in-flight computation still refuses a tick that names a different subject', () => {
  const clock = fakeClock();
  const gate = createMetricsTickGate({ minIntervalMs: 300_000, now: clock.now });
  let nestedOutcome = null;

  gate.run(() => {
    nestedOutcome = gate.run(() => 'other', '/repo/b');
    return 'first';
  }, '/repo/a');

  assert.equal(nestedOutcome, 'in-flight');
});
