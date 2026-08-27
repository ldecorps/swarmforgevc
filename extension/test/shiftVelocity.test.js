const assert = require('node:assert/strict');
const {
  countLandedInWindow,
  computeDailyShiftVelocitySeries,
  buildShiftVelocityHistoryFromGitEntries,
  EIGHT_HOUR_MS,
} = require('../out/metrics/shiftVelocity');
const {
  nonLinearTimePositions,
  axisIsNonLinearEqualSpacing,
  recentAxisHasFinerPrecision,
} = require('../out/metrics/shiftVelocityChart');

test('countLandedInWindow counts closes inside an eight-hour window', () => {
  const base = Date.parse('2026-01-10T08:00:00Z');
  const closedAtMs = [base + 3600000, base + 7200000, base + 10800000, base + 43200000];
  assert.equal(countLandedInWindow(closedAtMs, base, EIGHT_HOUR_MS), 3);
});

test('computeDailyShiftVelocitySeries reports max rolling eight-hour count per day', () => {
  const closedAtMs = [
    Date.parse('2026-01-11T02:00:00Z'),
    Date.parse('2026-01-11T03:00:00Z'),
    Date.parse('2026-01-11T04:00:00Z'),
    Date.parse('2026-01-11T14:00:00Z'),
  ];
  const series = computeDailyShiftVelocitySeries(closedAtMs, Date.parse('2026-01-11T23:59:59Z'));
  assert.equal(series.length, 1);
  assert.equal(series[0].landedMax, 3);
});

test('buildShiftVelocityHistoryFromGitEntries reuses deriveIntakeBalanceEvents closes', () => {
  const entries = [
    {
      commit: 'abc',
      dateIso: '2026-01-01T10:00:00Z',
      changes: [{ status: 'R100', path: 'backlog/done/M8/BL-101-a.yaml' }],
    },
  ];
  const history = buildShiftVelocityHistoryFromGitEntries(entries);
  assert.equal(history.adapter, 'deriveIntakeBalanceEvents');
  assert.equal(history.closedAtMs.length, 1);
});

test('nonLinearTimePositions gives recent days finer horizontal spacing', () => {
  const positions = nonLinearTimePositions(20);
  assert.equal(axisIsNonLinearEqualSpacing(positions), false);
  assert.equal(recentAxisHasFinerPrecision(positions), true);
});
