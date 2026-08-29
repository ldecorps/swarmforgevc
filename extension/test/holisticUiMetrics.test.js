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

function fakeFetchImpl(metrics, trends) {
  return function (url) {
    const body = {
      '/pipeline': [],
      '/agents': [],
      '/backlog': { active: [], paused: [], done: [] },
      '/runlog': [],
      '/holistic': { assignments: [], swarms: [], doneByMilestone: {}, recentActivity: { recentCloses: [], recentMerges: [], currentRun: null } },
      '/metrics': metrics,
      '/burn-rate': {},
      // BL-603: the console now also fetches the behaviour-trend board.
      '/trends': trends || { series: [] },
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

function renderWithToken(metrics, trends) {
  const dom = new JSDOM(getHolisticUiHtml(), { runScripts: 'outside-only', url: 'http://127.0.0.1:9999/?token=test-token', pretendToBeVisual: true });
  dom.window.fetch = fakeFetchImpl(metrics, trends);
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

// ── BL-603: the trends board renderer, actually executed under JSDOM ──────
// trendsBoard.test.js only asserts on the raw HTML *source text*
// (renderTrendsBoard is never called), so a defect in the render logic
// itself - the wrong branch drawn, a dropped hasData check, a swapped arrow -
// is invisible to that file no matter how green it stays. These tests drive
// the real inline script against a non-empty /trends payload so the render
// branches actually execute.

function fakeTrend(overrides = {}) {
  return {
    series: [{ periodStart: '2026-08-27T00:00:00Z', value: 2 }, { periodStart: '2026-08-28T00:00:00Z', value: 5 }],
    currentValue: 5,
    priorValue: 2,
    delta: 3,
    direction: 'up',
    ...overrides,
  };
}

test('a series with data renders its label, producer, trend arrow and a bar chart - never the no-data paragraph', async () => {
  const trends = {
    series: [
      { id: 'human-loop-reliability', label: 'Human-loop reliability', producer: 'humanLoopReliability.ts', hasData: true, trend: fakeTrend() },
    ],
  };
  const dom = renderWithToken(fakeMetrics(), trends);
  await flush();
  await flush();
  const board = dom.window.document.getElementById('trendsBoard');
  const heading = board.querySelector('h4[data-series="human-loop-reliability"]');
  assert.ok(heading, 'expected an h4 anchored to the series id');
  assert.match(heading.textContent, /Human-loop reliability \(humanLoopReliability\.ts\) ▲/);
  assert.ok(board.querySelector('svg'), 'expected a bar chart svg for a series with data');
  assert.doesNotMatch(board.textContent, /no data yet/);
});

test('a series with no data renders "no data yet" and draws no chart for it - hasData governs the branch, not the point count', async () => {
  const trends = {
    series: [
      // hasData:false paired with a non-"unknown" trend direction: a
      // ternary that dropped the hasData check (and called trendArrow
      // unconditionally) would still print an arrow here, since trendArrow
      // itself only special-cases direction === 'unknown'. Only checking
      // hasData distinguishes the two.
      { id: 'human-decision-latency', label: 'Human decision latency', producer: 'humanDecisionLatency.ts', hasData: false, trend: fakeTrend({ direction: 'up' }) },
    ],
  };
  const dom = renderWithToken(fakeMetrics(), trends);
  await flush();
  await flush();
  const board = dom.window.document.getElementById('trendsBoard');
  const heading = board.querySelector('h4[data-series="human-decision-latency"]');
  assert.ok(heading, 'expected an h4 anchored to the series id');
  // No arrow for a no-data series - hasData ? trendArrow(...) : ''.
  assert.equal(heading.textContent, 'Human decision latency (humanDecisionLatency.ts)');
  assert.match(board.textContent, /no data yet/);
  assert.equal(board.querySelectorAll('svg').length, 0, 'a no-data series must draw no chart');
});

test('multiple series each render their own heading and chart in registry order, none skipped or merged', async () => {
  const trends = {
    series: [
      { id: 'first-series', label: 'First', producer: 'first.ts', hasData: true, trend: fakeTrend({ direction: 'down' }) },
      { id: 'second-series', label: 'Second', producer: 'second.ts', hasData: false, trend: emptyTrend() },
      { id: 'third-series', label: 'Third', producer: 'third.ts', hasData: true, trend: fakeTrend({ direction: 'flat' }) },
    ],
  };
  const dom = renderWithToken(fakeMetrics(), trends);
  await flush();
  await flush();
  const board = dom.window.document.getElementById('trendsBoard');
  const headings = [...board.querySelectorAll('h4')].map((h) => h.getAttribute('data-series'));
  assert.deepEqual(headings, ['first-series', 'second-series', 'third-series']);
  assert.match(board.querySelector('h4[data-series="first-series"]').textContent, /▼$/);
  assert.match(board.querySelector('h4[data-series="third-series"]').textContent, /▬$/);
  assert.equal(board.querySelectorAll('svg').length, 2, 'exactly the two hasData series draw a chart');
});

test('an empty trends payload renders "no series registered" and no chart', async () => {
  const dom = renderWithToken(fakeMetrics(), { series: [] });
  await flush();
  await flush();
  const board = dom.window.document.getElementById('trendsBoard');
  assert.match(board.textContent, /no series registered/);
  assert.equal(board.querySelectorAll('svg').length, 0);
  assert.equal(board.querySelectorAll('h4').length, 0);
});
