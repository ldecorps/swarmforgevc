const assert = require('node:assert/strict');
const { computeNotDoneBurndownSeries, DEFAULT_NOT_DONE_BURNDOWN_WINDOW_DAYS } = require('../out/metrics/notDoneBurndown');
const { buildNotDoneBurndownSvg, renderNotDoneBurndownPng, NOT_DONE_BURNDOWN_DIAGRAM_NAME } = require('../out/metrics/notDoneBurndownChart');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const lifecycles = [
  { ticketId: 'BL-1', specDateIso: '2026-08-01T10:00:00Z', closeDateIso: '2026-08-05T12:00:00Z' },
  { ticketId: 'BL-2', specDateIso: '2026-08-02T10:00:00Z', closeDateIso: null },
  { ticketId: 'BL-3', specDateIso: '2026-08-03T10:00:00Z', closeDateIso: null },
  { ticketId: 'BL-4', specDateIso: '2026-07-20T10:00:00Z', closeDateIso: '2026-07-25T10:00:00Z' },
];

test('computeNotDoneBurndownSeries counts remaining across the window', () => {
  const nowMs = Date.parse('2026-08-10T15:00:00+02:00');
  const result = computeNotDoneBurndownSeries(lifecycles, nowMs, 10);
  assert.equal(result.windowDays, 10);
  assert.equal(result.series.length, 10);
  assert.equal(result.openN, 2); // BL-2 + BL-3 still open
  assert.ok(result.series.every((p) => typeof p.label === 'string' && p.label.includes('-')));
  const dayClosed = result.series.find((p) => p.label === '08-05');
  assert.ok(dayClosed);
  assert.equal(dayClosed.closed, 1);
});

test('buildNotDoneBurndownSvg draws the remaining polyline and keeps "burndown" in the heading per the human ruling', () => {
  // BL-896 bounce 2026-08-17: the 2026-08-16 08:20 CEST human ruling
  // explicitly overrides the F1 rename recommendation and keeps the word
  // "burndown" on the heading (backlog/answers-archive/ANSWER-BL-896-land-burndown-chart.md).
  // The heading still names what the series plots (open tickets remaining).
  const nowMs = Date.parse('2026-08-10T15:00:00+02:00');
  const series = computeNotDoneBurndownSeries(lifecycles, nowMs, 7);
  const svg = buildNotDoneBurndownSvg(series);
  assert.match(svg, /burndown/i);
  assert.match(svg, /open tickets remaining/i);
  assert.match(svg, /last 7 days/i);
  assert.match(svg, /<polyline /);
  assert.equal(DEFAULT_NOT_DONE_BURNDOWN_WINDOW_DAYS, 30);
  assert.equal(NOT_DONE_BURNDOWN_DIAGRAM_NAME, 'not-done-burndown');
});

test('computeNotDoneBurndownSeries reconciles only today\'s point against the live open-ticket set (BL-896 F3)', () => {
  // A ticket retired by deleting its YAML (rather than moving it under
  // backlog/done/) never gets a closeDateIso from deriveTicketLifecycles,
  // so the lifecycle-only heuristic overcounts it as still open. When the
  // caller supplies the actual current open ids, today's point must match
  // that ground truth instead - and the retired ticket must not be in it.
  const nowMs = Date.parse('2026-08-10T15:00:00+02:00');
  // BL-2 and BL-3 are lifecycle-open per the fixture above; BL-3 was
  // actually retired by deletion, so it is absent from the live open set.
  const currentOpenTicketIds = new Set(['BL-2']);
  const reconciled = computeNotDoneBurndownSeries(lifecycles, nowMs, 10, currentOpenTicketIds);
  assert.equal(reconciled.openN, 1);
  assert.equal(reconciled.series[reconciled.series.length - 1].remaining, 1);

  const unreconciled = computeNotDoneBurndownSeries(lifecycles, nowMs, 10);
  assert.equal(unreconciled.openN, 2); // unchanged when no live set is supplied

  // Only today's point is corrected - earlier days keep the lifecycle
  // estimate, since past disk state cannot be reconstructed.
  assert.deepEqual(
    reconciled.series.slice(0, -1).map((p) => p.remaining),
    unreconciled.series.slice(0, -1).map((p) => p.remaining)
  );
});

test('renderNotDoneBurndownPng returns a well-formed PNG', () => {
  const nowMs = Date.parse('2026-08-10T15:00:00+02:00');
  const series = computeNotDoneBurndownSeries(lifecycles, nowMs, 5);
  const png = renderNotDoneBurndownPng(buildNotDoneBurndownSvg(series));
  assert.ok(png.subarray(0, 8).equals(PNG_MAGIC));
  assert.ok(png.length > 1000);
}, 60000);
