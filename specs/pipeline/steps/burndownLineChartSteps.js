'use strict';

// BL-287: step handlers for "PWA burndown renders as a classic sprint line
// chart (remaining vs ideal)". Drives the REAL pwa/app.js in jsdom via
// render-burndown-chart.js (mirrors burndownEtaSteps.js's own
// render-dashboard-labels.js pattern - lives under extension/scripts/ so
// its require('jsdom') resolves against extension's own node_modules), fed
// a fixture backlog.json - no network, no live data.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const RENDER_SCRIPT = path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'render-burndown-chart.js');

function fakeBacklogFixture(burndown) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123',
    board: { active: [], paused: [], doneByMilestone: {} },
    notDoneCount: 0,
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown,
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts: { tickets: [], milestones: [], throughputPerDay: 0 },
    },
  };
}

function renderBurndownChart(burndown) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-burndown-linechart-'));
  const fixturePath = path.join(tmpDir, 'backlog.json');
  fs.writeFileSync(fixturePath, JSON.stringify(fakeBacklogFixture(burndown)));
  const out = execFileSync('node', [RENDER_SCRIPT, fixturePath, 'en'], { encoding: 'utf8' });
  return JSON.parse(out);
}

function steppedDailySeries() {
  return [
    { periodStart: '2026-07-01T00:00:00Z', value: 5 },
    { periodStart: '2026-07-02T00:00:00Z', value: 4 },
    { periodStart: '2026-07-03T00:00:00Z', value: 2 },
    { periodStart: '2026-07-04T00:00:00Z', value: 1 },
  ];
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the static backlog-dashboard PWA renders the burndown from each milestone's daily remaining series$/, () => {
    // Framing only - each scenario's own Given builds its fixture.
  });

  // ── burndown-line-01/02/04 (shared Given/When) ──────────────────────
  registry.define(/^a milestone with a daily series of remaining ticket counts$/, (ctx) => {
    ctx.burndown = [{ milestone: 'M4', currentRemaining: 1, trend: { direction: 'down' }, dailySeries: steppedDailySeries() }];
  });

  registry.define(/^the burndown chart renders$/, (ctx) => {
    ctx.result = renderBurndownChart(ctx.burndown);
  });

  // ── burndown-line-01 ─────────────────────────────────────────────────
  registry.define(/^the remaining counts are drawn as one connected line across the dates$/, (ctx) => {
    if (!ctx.result.hasSvg || ctx.result.hasBarRects) {
      throw new Error(`expected an SVG line chart, not bars, got: ${JSON.stringify(ctx.result)}`);
    }
    if (ctx.result.polylinePointCount !== ctx.burndown[0].dailySeries.length) {
      throw new Error(`expected one connected polyline point per daily-series entry, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── burndown-line-02 ─────────────────────────────────────────────────
  registry.define(/^date runs along the horizontal axis and remaining ticket count up the vertical axis$/, (ctx) => {
    const labels = ctx.result.axisLabels;
    const series = ctx.burndown[0].dailySeries;
    const firstDate = series[0].periodStart.slice(0, 10);
    const lastDate = series[series.length - 1].periodStart.slice(0, 10);
    if (!labels.includes(firstDate) || !labels.includes(lastDate)) {
      throw new Error(`expected dates along the horizontal axis, got: ${JSON.stringify(labels)}`);
    }
    if (!labels.includes(String(series[0].value)) || !labels.includes('0')) {
      throw new Error(`expected remaining counts up the vertical axis, got: ${JSON.stringify(labels)}`);
    }
  });

  // ── burndown-line-03 ─────────────────────────────────────────────────
  registry.define(/^a milestone whose remaining series starts above zero$/, (ctx) => {
    ctx.burndown = [{ milestone: 'M4', currentRemaining: 1, trend: { direction: 'down' }, dailySeries: steppedDailySeries() }];
  });

  registry.define(/^a dotted ideal line runs straight from the starting count down to zero across the same dates$/, (ctx) => {
    const ideal = ctx.result.idealLine;
    if (!ideal.present || !ideal.dashed) {
      throw new Error(`expected a dashed ideal line, got: ${JSON.stringify(ideal)}`);
    }
    if (ideal.y2 === ideal.y1) {
      throw new Error(`expected the ideal line to fall to zero, not stay flat, got: ${JSON.stringify(ideal)}`);
    }
  });

  // ── burndown-line-04 ─────────────────────────────────────────────────
  registry.define(/^a legend labels the solid remaining line and the dotted ideal line distinctly$/, (ctx) => {
    const { legend } = ctx.result;
    if (!legend.remainingText || !legend.idealText || legend.remainingText === legend.idealText) {
      throw new Error(`expected distinct legend labels for the remaining and ideal lines, got: ${JSON.stringify(legend)}`);
    }
  });

  // ── burndown-line-05 ─────────────────────────────────────────────────
  registry.define(/^no milestones with burndown data$/, (ctx) => {
    ctx.burndown = [];
  });

  registry.define(/^the burndown section is drawn$/, (ctx) => {
    ctx.result = renderBurndownChart(ctx.burndown);
  });

  registry.define(/^it shows the no-milestones message and draws no chart$/, (ctx) => {
    if (!/No milestones yet/.test(ctx.result.burndownText)) {
      throw new Error(`expected the no-milestones message, got: ${ctx.result.burndownText}`);
    }
    if (ctx.result.hasSvg) {
      throw new Error('expected no chart to be drawn when there is no milestone data');
    }
  });
}

module.exports = { registerSteps };
