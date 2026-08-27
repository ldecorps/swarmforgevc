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
