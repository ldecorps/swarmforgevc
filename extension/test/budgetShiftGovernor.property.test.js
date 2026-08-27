import { describe, expect } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import {
  runBudgetShiftGovernor,
  DEFAULT_BUDGET_GOVERNOR_CONFIG,
  type GovernorRunInput,
} from '../src/metrics/budgetShiftGovernor';

describe('BL-666 invariants', () => {
  test.prop([
    fc.record({
      remainingPercent: fc.double({ min: 1, max: 99, noNaN: true }),
      daysToReset: fc.double({ min: 0.5, max: 14, noNaN: true }),
      measuredBurnPercentPerDay: fc.double({ min: 0.1, max: 50, noNaN: true }),
      affordableBurnPercentPerDay: fc.double({ min: 0.1, max: 50, noNaN: true }),
    }),
  ])('every verdict announcement includes arithmetic (never silent)', (input: GovernorRunInput) => {
    const result = runBudgetShiftGovernor(DEFAULT_BUDGET_GOVERNOR_CONFIG, input);
    expect(result.announcement.length).toBeGreaterThan(10);
    expect(result.announcement).toMatch(/remaining|opt-in|degraded/i);
  });

  test.prop([
    fc.record({
      remainingPercent: fc.double({ min: 1, max: 99, noNaN: true }),
      daysToReset: fc.double({ min: 0.5, max: 14, noNaN: true }),
      measuredBurnPercentPerDay: fc.double({ min: 0.1, max: 50, noNaN: true }),
      affordableBurnPercentPerDay: fc.double({ min: 0.1, max: 50, noNaN: true }),
    }),
  ])('paid credits never spent without explicit opt-in', (base) => {
    const result = runBudgetShiftGovernor(DEFAULT_BUDGET_GOVERNOR_CONFIG, {
      ...base,
      spendPaidCredits: true,
      paidCreditsOptIn: false,
    });
    expect(result.refusedPaidCredits).toBe(true);
    expect(result.announcement).toMatch(/opt-in/i);
  });
});
