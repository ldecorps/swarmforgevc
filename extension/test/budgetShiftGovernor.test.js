const assert = require('node:assert/strict');
const {
  runBudgetShiftGovernor,
  DEFAULT_BUDGET_GOVERNOR_CONFIG,
} = require('../out/metrics/budgetShiftGovernor');

test('BL-666 founding fixture 71% at 2.2d with 32 vs 6 burn is not full', () => {
  const result = runBudgetShiftGovernor(DEFAULT_BUDGET_GOVERNOR_CONFIG, {
    remainingPercent: 29,
    daysToReset: 4.8,
    measuredBurnPercentPerDay: 32,
    affordableBurnPercentPerDay: 6,
  });
  assert.notEqual(result.verdict, 'full');
  assert.match(result.announcement, /remaining 29/);
});

test('BL-666 refuses paid credits without opt-in', () => {
  const result = runBudgetShiftGovernor(DEFAULT_BUDGET_GOVERNOR_CONFIG, {
    remainingPercent: 50,
    daysToReset: 5,
    measuredBurnPercentPerDay: 10,
    affordableBurnPercentPerDay: 8,
    spendPaidCredits: true,
    paidCreditsOptIn: false,
  });
  assert.equal(result.refusedPaidCredits, true);
  assert.match(result.announcement, /opt-in/i);
});

test('BL-666 degraded mode marks projection approximate', () => {
  const result = runBudgetShiftGovernor(DEFAULT_BUDGET_GOVERNOR_CONFIG, {
    remainingPercent: 29,
    daysToReset: 4.8,
    measuredBurnPercentPerDay: 32,
    affordableBurnPercentPerDay: 6,
    degradedMode: true,
  });
  assert.equal(result.exactProjection, false);
  assert.match(result.announcement, /degraded mode/);
  assert.match(result.announcement, /projection approximate/);
});

test('BL-666 moderate burn ratio yields SHORT verdict', () => {
  const result = runBudgetShiftGovernor(DEFAULT_BUDGET_GOVERNOR_CONFIG, {
    remainingPercent: 40,
    daysToReset: 5,
    measuredBurnPercentPerDay: 12,
    affordableBurnPercentPerDay: 10,
  });
  assert.equal(result.verdict, 'SHORT');
});

test('BL-666 severe burn ratio yields CHEAP verdict', () => {
  const result = runBudgetShiftGovernor(DEFAULT_BUDGET_GOVERNOR_CONFIG, {
    remainingPercent: 20,
    daysToReset: 3,
    measuredBurnPercentPerDay: 20,
    affordableBurnPercentPerDay: 10,
  });
  assert.equal(result.verdict, 'CHEAP');
  assert.equal(result.cheapMode, true);
});

test('BL-666 zero affordable burn yields SKIP', () => {
  const result = runBudgetShiftGovernor(DEFAULT_BUDGET_GOVERNOR_CONFIG, {
    remainingPercent: 10,
    daysToReset: 2,
    measuredBurnPercentPerDay: 5,
    affordableBurnPercentPerDay: 0,
  });
  assert.equal(result.verdict, 'SKIP');
});

test('BL-666 negative affordable burn yields SKIP not full', () => {
  const result = runBudgetShiftGovernor(DEFAULT_BUDGET_GOVERNOR_CONFIG, {
    remainingPercent: 10,
    daysToReset: 2,
    measuredBurnPercentPerDay: 5,
    affordableBurnPercentPerDay: -1,
  });
  assert.equal(result.verdict, 'SKIP');
});
