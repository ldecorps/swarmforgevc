'use strict';

// BL-1607: the unit lane's shipped-step scan needs the same load/fork-aware
// budget the property lane already has (BL-1579/BL-1588), fed through the
// unit lane's OWN published fork count (SWARMFORGE_UNIT_LANE_FORKS), never a
// copy of the property lane's math - see propertyLaneContentionBudget.js's
// own header for why the core-count-denominated default under-reports
// contention on a 20-core host.

const assert = require('node:assert/strict');
const {
  UNIT_LANE_FORKS_ENV_KEY,
  unitLaneHeavyContentionFactor,
} = require('./helpers/unitLaneContentionBudget');
const { resolveUnitLaneTimeout } = require('../../specs/pipeline/steps/lib/contentionBudget');

test('UNIT_LANE_FORKS_ENV_KEY names the env key vitest.config.mjs publishes', () => {
  assert.equal(UNIT_LANE_FORKS_ENV_KEY, 'SWARMFORGE_UNIT_LANE_FORKS');
});

test('one fork at a quiet load (1.8) resolves a factor under 1 - the scan keeps its 20000ms base', () => {
  const factor = unitLaneHeavyContentionFactor({ forksFn: () => 1, loadavg1mFn: () => 1.8 });
  assert.equal(resolveUnitLaneTimeout(20000, { factor }).effectiveMs, 20000);
});

test('nine forks at the same quiet load resolves exactly 2.25, growing the budget to 45000ms', () => {
  const factor = unitLaneHeavyContentionFactor({ forksFn: () => 9, loadavg1mFn: () => 1.8 });
  assert.equal(factor, 2.25);
  assert.equal(resolveUnitLaneTimeout(20000, { factor }).effectiveMs, 45000);
});

test('a load of 10.8 alone (any fork count under the quiet ceiling) resolves exactly 2.7, growing the budget to 54000ms', () => {
  const atOneFork = unitLaneHeavyContentionFactor({ forksFn: () => 1, loadavg1mFn: () => 10.8 });
  const atNineForks = unitLaneHeavyContentionFactor({ forksFn: () => 9, loadavg1mFn: () => 10.8 });
  assert.equal(atOneFork, 2.7);
  assert.equal(atNineForks, 2.7);
  assert.equal(resolveUnitLaneTimeout(20000, { factor: atOneFork }).effectiveMs, 54000);
  assert.equal(resolveUnitLaneTimeout(20000, { factor: atNineForks }).effectiveMs, 54000);
});

test('forty forks at a quiet load crosses the unit lane\'s own 120000ms ceiling', () => {
  const factor = unitLaneHeavyContentionFactor({ forksFn: () => 40, loadavg1mFn: () => 1.8 });
  assert.equal(resolveUnitLaneTimeout(20000, { factor }).effectiveMs, 120000);
});

test('an unset SWARMFORGE_UNIT_LANE_FORKS key reads as one fork, never a multiplier the lane never measured', () => {
  const original = process.env[UNIT_LANE_FORKS_ENV_KEY];
  delete process.env[UNIT_LANE_FORKS_ENV_KEY];
  try {
    const factor = unitLaneHeavyContentionFactor({ loadavg1mFn: () => 1.8 });
    assert.equal(resolveUnitLaneTimeout(20000, { factor }).effectiveMs, 20000);
  } finally {
    if (original === undefined) {
      delete process.env[UNIT_LANE_FORKS_ENV_KEY];
    } else {
      process.env[UNIT_LANE_FORKS_ENV_KEY] = original;
    }
  }
});
