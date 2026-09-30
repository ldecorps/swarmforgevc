'use strict';

// BL-1817 (human ruling 2026-09-29, overturning BL-932 invariant 1's
// "never a lane-wide raise"): the property lane's own suite-wide default
// per-test budget now scales with the same contention factor
// propertyLaneTimeoutMs uses - never below its 20000ms base, never above
// the 60000ms cap.

const assert = require('node:assert/strict');
const {
  propertyLaneDefaultTimeoutMs,
  PROPERTY_LANE_DEFAULT_CAP_MS,
} = require('./helpers/propertyLaneContentionBudget');

test('PROPERTY_LANE_DEFAULT_CAP_MS is 60000 (3x the 20000ms base, the recommendation stated)', () => {
  assert.equal(PROPERTY_LANE_DEFAULT_CAP_MS, 60000);
});

test('a quiet host (1 fork, load 1.8) keeps exactly the 20000ms base', () => {
  const ms = propertyLaneDefaultTimeoutMs(20000, { forksFn: () => 1, loadavg1mFn: () => 1.8 });
  assert.equal(ms, 20000);
});

test('a factor of exactly 1 (load 4 at 1 fork) still keeps the base', () => {
  const ms = propertyLaneDefaultTimeoutMs(20000, { forksFn: () => 1, loadavg1mFn: () => 4 });
  assert.equal(ms, 20000);
});

test('a factor of 2 (8 forks at quiet load) doubles the base to 40000ms', () => {
  const ms = propertyLaneDefaultTimeoutMs(20000, { forksFn: () => 8, loadavg1mFn: () => 1.8 });
  assert.equal(ms, 40000);
});

test('a factor at or above 3 clamps to the 60000ms cap, never higher', () => {
  const atExactly3x = propertyLaneDefaultTimeoutMs(20000, { forksFn: () => 12, loadavg1mFn: () => 1.8 });
  const wellOver = propertyLaneDefaultTimeoutMs(20000, { forksFn: () => 40, loadavg1mFn: () => 1.8 });
  assert.equal(atExactly3x, 60000);
  assert.equal(wellOver, 60000);
});

test('a different base still floors at itself and caps at 60000ms', () => {
  const quiet = propertyLaneDefaultTimeoutMs(10000, { forksFn: () => 1, loadavg1mFn: () => 1.8 });
  const busy = propertyLaneDefaultTimeoutMs(10000, { forksFn: () => 40, loadavg1mFn: () => 1.8 });
  assert.equal(quiet, 10000);
  assert.equal(busy, 60000);
});
