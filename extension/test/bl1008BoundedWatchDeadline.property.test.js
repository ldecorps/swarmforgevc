'use strict';

// BL-1008 declared invariants.
const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  resolveBoundedWatchDeadlineMs,
  describeWatchWaitTimeout,
  DEFAULT_TIMEOUT_MS,
} = require('./helpers/boundedWatchWait');
const { resolveUnitLaneTimeout, UNIT_LANE_BUDGET_CEILING_MS } = require('../../specs/pipeline/steps/lib/contentionBudget');

test('property (BL-1008 invariant 2): deadline is always strictly below the test effective budget', () => {
  fc.assert(
    fc.property(
      fc.oneof(fc.constant(null), fc.constant('unusable'), fc.double({ min: 0.01, max: 2000, noNaN: true })),
      (factor) => {
        const deadline = resolveBoundedWatchDeadlineMs({ factor });
        const testBudget = resolveUnitLaneTimeout(20000, { factor }).effectiveMs;
        assert.ok(deadline < testBudget);
        assert.ok(deadline <= UNIT_LANE_BUDGET_CEILING_MS);
      }
    ),
    { numRuns: 80 }
  );
});

test('property (BL-1008 invariant 1): timeout message always names event and path', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 40 }), fc.string({ minLength: 1, maxLength: 60 }), fc.integer({ min: 1, max: 60000 }), (label, watchedPath, ms) => {
      const msg = describeWatchWaitTimeout(label, watchedPath, ms);
      assert.ok(msg.includes(label));
      assert.ok(msg.includes(watchedPath));
      assert.ok(msg.includes(`${ms}ms`));
    }),
    { numRuns: 40 }
  );
});

test('BL-1008: quiet factors keep the historical 10000ms base', () => {
  assert.equal(resolveBoundedWatchDeadlineMs({ factor: 0.25 }), DEFAULT_TIMEOUT_MS);
  assert.equal(resolveBoundedWatchDeadlineMs({ factor: 1 }), DEFAULT_TIMEOUT_MS);
  assert.equal(resolveBoundedWatchDeadlineMs({ factor: 'unusable' }), DEFAULT_TIMEOUT_MS);
  assert.equal(resolveBoundedWatchDeadlineMs({ factor: 3 }), 30000);
});
