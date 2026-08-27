'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BL-1184 invariants — runs only via npm run test:properties.

const REPO_ROOT = path.join(__dirname, '..', '..');
const SHIFT_SRC = path.join(REPO_ROOT, 'extension', 'src', 'metrics', 'shiftVelocity.ts');
const CHART_SRC = path.join(REPO_ROOT, 'extension', 'src', 'metrics', 'shiftVelocityChart.ts');

const {
  countLandedInEightHourWindow,
  computeDailyShiftVelocitySeries,
  closedTimesMsFromLifecycles,
  SHIFT_VELOCITY_LIFECYCLE_ADAPTER,
  EIGHT_HOUR_MS,
} = require('../out/metrics/shiftVelocity');
const { hasNonLinearTimeSpacing } = require('../out/metrics/shiftVelocityChart');

test('BL-1184 invariant 1: counts done closes only — not open or intake', () => {
  const base = Date.parse('2026-08-10T00:00:00Z');
  const lifecycles = [
    { ticketId: 'BL-1', specDateIso: new Date(base).toISOString(), closeDateIso: new Date(base + 3600000).toISOString() },
    { ticketId: 'BL-2', specDateIso: new Date(base + 3600000).toISOString(), closeDateIso: null },
    { ticketId: 'BL-3', specDateIso: new Date(base + 2 * 3600000).toISOString(), closeDateIso: null },
  ];
  const closes = closedTimesMsFromLifecycles(lifecycles);
  assert.equal(closes.length, 1);
  assert.equal(countLandedInEightHourWindow(closes, base), 1);
  const series = computeDailyShiftVelocitySeries(lifecycles, base + 86400000);
  const peak = Math.max(...series.series.map((p) => p.landedMax));
  assert.equal(peak, 1);
});

test('BL-1184 invariant 2: history uses deriveTicketLifecycles adapter only', () => {
  const src = fs.readFileSync(SHIFT_SRC, 'utf8');
  assert.equal(SHIFT_VELOCITY_LIFECYCLE_ADAPTER, 'deriveTicketLifecycles');
  assert.match(src, /deriveTicketLifecycles/);
  assert.match(src, /runGitLog/);
  assert.doesNotMatch(src, /parseGitLog\(/);
});

test('BL-1184 invariant 3: chart time axis is non-linear with recent precision', () => {
  const chartSrc = fs.readFileSync(CHART_SRC, 'utf8');
  assert.match(chartSrc, /nonLinearTimeX/);
  assert.match(chartSrc, /non-linear time/i);
  const start = Date.parse('2026-01-01T00:00:00Z');
  const days = [];
  for (let i = 0; i < 25; i++) {
    days.push(start + i * 86400000);
  }
  assert.ok(hasNonLinearTimeSpacing(days, days[0], days[days.length - 1], 800));
  assert.notEqual(
    hasNonLinearTimeSpacing([days[0], days[0] + 86400000], days[0], days[0] + 86400000, 800),
    true
  );
});
