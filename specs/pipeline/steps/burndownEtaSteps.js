'use strict';

// BL-228: step handlers for the burndown-milestone-ETA feature. Drives the
// REAL compiled formatDeliveryOverview (extension/out/tools/swarm-metrics.js)
// for the CLI surface, and the REAL pwa/app.js (via render-dashboard-labels.js,
// jsdom, mirroring pwaLabelCatalogSteps.js's own render-script pattern) for
// the PWA surface - no parallel ETA computation, both surfaces read the
// SAME forecasts fixture this file builds.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { formatDeliveryOverview } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'swarm-metrics.js')
);
const RENDER_SCRIPT = path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'render-dashboard-labels.js');

function noSampleTrend() {
  return { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' };
}

function baseDeliveryMetrics() {
  return {
    velocity: { weeklySeries: [], trend: noSampleTrend(), rollingWindowCount: 0, rollingWindowDays: 7 },
    burndown: [],
    cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, weeklySeries: [], trend: noSampleTrend() },
    forecasts: { tickets: [], milestones: [], throughputPerDay: 0 },
    suiteDurationTrend: { hasLocalData: false, dailySeries: [], trend: noSampleTrend() },
  };
}

function fakeBacklogFixture(burndown, forecasts) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123',
    board: { active: [], paused: [], doneByMilestone: {} },
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown,
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts,
    },
  };
}

function renderPwaBurndown(burndown, forecasts) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-burndown-eta-'));
  const fixturePath = path.join(tmpDir, 'backlog.json');
  fs.writeFileSync(fixturePath, JSON.stringify(fakeBacklogFixture(burndown, forecasts)));
  const out = execFileSync('node', [RENDER_SCRIPT, fixturePath, 'en'], { encoding: 'utf8' });
  return JSON.parse(out).burndownText;
}

