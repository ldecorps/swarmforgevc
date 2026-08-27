const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  runBudgetShiftGovernor,
  DEFAULT_BUDGET_GOVERNOR_CONFIG,
} = require('../out/metrics/budgetShiftGovernor');

const inputArb = fc.record({
  remainingPercent: fc.double({ min: 1, max: 99, noNaN: true }),
  daysToReset: fc.double({ min: 0.5, max: 14, noNaN: true }),
  measuredBurnPercentPerDay: fc.double({ min: 0.1, max: 50, noNaN: true }),
  affordableBurnPercentPerDay: fc.double({ min: 0.1, max: 50, noNaN: true }),
});

test('BL-666 every verdict announcement includes arithmetic (never silent)', () => {
  fc.assert(
    fc.property(inputArb, (input) => {
      const result = runBudgetShiftGovernor(DEFAULT_BUDGET_GOVERNOR_CONFIG, input);
      assert.ok(result.announcement.length > 10);
      assert.match(result.announcement, /remaining|opt-in|degraded/i);
    }),
    { numRuns: 50 },
  );
});

test('BL-666 paid credits never spent without explicit opt-in', () => {
  fc.assert(
    fc.property(inputArb, (base) => {
      const result = runBudgetShiftGovernor(DEFAULT_BUDGET_GOVERNOR_CONFIG, {
        ...base,
        spendPaidCredits: true,
        paidCreditsOptIn: false,
      });
      assert.equal(result.refusedPaidCredits, true);
      assert.match(result.announcement, /opt-in/i);
    }),
    { numRuns: 50 },
  );
});
