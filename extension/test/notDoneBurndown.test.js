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

// ── BL-910: projected ETA on the burndown ──────────────────────────────────

const { projectNotDoneEta, NOT_SHRINKING_REASON } = require('../out/metrics/notDoneBurndown');

const NOW = Date.parse('2026-08-10T15:00:00+02:00');
const DAY = 24 * 60 * 60 * 1000;

function seriesWith(openN, closePerDay, mintPerDay) {
  // Minimal, honest series shape around the three numbers the projection
  // reads; projection filled by the same function production uses.
  const base = {
    windowDays: 7,
    open0: openN,
    openN,
    net: 0,
    totalClosed: 0,
    totalFiled: 0,
    closePerDay,
    mintPerDay,
    series: [
      { dayMs: NOW - DAY, label: '08-09', remaining: openN, filed: 0, closed: 0 },
      { dayMs: NOW, label: '08-10', remaining: openN, filed: 0, closed: 0 },
    ],
  };
  return { ...base, projection: projectNotDoneEta(openN, closePerDay, mintPerDay, NOW) };
}

test('BL-910: a strictly positive net burn projects days and a calendar date (openN / net burn)', () => {
  const p = projectNotDoneEta(100, 6.0, 4.0, NOW);
  assert.equal(p.kind, 'eta');
  assert.equal(p.etaDays, 50);
  const expected = new Date(NOW + 50 * DAY);
  const label = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
  assert.equal(p.etaDateLabel, label);
  assert.equal(p.netBurnPerDay, 2.0);
});

test('BL-910 invariant 1: growing, flat, and zero-rate backlogs get the reason - never a date, an infinity, or a placeholder', () => {
  for (const [close, mint] of [
    [4.0, 6.0],
    [5.0, 5.0],
    [0.0, 0.0],
  ]) {
    const p = projectNotDoneEta(180, close, mint, NOW);
    assert.equal(p.kind, 'no-eta', `close=${close} mint=${mint}`);
    assert.equal(p.reason, NOT_SHRINKING_REASON);
    assert.equal(p.etaDays, undefined);
    assert.equal(p.etaDateLabel, undefined);
  }
  assert.match(NOT_SHRINKING_REASON, /no ETA/);
  assert.match(NOT_SHRINKING_REASON, /still growing/);
});

test('BL-910 invariant 2: the projection is computed from the rates AS PRINTED (1 decimal), so it is recomputable from the chart itself', () => {
  // Unrounded rates 5.96 and 4.04 PRINT as 6.0 and 4.0; a reader recomputing
  // 100 / (6.0 - 4.0) must get the shown answer, not 100 / 1.92.
  const p = projectNotDoneEta(100, 5.96, 4.04, NOW);
  assert.equal(p.kind, 'eta');
  assert.equal(p.etaDays, 50);
});

test('BL-910 invariant 2: an ETA that divides EXACTLY is not pushed a day out by float dust', () => {
  // Regression: the projection used to divide by the reconstructed
  // netBurnPerDay float, so 21 / 0.7 evaluated to 30.000000000000004 and
  // ceiled to 31 - while a reader dividing the printed numbers by hand got
  // 30. The division now stays in integer tenths. These are the smallest
  // failing cases in the realistic range; each divides exactly.
  for (const [openN, close, mint, expectedDays] of [
    [21, 0.7, 0.0, 30],
    [42, 0.7, 0.0, 60],
    [21, 1.4, 0.7, 30],
    [161, 0.7, 0.0, 230],
  ]) {
    const p = projectNotDoneEta(openN, close, mint, NOW);
    assert.equal(p.kind, 'eta');
    assert.equal(
      p.etaDays,
      expectedDays,
      `openN=${openN} at net burn ${(close - mint).toFixed(1)}/d must be ${expectedDays}d, the number a reader gets by hand`
    );
  }
});

test('BL-910: a fractional day count rounds up to whole days for the calendar date', () => {
  const p = projectNotDoneEta(101, 6.0, 4.0, NOW); // 50.5 days
  assert.equal(p.kind, 'eta');
  assert.equal(p.etaDays, 51);
});

test('BL-910: computeNotDoneBurndownSeries carries its own projection', () => {
  const series = computeNotDoneBurndownSeries(lifecycles, NOW, 10);
  assert.ok(series.projection, 'series must carry a projection');
  const recomputed = projectNotDoneEta(series.openN, series.closePerDay, series.mintPerDay, NOW);
  assert.deepEqual(series.projection, recomputed);
});

test('BL-910: the chart renders the ETA labelled as covering all open tickets, never as a milestone forecast, and keeps the burndown heading', () => {
  const svg = buildNotDoneBurndownSvg(seriesWith(100, 6.0, 4.0));
  assert.match(svg, /Projected clear \(all open tickets\): \d{4}-\d{2}-\d{2}/);
  assert.match(svg, /~50d/);
  assert.doesNotMatch(svg, /milestone|p50|p85/i);
  assert.match(svg, /Backlog burndown/);
});

test('BL-910 required wiring: a not-shrinking backlog renders the reason on the chart itself - no date anywhere', () => {
  const svg = buildNotDoneBurndownSvg(seriesWith(180, 5.0, 5.0));
  assert.match(svg, /no ETA — backlog still growing/);
  assert.doesNotMatch(svg, /\d{4}-\d{2}-\d{2}/);
  assert.doesNotMatch(svg, /Infinity|NaN|never/i);
});

test('BL-910: a series without a projection fails loud - computed-but-not-drawn must be impossible, so is not-computed-at-all', () => {
  const stale = seriesWith(100, 6.0, 4.0);
  delete stale.projection;
  assert.throws(() => buildNotDoneBurndownSvg(stale), /projection/);
});
