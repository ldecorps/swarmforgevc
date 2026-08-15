const assert = require('node:assert/strict');
const {
  computeNotDoneBurndownSeries,
  buildNotDoneBurndownSvg,
  renderNotDoneBurndownPng,
  NOT_DONE_BURNDOWN_DIAGRAM_NAME,
  DEFAULT_NOT_DONE_BURNDOWN_WINDOW_DAYS,
} = require('../out/metrics/notDoneBurndown');

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

test('buildNotDoneBurndownSvg draws the remaining polyline and title', () => {
  const nowMs = Date.parse('2026-08-10T15:00:00+02:00');
  const series = computeNotDoneBurndownSeries(lifecycles, nowMs, 7);
  const svg = buildNotDoneBurndownSvg(series);
  assert.match(svg, /Backlog burndown — last 7 days \(not-done tickets\)/);
  assert.match(svg, /<polyline /);
  assert.match(svg, /not-done tickets/);
  assert.equal(DEFAULT_NOT_DONE_BURNDOWN_WINDOW_DAYS, 30);
  assert.equal(NOT_DONE_BURNDOWN_DIAGRAM_NAME, 'not-done-burndown');
});

test('renderNotDoneBurndownPng returns a well-formed PNG', () => {
  const nowMs = Date.parse('2026-08-10T15:00:00+02:00');
  const series = computeNotDoneBurndownSeries(lifecycles, nowMs, 5);
  const png = renderNotDoneBurndownPng(buildNotDoneBurndownSvg(series));
  assert.ok(png.subarray(0, 8).equals(PNG_MAGIC));
  assert.ok(png.length > 1000);
}, 60000);
