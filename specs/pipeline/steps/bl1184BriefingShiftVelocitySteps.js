'use strict';

// BL-1184: briefing shift velocity — tickets landed per eight-hour stretch.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const FEATURE = 'briefing shift velocity plots tickets landed per eight-hour stretch';
const DAY_MS = 24 * 60 * 60 * 1000;

function shiftVelocityModule() {
  return require(path.join(EXT_DIR, 'out', 'metrics', 'shiftVelocity'));
}

function shiftVelocityChartModule() {
  return require(path.join(EXT_DIR, 'out', 'metrics', 'shiftVelocityChart'));
}

function telemetryModule() {
  return require(path.join(EXT_DIR, 'out', 'metrics', 'shiftVelocityTelemetryStore'));
}

function ensure(ctx) {
  if (!ctx.bl1184) {
    ctx.bl1184 = { closes: [], lifecycles: [], series: null, tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'bl1184-')) };
  }
  return ctx.bl1184;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^backlog close events are available from git history or telemetry$/, () => {});

  scoped(/^three tickets closed inside an eight-hour window and one outside it$/, (ctx) => {
    const base = Date.parse('2026-08-10T08:00:00Z');
    ensure(ctx).closes = [
      base + 1 * 3600000,
      base + 2 * 3600000,
      base + 3 * 3600000,
      base + 9 * 3600000,
    ];
  });

  scoped(/^shift velocity is computed for that window$/, (ctx) => {
    ensure(ctx).windowStart = Date.parse('2026-08-10T08:00:00Z');
  });

  scoped(/^the landed count is three$/, (ctx) => {
    const { countLandedInEightHourWindow } = shiftVelocityModule();
    const st = ensure(ctx);
    assert.equal(countLandedInEightHourWindow(st.closes, st.windowStart), 3);
  });

  scoped(/^close events spanning one calendar day with uneven bursts$/, (ctx) => {
    const day = Date.parse('2026-08-15T00:00:00Z');
    const burst = day + 10 * 3600000;
    ensure(ctx).lifecycles = [
      { ticketId: 'BL-1', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: new Date(burst).toISOString() },
      { ticketId: 'BL-2', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: new Date(burst + 3600000).toISOString() },
      { ticketId: 'BL-3', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: new Date(burst + 7200000).toISOString() },
      { ticketId: 'BL-4', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: new Date(day + 2 * 3600000).toISOString() },
    ];
    ensure(ctx).nowMs = day + DAY_MS;
  });

  scoped(/^the daily shift-velocity series is aggregated$/, (ctx) => {
    const { computeDailyShiftVelocitySeries } = shiftVelocityModule();
    ensure(ctx).series = computeDailyShiftVelocitySeries(ensure(ctx).lifecycles, ensure(ctx).nowMs);
  });

  scoped(/^each day carries the maximum eight-hour landed count for that day$/, (ctx) => {
    const st = ensure(ctx);
    const point = st.series.series.find((p) => p.label === '2026-08-15');
    assert.ok(point);
    assert.equal(point.landedMax, 3);
  });

  scoped(/^backlog git history with done closes across many days$/, () => {});

  scoped(/^shift velocity history is built$/, (ctx) => {
    const day0 = Date.parse('2026-07-01T00:00:00Z');
    const lifecycles = [
      { ticketId: 'BL-10', specDateIso: '2026-06-01T00:00:00Z', closeDateIso: new Date(day0 + 5 * 3600000).toISOString() },
      { ticketId: 'BL-11', specDateIso: '2026-06-01T00:00:00Z', closeDateIso: new Date(day0 + DAY_MS + 4 * 3600000).toISOString() },
    ];
    const { computeDailyShiftVelocitySeries, SHIFT_VELOCITY_LIFECYCLE_ADAPTER } = shiftVelocityModule();
    ensure(ctx).series = computeDailyShiftVelocitySeries(lifecycles, day0 + 2 * DAY_MS);
    ensure(ctx).adapter = SHIFT_VELOCITY_LIFECYCLE_ADAPTER;
  });

  scoped(/^closes come from the existing lifecycle or deliveryMetrics adapter$/, (ctx) => {
    assert.equal(ensure(ctx).adapter, 'deriveTicketLifecycles');
    assert.ok(ensure(ctx).series.series.length >= 2);
  });

  scoped(/^no second backlog history reader is introduced$/, () => {
    const src = fs.readFileSync(path.join(EXT_DIR, 'src', 'metrics', 'shiftVelocity.ts'), 'utf8');
    assert.match(src, /deriveTicketLifecycles/);
    assert.doesNotMatch(src, /parseGitLog\(/);
  });

  scoped(/^a shift-velocity series spanning long history$/, (ctx) => {
    const start = Date.parse('2026-01-01T00:00:00Z');
    const series = [];
    for (let i = 0; i < 40; i++) {
      series.push({ dayMs: start + i * DAY_MS, label: `d${i}`, landedMax: i % 4 });
    }
    ensure(ctx).chartData = { series, windowHours: 8 };
  });

  scoped(/^the briefing chart is rendered$/, (ctx) => {
    const { buildShiftVelocitySvg } = shiftVelocityChartModule();
    ensure(ctx).svg = buildShiftVelocitySvg(ensure(ctx).chartData);
  });

  scoped(/^the time axis is not linear equal spacing for the full history$/, (ctx) => {
    const { hasNonLinearTimeSpacing } = shiftVelocityChartModule();
    const days = ensure(ctx).chartData.series.map((p) => p.dayMs);
    assert.ok(hasNonLinearTimeSpacing(days, days[0], days[days.length - 1], 800));
  });

  scoped(/^recent points are shown with more precision than older points$/, (ctx) => {
    const { nonLinearTimeX } = shiftVelocityChartModule();
    const days = ensure(ctx).chartData.series.map((p) => p.dayMs);
    const min = days[0];
    const max = days[days.length - 1];
    const gapOld = nonLinearTimeX(days[1], min, max, 0, 800) - nonLinearTimeX(days[0], min, max, 0, 800);
    const gapRecent =
      nonLinearTimeX(days[days.length - 1], min, max, 0, 800) -
      nonLinearTimeX(days[days.length - 2], min, max, 0, 800);
    assert.ok(gapRecent > gapOld);
  });

  scoped(/^no existing landed-window telemetry$/, (ctx) => {
    ensure(ctx).telemetryState = 'empty';
  });

  scoped(/^an existing matching telemetry series$/, (ctx) => {
    ensure(ctx).telemetryState = 'exists';
  });

  scoped(/^shift velocity recording is configured$/, (ctx) => {
    const st = ensure(ctx);
    const { shiftVelocityLedgerPath, appendShiftVelocityRecord, listShiftVelocityLedgerFiles } = telemetryModule();
    const root = st.tmp;
    if (st.telemetryState === 'exists') {
      appendShiftVelocityRecord(root, {
        at: '2026-08-01T12:00:00Z',
        dayLabel: '2026-08-01',
        landedMax: 2,
        windowHours: 8,
      });
    }
    st.telemetryFiles = listShiftVelocityLedgerFiles(root);
    st.ledgerPath = shiftVelocityLedgerPath(root, '2026-08-27T12:00:00Z');
  });

  scoped(/^an append-only shift-velocity log is created$/, (ctx) => {
    const st = ensure(ctx);
    const { appendShiftVelocityRecord, listShiftVelocityLedgerFiles } = telemetryModule();
    appendShiftVelocityRecord(st.tmp, {
      at: '2026-08-27T12:00:00Z',
      dayLabel: '2026-08-27',
      landedMax: 1,
      windowHours: 8,
    });
    assert.ok(listShiftVelocityLedgerFiles(st.tmp).length === 1);
    assert.match(listShiftVelocityLedgerFiles(st.tmp)[0], /shift-velocity-\d{4}-\d{2}\.jsonl$/);
  });

  scoped(/^that series is reused without a duplicate$/, (ctx) => {
    const st = ensure(ctx);
    const { appendShiftVelocityRecord, listShiftVelocityLedgerFiles } = telemetryModule();
    const before = listShiftVelocityLedgerFiles(st.tmp).length;
    appendShiftVelocityRecord(st.tmp, {
      at: '2026-08-27T18:00:00Z',
      dayLabel: '2026-08-27',
      landedMax: 3,
      windowHours: 8,
    });
    assert.equal(listShiftVelocityLedgerFiles(st.tmp).length, before);
  });
}

module.exports = { registerSteps };
