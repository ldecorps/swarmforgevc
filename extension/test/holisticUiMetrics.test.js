const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { getHolisticUiHtml } = require('../out/bridge/holisticUiHtml');

// BL-211: renders the REAL getHolisticUiHtml() output in jsdom (mirroring
// test/helpers/renderPanel.js's and test/pwaDashboard.test.js's established
// pattern for asserting on real browser-facing behavior), fed fake bridge
// endpoint responses, so tests prove the metrics section actually renders
// from /metrics's JSON rather than restating the rendering logic by hand.

function emptyTrend() {
  return { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' };
}

function fakeMetrics(overrides = {}) {
  return {
    velocity: { weeklySeries: [{ periodStart: '2026-07-01T00:00:00Z', value: 3 }], trend: { direction: 'up', delta: 1, currentValue: 3, priorValue: 2, series: [] }, rollingWindowCount: 5, rollingWindowDays: 7 },
    burndown: [{ milestone: 'M4', currentRemaining: 2, trend: { direction: 'down', delta: -1, currentValue: 2, priorValue: 3, series: [] }, dailySeries: [{ periodStart: '2026-07-01T00:00:00Z', value: 3 }] }],
    cycleTime: { medianMs: 2 * 3600000, p85Ms: 4 * 3600000, sampleCount: 6, trend: emptyTrend(), weeklySeries: [] },
    forecasts: { tickets: [], milestones: [{ milestone: 'M4', p50Iso: '2026-08-01T00:00:00Z', p85Iso: '2026-08-05T00:00:00Z' }], throughputPerDay: 0.5 },
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
    }[url];
    if (url === '/events') {
      return Promise.reject(new Error('SSE not exercised in this test'));
    }
    if (body === undefined) {
      return Promise.reject(new Error('unexpected fetch: ' + url));
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
}

function renderWithToken(metrics) {
  const dom = new JSDOM(getHolisticUiHtml(), { runScripts: 'outside-only', url: 'http://127.0.0.1:9999/?token=test-token', pretendToBeVisual: true });
  dom.window.fetch = fakeFetchImpl(metrics);
  dom.window.eval(getHolisticUiHtml().match(/<script>([\s\S]*?)<\/script>/)[1]);
  return dom;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('the metrics section renders a burndown chart per milestone and a velocity chart from /metrics (charts-render-01)', async () => {
  const dom = renderWithToken(fakeMetrics());
  await flush();
  await flush();
  const section = dom.window.document.getElementById('metricsSection');
  assert.match(section.textContent, /Trailing 7d: 5 closed/);
  assert.match(section.textContent, /M4: 2 remaining/);
  assert.ok(section.querySelectorAll('svg').length >= 2, 'a velocity chart and at least one burndown chart must render as SVG');
});

test('trend arrows match each section\'s own direction (up/down) - the fixture varies them precisely so a swapped or dropped arrow is caught', async () => {
  const dom = renderWithToken(fakeMetrics());
  await flush();
  await flush();
  const text = dom.window.document.getElementById('metricsSection').textContent;
  // velocity.trend.direction: 'up'
  assert.match(text, /5 closed ▲/);
  // burndown[0].trend.direction: 'down'
  assert.match(text, /M4: 2 remaining ▼/);
});

test('every rendered metric value traces directly to the fetched JSON, not a UI-side computation (presentation-only-02)', async () => {
  const metrics = fakeMetrics();
  metrics.cycleTime.medianMs = 7 * 3600000;
  metrics.cycleTime.p85Ms = 9 * 3600000;
  metrics.cycleTime.sampleCount = 42;
  const dom = renderWithToken(metrics);
  await flush();
  await flush();
  assert.match(dom.window.document.getElementById('metricsSection').textContent, /median 7h, p85 9h over 42 ticket/);
});

test('a milestone forecast renders its p50/p85 dates straight from the endpoint', async () => {
  const dom = renderWithToken(fakeMetrics());
  await flush();
  await flush();
  assert.match(dom.window.document.getElementById('metricsSection').textContent, /M4: p50 2026-08-01 \/ p85 2026-08-05/);
});

test('"no local data" for suite duration renders an empty state, not an error (empty-state-03)', async () => {
  const dom = renderWithToken(fakeMetrics({ suiteDurationTrend: { hasLocalData: false, dailySeries: [], trend: emptyTrend() } }));
  await flush();
  await flush();
  assert.match(dom.window.document.getElementById('metricsSection').textContent, /no local data/);
});

// ── BL-252: suite-duration regression warn flag ───────────────────────────

test('a non-regressing suite duration (warn: false) renders with no WARN marker and no amber class', async () => {
  const dom = renderWithToken(fakeMetrics({
    suiteDurationTrend: { hasLocalData: true, dailySeries: [{ periodStart: '2026-07-09T00:00:00Z', value: 5000 }], trend: emptyTrend(), warn: false },
  }));
  await flush();
  await flush();
  const section = dom.window.document.getElementById('metricsSection');
  assert.match(section.textContent, /Suite duration: 5s latest/);
  assert.doesNotMatch(section.textContent, /WARN/);
  assert.equal(section.querySelector('.metric-value-warn'), null);
});

test('a regressing suite duration (warn: true, the SAME BL-078 signal) renders the amber WARN treatment', async () => {
  const dom = renderWithToken(fakeMetrics({
    suiteDurationTrend: { hasLocalData: true, dailySeries: [{ periodStart: '2026-07-09T00:00:00Z', value: 5000 }], trend: emptyTrend(), warn: true },
  }));
  await flush();
  await flush();
  const section = dom.window.document.getElementById('metricsSection');
  assert.match(section.textContent, /Suite duration \(WARN\): 5s latest/);
  const warnEl = section.querySelector('.metric-value-warn');
  assert.ok(warnEl, 'expected the amber .metric-value-warn treatment when warn is true');
});

test('an empty burndown array renders "no milestones" rather than an error', async () => {
  const dom = renderWithToken(fakeMetrics({ burndown: [] }));
  await flush();
  await flush();
  assert.match(dom.window.document.getElementById('metricsSection').textContent, /no milestones/);
});

test('a null cycle-time median renders "no closed tickets yet" rather than NaN', async () => {
  const dom = renderWithToken(fakeMetrics({ cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: emptyTrend(), weeklySeries: [] } }));
  await flush();
  await flush();
  const text = dom.window.document.getElementById('metricsSection').textContent;
  assert.match(text, /no closed tickets yet/);
  assert.doesNotMatch(text, /NaN/);
});
