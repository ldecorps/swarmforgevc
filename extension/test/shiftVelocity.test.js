const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  countLandedInEightHourWindow,
  maxRollingEightHourLandedForDay,
  computeDailyShiftVelocitySeries,
  closedTimesMsFromLifecycles,
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
const { escapeXmlForSvg, niceChartAxisMax } = require('../out/metrics/briefingChartSvgCommon');
const {
  appendShiftVelocityRecord,
  hasShiftVelocityTelemetry,
  listShiftVelocityLedgerFiles,
  readShiftVelocityRecords,
  shiftVelocityLedgerPath,
  SHIFT_VELOCITY_TELEMETRY_GLOB,
} = require('../out/metrics/shiftVelocityTelemetryStore');
const { renderBriefingShiftVelocity } = require('../out/tools/render-briefing-shift-velocity');
const { serializeLifecycleSnapshot } = require('../out/metrics/lifecycleSnapshot');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

test('countLandedInEightHourWindow is half-open on the start and end edges', () => {
  const base = Date.parse('2026-08-10T00:00:00Z');
  const end = base + EIGHT_HOUR_MS;
  assert.equal(countLandedInEightHourWindow([base], base), 1);
  assert.equal(countLandedInEightHourWindow([end], base), 0);
  assert.equal(countLandedInEightHourWindow([end - 1], base), 1);
  assert.equal(countLandedInEightHourWindow([base - 1], base), 0);
});

test('closedTimesMsFromLifecycles drops null and unparseable closes', () => {
  const closes = closedTimesMsFromLifecycles([
    { ticketId: 'BL-1', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: '2026-08-10T01:00:00Z' },
    { ticketId: 'BL-2', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: null },
    { ticketId: 'BL-3', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: 'not-a-date' },
  ]);
  assert.equal(closes.length, 1);
  assert.equal(closes[0], Date.parse('2026-08-10T01:00:00Z'));
});

test('computeDailyShiftVelocitySeries uses max rolling eight-hour landed per day', () => {
  const day = Date.parse('2026-08-05T00:00:00Z');
  const burst = day + 10 * 60 * 60 * 1000;
  const lifecycles = [
    { ticketId: 'BL-1', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: new Date(burst).toISOString() },
    { ticketId: 'BL-2', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: new Date(burst + 3600000).toISOString() },
    { ticketId: 'BL-3', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: new Date(burst + 7200000).toISOString() },
    { ticketId: 'BL-4', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: new Date(day + 2 * 60 * 60 * 1000).toISOString() },
  ];
  const nowMs = day + DAY_MS;
  const result = computeDailyShiftVelocitySeries(lifecycles, nowMs);
  const point = result.series.find((p) => p.label === '2026-08-05');
  assert.ok(point);
  assert.equal(point.landedMax, 3);
  assert.equal(result.windowHours, 8);
  assert.equal(result.series.length, 2);
  assert.equal(point.label, '2026-08-05');
  assert.equal(result.series[0].label, '2026-08-05');
});

test('computeDailyShiftVelocitySeries returns empty series when nothing closed', () => {
  const empty = computeDailyShiftVelocitySeries(
    [{ ticketId: 'BL-1', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: null }],
    Date.parse('2026-08-10T00:00:00Z')
  );
  assert.deepEqual(empty.series, []);
  assert.equal(empty.windowHours, 8);
  assert.deepEqual(computeDailyShiftVelocitySeries([], Date.parse('2026-08-10T00:00:00Z')).series, []);
});

test('computeDailyShiftVelocitySeries spans from earliest close day through now', () => {
  const early = Date.parse('2026-08-01T12:00:00Z');
  const late = Date.parse('2026-08-10T12:00:00Z');
  const result = computeDailyShiftVelocitySeries(
    [
      { ticketId: 'BL-1', specDateIso: '2026-07-01T00:00:00Z', closeDateIso: new Date(late).toISOString() },
      { ticketId: 'BL-2', specDateIso: '2026-07-01T00:00:00Z', closeDateIso: new Date(early).toISOString() },
    ],
    late
  );
  assert.equal(result.series[0].label, '2026-08-01');
  assert.equal(result.series[result.series.length - 1].label, '2026-08-10');
  assert.equal(result.series.length, 10);
});

