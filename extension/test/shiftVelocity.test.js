const assert = require('node:assert/strict');
const {
  countLandedInEightHourWindow,
  maxRollingEightHourLandedForDay,
  computeDailyShiftVelocitySeries,
  EIGHT_HOUR_MS,
  DAY_MS,
  SHIFT_VELOCITY_LIFECYCLE_ADAPTER,
} = require('../out/metrics/shiftVelocity');
const {
  buildShiftVelocitySvg,
  hasNonLinearTimeSpacing,
  nonLinearTimeX,
  SHIFT_VELOCITY_DIAGRAM_NAME,
} = require('../out/metrics/shiftVelocityChart');

test('countLandedInEightHourWindow counts only closes inside the window', () => {
  const base = Date.parse('2026-08-10T00:00:00Z');
  const closes = [
    base + 1 * 60 * 60 * 1000,
    base + 2 * 60 * 60 * 1000,
    base + 3 * 60 * 60 * 1000,
    base + 9 * 60 * 60 * 1000,
  ];
  assert.equal(countLandedInEightHourWindow(closes, base), 3);
  assert.equal(SHIFT_VELOCITY_LIFECYCLE_ADAPTER, 'deriveTicketLifecycles');
});

test('computeDailyShiftVelocitySeries uses max rolling eight-hour landed per day', () => {
  const day = Date.parse('2026-08-10T00:00:00Z');
  const burst = day + 10 * 60 * 60 * 1000;
  const lifecycles = [
    { ticketId: 'BL-1', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: new Date(burst).toISOString() },
    { ticketId: 'BL-2', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: new Date(burst + 3600000).toISOString() },
    { ticketId: 'BL-3', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: new Date(burst + 7200000).toISOString() },
    { ticketId: 'BL-4', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: new Date(day + 2 * 60 * 60 * 1000).toISOString() },
  ];
  const nowMs = day + DAY_MS;
  const result = computeDailyShiftVelocitySeries(lifecycles, nowMs);
  const point = result.series.find((p) => p.label === '2026-08-10');
  assert.ok(point);
  assert.equal(point.landedMax, 3);
  assert.equal(result.windowHours, 8);
});

test('buildShiftVelocitySvg uses non-linear time spacing for long history', () => {
  const series = [];
  const start = Date.parse('2026-01-01T00:00:00Z');
  for (let i = 0; i < 30; i++) {
    series.push({
      dayMs: start + i * DAY_MS,
      label: `d${i}`,
      landedMax: i % 5,
    });
  }
  const data = { series, windowHours: 8 };
  const svg = buildShiftVelocitySvg(data);
  assert.match(svg, /Shift velocity/);
  assert.match(svg, /non-linear time/i);
  assert.equal(SHIFT_VELOCITY_DIAGRAM_NAME, 'shift-velocity');
  const days = series.map((p) => p.dayMs);
  assert.ok(hasNonLinearTimeSpacing(days, days[0], days[days.length - 1], 800));
  const xOld = nonLinearTimeX(days[0], days[0], days[days.length - 1], 0, 800);
  const xRecent = nonLinearTimeX(days[days.length - 1], days[0], days[days.length - 1], 0, 800);
  assert.ok(xRecent > xOld);
});