function cliBurndownLine(burndown, forecasts) {
  const metrics = { ...baseDeliveryMetrics(), burndown, forecasts };
  const text = formatDeliveryOverview(metrics);
  return text.split('\n').find((line) => line.startsWith('Burndown:'));
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^delivery metrics whose forecasts\.milestones carry each milestone's ETA$/, () => {
    // Nothing to fixture yet - each scenario's own Given below builds the
    // specific burndown/forecasts pairing it needs.
  });

  // ── milestone-eta-01 ─────────────────────────────────────────────────
  registry.define(/^a burndown milestone with a forecast p50 date$/, (ctx) => {
    ctx.burndown = [{ milestone: 'M4', currentRemaining: 2, trend: { direction: 'unknown' }, dailySeries: [] }];
    ctx.forecasts = {
      tickets: [{ ticketId: 'BL-1', p50Iso: '2026-08-01T00:00:00Z', p85Iso: '2026-08-10T00:00:00Z' }],
      milestones: [{ milestone: 'M4', p50Iso: '2026-08-01T00:00:00Z', p85Iso: '2026-08-10T00:00:00Z' }],
      throughputPerDay: 0.5,
    };
    ctx.surface = ctx.surface || 'PWA dashboard';
  });

  registry.define(/^the burndown is rendered$/, (ctx) => {
    ctx.pwaBurndownText = renderPwaBurndown(ctx.burndown, ctx.forecasts);
    ctx.cliBurndownLine = cliBurndownLine(ctx.burndown, ctx.forecasts);
  });

  registry.define(/^that milestone shows its forecast ETA alongside its remaining count$/, (ctx) => {
    if (!/M4: 2 remaining — ETA 2026-08-01/.test(ctx.pwaBurndownText)) {
      throw new Error(`expected the PWA burndown to show the milestone ETA, got: ${ctx.pwaBurndownText}`);
    }
    if (!/M4 2 remaining \(ETA 2026-08-01/.test(ctx.cliBurndownLine)) {
      throw new Error(`expected the CLI burndown line to show the milestone ETA, got: ${ctx.cliBurndownLine}`);
    }
  });

  // ── backlog-eta-02 ───────────────────────────────────────────────────
  registry.define(/^open tickets across milestones with forecasts$/, (ctx) => {
    ctx.burndown = [
      { milestone: 'M4', currentRemaining: 2, trend: { direction: 'unknown' }, dailySeries: [] },
      { milestone: 'M5', currentRemaining: 3, trend: { direction: 'unknown' }, dailySeries: [] },
    ];
    ctx.forecasts = {
      tickets: [
        { ticketId: 'BL-1', p50Iso: '2026-08-01T00:00:00Z', p85Iso: null },
        { ticketId: 'BL-2', p50Iso: '2026-09-15T00:00:00Z', p85Iso: null },
      ],
      milestones: [
        { milestone: 'M4', p50Iso: '2026-08-01T00:00:00Z', p85Iso: null },
        { milestone: 'M5', p50Iso: '2026-09-15T00:00:00Z', p85Iso: null },
      ],
      throughputPerDay: 0.5,
    };
  });

  registry.define(
    /^an overall "all remaining work" ETA — the latest projected completion — is shown$/,
    (ctx) => {
      if (!/^Overall ETA: 2026-09-15/.test(ctx.pwaBurndownText)) {
        throw new Error(`expected the PWA overall ETA to be the latest (max) p50, got: ${ctx.pwaBurndownText}`);
      }
      if (!/overall ETA 2026-09-15$/.test(ctx.cliBurndownLine)) {
        throw new Error(`expected the CLI overall ETA to be the latest (max) p50, got: ${ctx.cliBurndownLine}`);
      }
    }
  );

  // ── no-eta-03 ────────────────────────────────────────────────────────
  registry.define(/^a burndown milestone whose forecast p50 is null for insufficient throughput or history$/, (ctx) => {
    ctx.burndown = [{ milestone: 'M4', currentRemaining: 2, trend: { direction: 'unknown' }, dailySeries: [] }];
    ctx.forecasts = { tickets: [], milestones: [{ milestone: 'M4', p50Iso: null, p85Iso: null }], throughputPerDay: 0 };
  });

  registry.define(
    /^that milestone shows a "no ETA yet" indication, never an infinite or fabricated date$/,
    (ctx) => {
      if (!/M4: 2 remaining — no ETA yet/.test(ctx.pwaBurndownText)) {
        throw new Error(`expected the PWA burndown to show "no ETA yet", got: ${ctx.pwaBurndownText}`);
      }
      if (!/M4 2 remaining \(no ETA yet\)/.test(ctx.cliBurndownLine)) {
        throw new Error(`expected the CLI burndown line to show "no ETA yet", got: ${ctx.cliBurndownLine}`);
      }
      if (/Invalid Date|NaN|Infinity/.test(ctx.pwaBurndownText + ctx.cliBurndownLine)) {
        throw new Error('expected no infinite/fabricated date, found one');
      }
    }
  );

  // ── both-surfaces-04 ─────────────────────────────────────────────────
  registry.define(/^the burndown is rendered on the (.+)$/, (ctx, surface) => {
    ctx.surface = surface;
    ctx.pwaBurndownText = renderPwaBurndown(ctx.burndown, ctx.forecasts);
    ctx.cliBurndownLine = cliBurndownLine(ctx.burndown, ctx.forecasts);
  });

  registry.define(/^the milestone ETA is present$/, (ctx) => {
    if (ctx.surface === 'PWA dashboard') {
      if (!/ETA 2026-08-01/.test(ctx.pwaBurndownText)) {
        throw new Error(`expected the PWA dashboard surface to show the milestone ETA, got: ${ctx.pwaBurndownText}`);
      }
    } else if (ctx.surface === 'swarm-metrics CLI') {
      if (!/ETA 2026-08-01/.test(ctx.cliBurndownLine)) {
        throw new Error(`expected the swarm-metrics CLI surface to show the milestone ETA, got: ${ctx.cliBurndownLine}`);
      }
    } else {
      throw new Error(`unknown surface: "${ctx.surface}"`);
    }
  });
}

// Exported for pwaLabelCatalogSteps.js: BL-229's own feature file
// independently uses the identical step text "the burndown is rendered"
// (both authored by the specifier, a genuine cross-ticket phrasing
// collision) - since stepRegistry.js's resolve() picks the FIRST matching
// pattern by registration order, that file's handler dispatches to these
// same functions when it detects a BL-228-shaped ctx, rather than two
// divergent implementations of the same render.
module.exports = { registerSteps, renderPwaBurndown, cliBurndownLine };
