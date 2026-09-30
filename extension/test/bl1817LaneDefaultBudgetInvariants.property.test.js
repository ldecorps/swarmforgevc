'use strict';

// BL-1817 declared invariant (coder first authorship - BL-654):
//
// "For every fork count and 1-minute load, the property lane's default
// per-test budget is at least 20000 ms and at most 60000 ms, and it
// equals 20000 ms whenever the contention factor is at most 1."
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  propertyLaneDefaultTimeoutMs,
  propertyLaneContentionFactor,
  PROPERTY_LANE_DEFAULT_CAP_MS,
} = require('./helpers/propertyLaneContentionBudget');

const BASE_MS = 20000;

test('BL-1817/BL-654 invariant: the lane default stays in [20000, 60000] and equals the base at or under a factor of 1', () => {
  let draws = 0;
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 40 }),
      fc.double({ min: 0.1, max: 20, noNaN: true }),
      (forks, load) => {
        draws += 1;
        const opts = { forksFn: () => forks, loadavg1mFn: () => load };
        const ms = propertyLaneDefaultTimeoutMs(BASE_MS, opts);

        assert.ok(ms >= BASE_MS, `expected at least ${BASE_MS}, got ${ms} (forks=${forks}, load=${load})`);
        assert.ok(ms <= PROPERTY_LANE_DEFAULT_CAP_MS, `expected at most ${PROPERTY_LANE_DEFAULT_CAP_MS}, got ${ms}`);

        const factor = propertyLaneContentionFactor(opts);
        if (factor === null || factor <= 1) {
          assert.equal(ms, BASE_MS, `expected the base at factor ${factor} (forks=${forks}, load=${load})`);
        }
      }
    ),
    { numRuns: 60 }
  );
  assert.ok(draws >= 60, `generator reach floor: expected at least 60 runs, got ${draws}`);
});

// Non-vacuity: a deliberately-broken resolver (no cap) would blow past
// 60000ms under heavy contention - proving the assertion above actually
// bites, not just a tautology of the real implementation's own math.
test('BL-1817/BL-654 non-vacuity: an uncapped resolver would exceed the 60000ms ceiling under heavy contention', () => {
  const opts = { forksFn: () => 40, loadavg1mFn: () => 1 };
  const factor = propertyLaneContentionFactor(opts);
  const uncapped = Math.round(BASE_MS * Math.max(1, factor));
  assert.ok(uncapped > PROPERTY_LANE_DEFAULT_CAP_MS, `expected the uncapped math to exceed the ceiling, got ${uncapped}`);
  const capped = propertyLaneDefaultTimeoutMs(BASE_MS, opts);
  assert.equal(capped, PROPERTY_LANE_DEFAULT_CAP_MS);
});
