'use strict';

// BL-263: step handlers for the not-done-ticket-count feature. Drives the
// REAL compiled modules in-process - computeNotDoneCount/buildBacklogDashboard
// (the projection producer both surfaces read) and formatNotDoneCountLine
// (the briefing CLI's own formatter) - no live repo scan, no real timers.
// "Both surfaces agree" is proven by construction: this suite calls
// computeNotDoneCount exactly ONCE per scenario and feeds that same number to
// both the briefing formatter and the backlog.json shape the PWA renders
// verbatim (already unit-proven by pwaDashboard.test.js's own
// notDoneCount-textContent assertions - not re-driving a full jsdom render
// here would just re-test that seam a second way).
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { buildBacklogDashboard, computeNotDoneCount, BACKLOG_DASHBOARD_SCHEMA_VERSION } = require(
  path.join(EXT_DIR, 'out', 'metrics', 'backlogDashboard')
);
const { formatNotDoneCountLine } = require(path.join(EXT_DIR, 'out', 'tools', 'not-done-count-line'));

function item(id, status, overrides = {}) {
  return { id, title: id + ' title', status, ...overrides };
}

function emptyDeliveryMetrics() {
  return {
    velocity: { weeklySeries: [], trend: { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
    burndown: [],
    cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, weeklySeries: [], trend: { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' } },
    forecasts: { tickets: [], milestones: [], throughputPerDay: 0 },
  };
}

function buildFixtureDashboard(folders) {
  return buildBacklogDashboard(folders, [], emptyDeliveryMetrics(), 'primary', 'abc123', '2026-07-09T00:00:00Z');
}

function registerSteps(registry) {
  registry.define(/^the committed backlog projection listing each ticket's lifecycle state$/, () => {
    // Framing only - scenarios below each construct their own folders fixture.
  });

  // ── count-excludes-done-01 ───────────────────────────────────────────
  registry.define(/^a backlog with active, paused, and done tickets$/, (ctx) => {
    ctx.folders = {
      active: [item('BL-1', 'active'), item('BL-2', 'active')],
      paused: [item('BL-3', 'paused')],
      done: [item('BL-4', 'done'), item('BL-5', 'done'), item('BL-6', 'done')],
    };
  });

  registry.define(/^the not-done total is derived from the projection$/, (ctx) => {
    ctx.dashboard = buildFixtureDashboard(ctx.folders);
  });

  registry.define(/^it counts the active and paused tickets and excludes the done ones$/, (ctx) => {
    if (ctx.dashboard.notDoneCount !== ctx.folders.active.length + ctx.folders.paused.length) {
      throw new Error(
        `expected notDoneCount to be active(${ctx.folders.active.length}) + paused(${ctx.folders.paused.length}), got ${ctx.dashboard.notDoneCount}`
      );
    }
  });

  // ── surfaces-agree-02 ─────────────────────────────────────────────────
  registry.define(/^a single not-done total produced once for both surfaces$/, (ctx) => {
    ctx.folders = { active: [item('BL-1', 'active')], paused: [item('BL-2', 'paused'), item('BL-3', 'paused')], done: [item('BL-4', 'done')] };
    // Produced exactly once - both surfaces below read THIS same number.
    ctx.dashboard = buildFixtureDashboard(ctx.folders);
  });

  registry.define(/^the phone dashboard and the daily briefing each display it$/, (ctx) => {
    // The phone dashboard renders backlog.json's notDoneCount verbatim
    // (pwaDashboard.test.js proves renderNotDoneCount does no transformation
    // of its own) - so "what the phone shows" IS ctx.dashboard.notDoneCount.
    ctx.phoneDisplayedTotal = ctx.dashboard.notDoneCount;
    ctx.briefingLine = formatNotDoneCountLine(ctx.dashboard.notDoneCount);
  });

  registry.define(/^both show that identical total$/, (ctx) => {
    const briefingTotalMatch = ctx.briefingLine.match(/(\d+)/);
    if (!briefingTotalMatch) {
      throw new Error(`expected the briefing line to contain a number, got: ${ctx.briefingLine}`);
    }
    const briefingTotal = Number(briefingTotalMatch[1]);
    if (briefingTotal !== ctx.phoneDisplayedTotal) {
      throw new Error(`expected the briefing total (${briefingTotal}) to equal the phone total (${ctx.phoneDisplayedTotal})`);
    }
  });

  // ── zero-state-03 ─────────────────────────────────────────────────────
  registry.define(/^a backlog whose tickets are all done$/, (ctx) => {
    ctx.folders = { active: [], paused: [], done: [item('BL-1', 'done'), item('BL-2', 'done')] };
  });

  registry.define(/^each surface shows a not-done total of zero rather than a blank or an error$/, (ctx) => {
    if (ctx.dashboard.notDoneCount !== 0) {
      throw new Error(`expected notDoneCount 0, got ${ctx.dashboard.notDoneCount}`);
    }
    const briefingLine = formatNotDoneCountLine(ctx.dashboard.notDoneCount);
    if (!/\b0\b/.test(briefingLine) || briefingLine.trim() === '') {
      throw new Error(`expected an explicit zero in the briefing line, got: "${briefingLine}"`);
    }
  });

  // ── derived-not-stored-04 ─────────────────────────────────────────────
  registry.define(/^the committed backlog projection$/, (ctx) => {
    ctx.folders = { active: [item('BL-1', 'active')], paused: [], done: [] };
  });

  registry.define(/^the not-done total is produced$/, (ctx) => {
    ctx.dashboard = buildFixtureDashboard(ctx.folders);
  });

  registry.define(/^it is a pure derivation of the listed tickets and adds no authoritative store$/, (ctx) => {
    // "Pure derivation": calling computeNotDoneCount directly on the SAME
    // folders reproduces buildBacklogDashboard's own notDoneCount exactly -
    // no hidden state, no side effect, byte-identical on repeat calls.
    const direct = computeNotDoneCount(ctx.folders.active, ctx.folders.paused);
    if (direct !== ctx.dashboard.notDoneCount) {
      throw new Error(`expected the direct computeNotDoneCount call to match buildBacklogDashboard's notDoneCount`);
    }
    if (computeNotDoneCount(ctx.folders.active, ctx.folders.paused) !== direct) {
      throw new Error('expected computeNotDoneCount to be deterministic across repeated calls');
    }
    // "Adds no authoritative store": schemaVersion is unchanged - notDoneCount
    // rides the existing projection, it did not introduce a new one.
    if (ctx.dashboard.schemaVersion !== BACKLOG_DASHBOARD_SCHEMA_VERSION) {
      throw new Error('expected schemaVersion to be unchanged - notDoneCount must not introduce a new store/version');
    }
  });
}

module.exports = { registerSteps };
