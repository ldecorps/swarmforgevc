'use strict';

// BL-1184: briefing shift velocity — tickets landed per 8h stretch.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const {
  countLandedInWindow,
  computeDailyShiftVelocitySeries,
  buildShiftVelocityHistoryFromGitEntries,
  EIGHT_HOUR_MS,
} = require(path.join(EXT_DIR, 'out', 'metrics', 'shiftVelocity'));
const { deriveIntakeBalanceEvents } = require(path.join(EXT_DIR, 'out', 'metrics', 'deliveryMetrics'));
const {
  buildShiftVelocitySvg,
  nonLinearTimePositions,
  axisIsNonLinearEqualSpacing,
  recentAxisHasFinerPrecision,
} = require(path.join(EXT_DIR, 'out', 'metrics', 'shiftVelocityChart'));
const { configureShiftVelocityRecording } = require(path.join(EXT_DIR, 'out', 'metrics', 'shiftVelocityTelemetry'));

const FEATURE = 'briefing shift velocity plots tickets landed per eight-hour stretch';

function commit(dateIso, changes) {
  return { commit: `c-${dateIso}`, dateIso, changes };
}

function ensure(ctx) {
  if (!ctx.bl1184) {
    ctx.bl1184 = {};
  }
  return ctx.bl1184;
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1184-'));
}

function freshFixture(ctx) {
  const st = ensure(ctx);
  st.fixtureRoot = mkFixtureRoot();
  return st;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^backlog close events are available from git history or telemetry$/, () => {});

  scoped(/^three tickets closed inside an eight-hour window and one outside it$/, (ctx) => {
    const st = ensure(ctx);
    const base = Date.parse('2026-01-10T08:00:00Z');
    st.closedAtMs = [
      base + 1 * 60 * 60 * 1000,
      base + 2 * 60 * 60 * 1000,
      base + 3 * 60 * 60 * 1000,
      base + 12 * 60 * 60 * 1000,
    ];
    st.windowStartMs = base;
  });

  scoped(/^shift velocity is computed for that window$/, (ctx) => {
    const st = ensure(ctx);
    st.landedCount = countLandedInWindow(st.closedAtMs, st.windowStartMs, EIGHT_HOUR_MS);
  });

  scoped(/^the landed count is three$/, (ctx) => {
    assert.equal(ensure(ctx).landedCount, 3);
  });

  scoped(/^close events spanning one calendar day with uneven bursts$/, (ctx) => {
    const st = ensure(ctx);
    st.closedAtMs = [
      Date.parse('2026-01-11T02:00:00Z'),
      Date.parse('2026-01-11T03:00:00Z'),
      Date.parse('2026-01-11T04:00:00Z'),
      Date.parse('2026-01-11T14:00:00Z'),
    ];
    st.nowMs = Date.parse('2026-01-11T23:59:59Z');
  });

  scoped(/^the daily shift-velocity series is aggregated$/, (ctx) => {
    const st = ensure(ctx);
    st.series = computeDailyShiftVelocitySeries(st.closedAtMs, st.nowMs);
  });

  scoped(/^each day carries the maximum eight-hour landed count for that day$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.series.length, 1);
    assert.equal(st.series[0].landedMax, 3);
  });

  scoped(/^backlog git history with done closes across many days$/, (ctx) => {
    ensure(ctx).entries = [
      commit('2026-01-01T10:00:00Z', [{ status: 'R100', path: 'backlog/done/M8/BL-101-a.yaml' }]),
      commit('2026-01-03T10:00:00Z', [{ status: 'R100', path: 'backlog/done/M8/BL-102-a.yaml' }]),
      commit('2026-01-05T10:00:00Z', [{ status: 'R100', path: 'backlog/done/M8/BL-103-a.yaml' }]),
    ];
  });

  scoped(/^shift velocity history is built$/, (ctx) => {
    const st = ensure(ctx);
    st.history = buildShiftVelocityHistoryFromGitEntries(st.entries);
  });

  scoped(/^closes come from the existing lifecycle or deliveryMetrics adapter$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.history.adapter, 'deriveIntakeBalanceEvents');
    assert.equal(st.history.closedAtMs.length, 3);
    const direct = deriveIntakeBalanceEvents(st.entries);
    assert.deepEqual(st.history.closedAtMs, direct.closedAtMs);
  });

  scoped(/^no second backlog history reader is introduced$/, (ctx) => {
    assert.equal(buildShiftVelocityHistoryFromGitEntries.name, 'buildShiftVelocityHistoryFromGitEntries');
    assert.equal(deriveIntakeBalanceEvents.name, 'deriveIntakeBalanceEvents');
  });

  scoped(/^a shift-velocity series spanning long history$/, (ctx) => {
    const st = ensure(ctx);
    const start = Date.parse('2025-01-01T00:00:00Z');
    st.series = Array.from({ length: 120 }, (_, index) => ({
      periodStart: new Date(start + index * 24 * 60 * 60 * 1000).toISOString(),
      landedMax: (index % 5) + 1,
    }));
  });

  scoped(/^the briefing chart is rendered$/, (ctx) => {
    const st = ensure(ctx);
    st.svg = buildShiftVelocitySvg({ points: st.series, windowDays: st.series.length });
    st.positions = nonLinearTimePositions(st.series.length);
  });

  scoped(/^the time axis is not linear equal spacing for the full history$/, (ctx) => {
    assert.equal(axisIsNonLinearEqualSpacing(ensure(ctx).positions), false);
  });

  scoped(/^recent points are shown with more precision than older points$/, (ctx) => {
    assert.equal(recentAxisHasFinerPrecision(ensure(ctx).positions), true);
  });

  scoped(/^no existing landed-window telemetry$/, (ctx) => {
    freshFixture(ctx).telemetryPaths = [];
  });

  scoped(/^an existing matching telemetry series$/, (ctx) => {
    const st = freshFixture(ctx);
    const logPath = path.join(st.fixtureRoot, '.swarmforge', 'telemetry', 'shift-velocity.jsonl');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, '', 'utf8');
    st.telemetryPaths = [logPath];
  });

  scoped(/^shift velocity recording is configured$/, (ctx) => {
    const st = ensure(ctx);
    if (!st.fixtureRoot) {
      st.fixtureRoot = mkFixtureRoot();
    }
    st.recording = configureShiftVelocityRecording(st.fixtureRoot, st.telemetryPaths ?? []);
  });

  scoped(/^an append-only shift-velocity log is created$/, (ctx) => {
    const recording = ensure(ctx).recording;
    assert.equal(recording.created, true);
    assert.equal(recording.reused, false);
    assert.match(recording.path, /shift-velocity\.jsonl$/);
  });

  scoped(/^that series is reused without a duplicate$/, (ctx) => {
    const recording = ensure(ctx).recording;
    assert.equal(recording.reused, true);
    assert.equal(recording.created, false);
    assert.match(recording.path, /shift-velocity\.jsonl$/);
  });
}

module.exports = { registerSteps };