test('maxRollingEightHourLandedForDay stops starting windows at day end', () => {
  const day = Date.parse('2026-08-10T00:00:00Z');
  const dayEnd = day + DAY_MS;
  // Last overlapping window starts at dayEnd-1h and ends at dayEnd+7h (exclusive).
  // A close at dayEnd+7h is outside every valid window but inside a mutant
  // window that wrongly starts at dayEnd.
  assert.equal(maxRollingEightHourLandedForDay([dayEnd + 7 * 3600000], day), 0);
  assert.equal(maxRollingEightHourLandedForDay([dayEnd + 7 * 3600000 - 1], day), 1);
  assert.equal(maxRollingEightHourLandedForDay([], day), 0);
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

test('buildShiftVelocitySvg escapes XML in labels and rejects an empty series', () => {
  assert.throws(() => buildShiftVelocitySvg({ series: [], windowHours: 8 }), /empty/);
  const start = Date.parse('2026-01-01T00:00:00Z');
  const svg = buildShiftVelocitySvg({
    series: [
      { dayMs: start, label: 'a&b<c>"', landedMax: 0 },
      { dayMs: start + 10 * DAY_MS, label: 'mid', landedMax: 2 },
      { dayMs: start + 20 * DAY_MS, label: 'end', landedMax: 1 },
      { dayMs: start + 25 * DAY_MS, label: 'late', landedMax: 4 },
      { dayMs: start + 29 * DAY_MS, label: 'tip', landedMax: 3 },
    ],
    windowHours: 8,
  });
  assert.match(svg, /a&amp;b&lt;c&gt;&quot;/);
  assert.doesNotMatch(svg, /a&b<c>"/);
  assert.match(svg, /Peak 4 tickets \/ 8h stretch/);
  assert.match(svg, /<circle /);
  assert.match(svg, /<polyline /);
});

test('hasNonLinearTimeSpacing requires three or more days', () => {
  const a = Date.parse('2026-01-01T00:00:00Z');
  const b = a + DAY_MS;
  assert.equal(hasNonLinearTimeSpacing([a, b], a, b, 800), false);
  assert.equal(hasNonLinearTimeSpacing([a], a, a, 800), false);
  const warped = [];
  for (let i = 0; i < 20; i++) warped.push(a + i * DAY_MS);
  assert.equal(hasNonLinearTimeSpacing(warped, warped[0], warped[warped.length - 1], 800), true);
});

test('nonLinearTimeX stays finite for a single-day span and spreads recent days', () => {
  const day = Date.parse('2026-08-10T00:00:00Z');
  const x = nonLinearTimeX(day, day, day, 10, 100);
  assert.ok(Number.isFinite(x));
  assert.equal(x, 10 + 100);
  const min = Date.parse('2026-01-01T00:00:00Z');
  const max = min + 30 * DAY_MS;
  const gapOld = nonLinearTimeX(min + DAY_MS, min, max, 0, 800) - nonLinearTimeX(min, min, max, 0, 800);
  const gapRecent = nonLinearTimeX(max, min, max, 0, 800) - nonLinearTimeX(max - DAY_MS, min, max, 0, 800);
  assert.ok(gapRecent > gapOld);
  assert.ok(gapRecent / gapOld > 1.05);
});

test('escapeXmlForSvg escapes each special character', () => {
  assert.equal(escapeXmlForSvg('&'), '&amp;');
  assert.equal(escapeXmlForSvg('<'), '&lt;');
  assert.equal(escapeXmlForSvg('>'), '&gt;');
  assert.equal(escapeXmlForSvg('"'), '&quot;');
  assert.equal(escapeXmlForSvg('a&b<c>"'), 'a&amp;b&lt;c&gt;&quot;');
});

test('niceChartAxisMax covers zero floor and each nice-norm arm', () => {
  assert.equal(niceChartAxisMax(0, 5), 5);
  assert.equal(niceChartAxisMax(-1, 7), 7);
  // Exact norm boundaries pin <= vs < mutants.
  assert.equal(niceChartAxisMax(1 / 1.1, 5), 1);
  assert.equal(niceChartAxisMax(2 / 1.1, 5), 2);
  assert.equal(niceChartAxisMax(5 / 1.1, 5), 5);
  // padded 1.1 → mag 1 → norm 1.1 → nice 2
  assert.equal(niceChartAxisMax(1, 5), 2);
  // padded 2.2 → mag 1 → norm 2.2 → nice 5
  assert.equal(niceChartAxisMax(2, 5), 5);
  // padded 5.5 → mag 1 → norm 5.5 → nice 10
  assert.equal(niceChartAxisMax(5, 5), 10);
  // padded 11 → mag 10 → norm 1.1 → nice 2 → 20
  assert.equal(niceChartAxisMax(10, 5), 20);
});

test('shift-velocity telemetry creates append-only monthly ledgers and reuses them', () => {
  const root = mkTmpDir('bl1184-telemetry-');
  assert.equal(hasShiftVelocityTelemetry(root), false);
  assert.deepEqual(listShiftVelocityLedgerFiles(root), []);
  assert.deepEqual(readShiftVelocityRecords(root), []);

  appendShiftVelocityRecord(root, {
    at: '2026-08-01T12:00:00Z',
    dayLabel: '2026-08-01',
    landedMax: 2,
    windowHours: 8,
  });
  assert.equal(hasShiftVelocityTelemetry(root), true);
  assert.equal(listShiftVelocityLedgerFiles(root).length, 1);
  assert.match(listShiftVelocityLedgerFiles(root)[0], /shift-velocity-2026-08\.jsonl$/);
  assert.equal(SHIFT_VELOCITY_TELEMETRY_GLOB, 'shift-velocity-*.jsonl');

  appendShiftVelocityRecord(root, {
    at: '2026-08-27T18:00:00Z',
    dayLabel: '2026-08-27',
    landedMax: 3,
    windowHours: 8,
  });
  assert.equal(listShiftVelocityLedgerFiles(root).length, 1);

  appendShiftVelocityRecord(root, {
    at: '2026-09-02T12:00:00Z',
    dayLabel: '2026-09-02',
    landedMax: 1,
    windowHours: 8,
  });
  const files = listShiftVelocityLedgerFiles(root);
  assert.equal(files.length, 2);
  assert.ok(files[0].endsWith('shift-velocity-2026-08.jsonl'));
  assert.ok(files[1].endsWith('shift-velocity-2026-09.jsonl'));
  const records = readShiftVelocityRecords(root);
  assert.equal(records.length, 3);
  assert.equal(records[1].landedMax, 3);
  assert.equal(shiftVelocityLedgerPath(root, '2026-09-01T00:00:00Z').includes('shift-velocity-2026-09.jsonl'), true);
});

test('readShiftVelocityRecords skips blank lines and malformed JSON', () => {
  const root = mkTmpDir('bl1184-telemetry-bad-');
  const ledger = shiftVelocityLedgerPath(root, '2026-08-15T00:00:00Z');
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(
    ledger,
    [
      '',
      '   ',
      'not-json',
      'null',
      '[]',
      '{"at":1}',
      JSON.stringify({ at: '2026-08-15T01:00:00Z', dayLabel: '2026-08-15', landedMax: 4, windowHours: 8 }),
      JSON.stringify({ at: 'x', dayLabel: 'y', landedMax: 'nope', windowHours: 8 }),
      JSON.stringify({ at: 'x', dayLabel: 3, landedMax: 1, windowHours: 8 }),
      JSON.stringify({ at: 'x', dayLabel: 'y', landedMax: 1, windowHours: '8' }),
    ].join('\n')
  );
  // Sibling junk must not match the ledger regex (anchors + extension).
  fs.writeFileSync(path.join(path.dirname(ledger), 'other-notes.txt'), 'nope\n');
  fs.writeFileSync(path.join(path.dirname(ledger), 'shift-velocity-bad.jsonl'), '{}\n');
  fs.writeFileSync(path.join(path.dirname(ledger), 'prefix-shift-velocity-2026-08.jsonl'), '{}\n');
  fs.writeFileSync(path.join(path.dirname(ledger), 'shift-velocity-2026-08.jsonl.bak'), '{}\n');
  const records = readShiftVelocityRecords(root);
  assert.equal(records.length, 1);
  assert.equal(records[0].landedMax, 4);
  assert.equal(listShiftVelocityLedgerFiles(root).length, 1);
  assert.ok(listShiftVelocityLedgerFiles(root)[0].includes(`${path.sep}.swarmforge${path.sep}telemetry${path.sep}`));
});

test('readShiftVelocityRecords continues past an unreadable ledger file', () => {
  const root = mkTmpDir('bl1184-telemetry-unreadable-');
  const good = shiftVelocityLedgerPath(root, '2026-08-01T00:00:00Z');
  const bad = shiftVelocityLedgerPath(root, '2026-09-01T00:00:00Z');
  fs.mkdirSync(path.dirname(good), { recursive: true });
  fs.writeFileSync(
    good,
    `${JSON.stringify({ at: '2026-08-01T00:00:00Z', dayLabel: '2026-08-01', landedMax: 1, windowHours: 8 })}\n`
  );
  fs.writeFileSync(bad, 'secret\n');
  fs.chmodSync(bad, 0);
  try {
    const records = readShiftVelocityRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0].dayLabel, '2026-08-01');
  } finally {
    fs.chmodSync(bad, 0o644);
  }
});

test('renderBriefingShiftVelocity renders PNG from a lifecycle snapshot and appends telemetry', () => {
  const root = mkTmpDir('bl1184-render-');
  const nowMs = Date.parse('2026-08-15T15:00:00Z');
  const records = [
    {
      ticketId: 'ZZ-1184-1',
      specDateIso: '2026-08-01T00:00:00Z',
      closeDateIso: '2026-08-10T10:00:00Z',
    },
    {
      ticketId: 'ZZ-1184-2',
      specDateIso: '2026-08-01T00:00:00Z',
      closeDateIso: '2026-08-10T11:00:00Z',
    },
  ];
  const snapshotPath = path.join(root, 'snapshot.json');
  fs.writeFileSync(snapshotPath, JSON.stringify(serializeLifecycleSnapshot(records, nowMs), null, 2));
  assert.equal(hasShiftVelocityTelemetry(root), false);
  const diagrams = renderBriefingShiftVelocity(root, nowMs, snapshotPath);
  assert.equal(diagrams.length, 1);
  assert.equal(diagrams[0].name, SHIFT_VELOCITY_DIAGRAM_NAME);
  const png = Buffer.from(diagrams[0].base64, 'base64');
  assert.ok(png.subarray(0, 8).equals(PNG_MAGIC));
  assert.equal(hasShiftVelocityTelemetry(root), true);
  const emptySnap = path.join(root, 'empty-snapshot.json');
  fs.writeFileSync(
    emptySnap,
    JSON.stringify(
      serializeLifecycleSnapshot(
        [{ ticketId: 'ZZ-open', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: null }],
        nowMs
      ),
      null,
      2
    )
  );
  assert.throws(() => renderBriefingShiftVelocity(root, nowMs, emptySnap), /empty/);
});
