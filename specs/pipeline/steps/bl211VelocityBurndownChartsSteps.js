'use strict';

// BL-1941 (BL-211 stamp-off): step handlers for "BL-096 delivery metrics are
// charted in the BL-094 web UI". Drives the REAL getHolisticUiHtml() output
// (extension/out/bridge/holisticUiHtml.js) in jsdom, fed a fake /metrics
// endpoint response - mirroring extension/test/holisticUiMetrics.test.js's
// own established pattern (same renderWithToken shape), never a
// restatement of the metrics-section rendering logic.

const assert = require('node:assert/strict');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const JSDOM_MODULE = path.join(EXT_DIR, 'node_modules', 'jsdom');

function JSDOMClass() {
  return require(JSDOM_MODULE).JSDOM;
}

let _holisticUiModule = null;
function holisticUiModule() {
  if (!_holisticUiModule) _holisticUiModule = require(path.join(EXT_DIR, 'out', 'bridge', 'holisticUiHtml.js'));
  return _holisticUiModule;
}

function emptyTrend() {
  return { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' };
}

function fakeMetrics(overrides = {}) {
  return {
    velocity: {
      weeklySeries: [{ periodStart: '2026-09-01T00:00:00Z', value: 5 }],
      trend: { direction: 'up', delta: 1, currentValue: 5, priorValue: 4, series: [] },
      rollingWindowCount: 5,
      rollingWindowDays: 7,
    },
    burndown: [
      { milestone: 'M9', currentRemaining: 2, trend: { direction: 'down', delta: -1, currentValue: 2, priorValue: 3, series: [] }, dailySeries: [{ periodStart: '2026-09-01T00:00:00Z', value: 3 }] },
    ],
    cycleTime: { medianMs: 2 * 3600000, p85Ms: 4 * 3600000, sampleCount: 6, trend: emptyTrend(), weeklySeries: [] },
    forecasts: { tickets: [], milestones: [], throughputPerDay: 0.5 },
    suiteDurationTrend: { hasLocalData: false, dailySeries: [], trend: emptyTrend() },
    ...overrides,
  };
}

function fakeFetchImpl(metrics) {
  return function (url) {
    const body = {
      '/pipeline': [],
      '/agents': [],
      '/backlog': { active: [], paused: [], done: [] },
      '/runlog': [],
      '/holistic': { assignments: [], swarms: [], doneByMilestone: {}, recentActivity: { recentCloses: [], recentMerges: [], currentRun: null } },
      '/metrics': metrics,
      '/burn-rate': {},
      '/trends': { series: [] },
    }[url];
    if (url === '/events') {
      return Promise.reject(new Error('SSE not exercised in this handler'));
    }
    if (body === undefined) {
      return Promise.reject(new Error('unexpected fetch: ' + url));
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
}

function renderWithToken(metrics) {
  const JSDOM = JSDOMClass();
  const html = holisticUiModule().getHolisticUiHtml();
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://127.0.0.1:9999/?token=test-token', pretendToBeVisual: true });
  dom.window.fetch = fakeFetchImpl(metrics);
  dom.window.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  return dom;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const FEATURE = 'BL-096 delivery metrics are charted in the BL-094 web UI';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── charts-render-01 ────────────────────────────────────────────────
  scoped(/^the bridge is running with BL-096 metrics and the web UI is open$/, async (ctx) => {
    ctx.metrics = fakeMetrics();
    ctx.dom = renderWithToken(ctx.metrics);
    await flush();
    await flush();
  });

  scoped(/^the metrics section loads$/, async () => {
    // The Given already drove the real inline script through its fetch of
    // /metrics; this step names the moment, nothing further to trigger.
  });

  scoped(/^a burndown chart per milestone and a velocity chart render from the endpoint's JSON$/, (ctx) => {
    const section = ctx.dom.window.document.getElementById('metricsSection');
    assert.match(section.textContent, /Trailing 7d: 5 closed/);
    assert.match(section.textContent, /M9: 2 remaining/);
    assert.ok(section.querySelectorAll('svg').length >= 2, 'a velocity chart and at least one burndown chart must render as SVG');
  });

  // ── presentation-only-02 ────────────────────────────────────────────
  scoped(/^the metrics section is displayed$/, async (ctx) => {
    ctx.metrics = fakeMetrics();
    ctx.metrics.cycleTime.medianMs = 7 * 3600000;
    ctx.metrics.cycleTime.p85Ms = 9 * 3600000;
    ctx.metrics.cycleTime.sampleCount = 42;
    ctx.dom = renderWithToken(ctx.metrics);
    await flush();
    await flush();
  });

  scoped(/^it renders a chart$/, async () => {
    // Rendering already happened on open above - this step names the
    // moment the UI has something on screen to inspect.
  });

  scoped(/^every value shown comes from the endpoint's JSON, with no computation in the UI$/, (ctx) => {
    const text = ctx.dom.window.document.getElementById('metricsSection').textContent;
    assert.match(text, /median 7h, p85 9h over 42 ticket/);
  });

  // ── empty-state-03 ──────────────────────────────────────────────────
  scoped(/^the endpoint reports "no local data" for a metric$/, async (ctx) => {
    ctx.metrics = fakeMetrics({ suiteDurationTrend: { hasLocalData: false, dailySeries: [], trend: emptyTrend() } });
    ctx.dom = renderWithToken(ctx.metrics);
    await flush();
    await flush();
  });

  scoped(/^the metrics section renders that metric$/, async () => {
    // Already rendered on open above - this step names the moment.
  });

  scoped(/^it shows an empty or "no data" state without error$/, (ctx) => {
    const text = ctx.dom.window.document.getElementById('metricsSection').textContent;
    assert.match(text, /no local data/);
  });
}

module.exports = { registerSteps };
