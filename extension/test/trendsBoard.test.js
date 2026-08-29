'use strict';

// BL-603: the behaviour-trend board published on the live holistic console.

const assert = require('node:assert/strict');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  loadPointsSafely,
  sumPointsByPeriod,
  meanPointsByPeriod,
} = require('../out/metrics/trendsBoard');
const { TRENDS_BOARD_SERIES, registeredSeriesIds } = require('../out/metrics/trendsBoardRegistry');
const { buildTrendsBoardState } = require('../out/bridge/bridgeState');
const { getHolisticUiHtml } = require('../out/bridge/holisticUiHtml');

const FIXTURE_PREFIX = 'bl603-trends-';

// BL-420: every temp dir goes through the shared helper, which registers it
// for the suite's own afterEach sweep - no hand-rolled mkdtemp/cleanup here.
function withFixture(run) {
  return run(mkTmpDir(FIXTURE_PREFIX));
}

const EMPTY_SERIES = { id: 'empty', label: 'Empty', producer: 'none.ts', loadPoints: () => [] };

// ── trends-published-on-mini-app-01 ─────────────────────────────────────

test('every registered series has a place on the board', () => {
  withFixture((dir) => {
    const payload = buildTrendsBoardState(dir, Date.parse('2026-08-29T12:00:00.000Z'));
    assert.deepEqual(
      payload.series.map((s) => s.id),
      registeredSeriesIds()
    );
  });
});

test('the nine BL-594 series named by the ticket are all registered', () => {
  assert.deepEqual(registeredSeriesIds().slice().sort(), [
    'compaction-cadence',
    'false-alarm-rate',
    'global-token-tokens',
    'handoff-latency',
    'human-decision-latency',
    'human-loop-reliability',
    'intake-balance',
    'mono-router-rotation',
    'self-heal-events',
  ]);
});

test('each series carries the producer module it comes from', () => {
  const byId = new Map(TRENDS_BOARD_SERIES.map((s) => [s.id, s.producer]));
  assert.equal(byId.get('self-heal-events'), 'selfHealTelemetry.ts');
  assert.equal(byId.get('global-token-tokens'), 'globalTokenConsumption.ts');
});

test("a series' plot is computed through the shared trend framework", () => {
  const points = [
    { periodStart: '2026-08-27T00:00:00.000Z', value: 2 },
    { periodStart: '2026-08-28T00:00:00.000Z', value: 5 },
  ];
  withFixture((dir) => {
    const payload = buildTrendsBoardState(dir, 0, [
      { id: 'pinned', label: 'Pinned', producer: 'test', loadPoints: () => points },
    ]);
    const trend = payload.series[0].trend;
    // computeTrend's own {current, prior, delta, direction} summary shape -
    // not recomputed here, which is the point.
    assert.deepEqual(trend.series, points);
    assert.equal(trend.currentValue, 5);
    assert.equal(trend.priorValue, 2);
    assert.equal(trend.delta, 3);
    assert.equal(trend.direction, 'up');
  });
});

// ── trends-published-on-mini-app-02 ─────────────────────────────────────

test('a series with nothing to plot reads as no data and fabricates no point', () => {
  withFixture((dir) => {
    const payload = buildTrendsBoardState(dir, 0, [EMPTY_SERIES]);
    const series = payload.series[0];
    assert.equal(series.hasData, false);
    assert.deepEqual(series.trend.series, []);
    assert.equal(series.trend.currentValue, null);
    assert.equal(series.trend.priorValue, null);
    assert.equal(series.trend.delta, null);
    assert.equal(series.trend.direction, 'unknown');
  });
});

test('a producer whose module throws degrades to no data, never a crash', () => {
  const exploding = {
    id: 'exploding',
    label: 'Exploding',
    producer: 'not-landed.ts',
    loadPoints: () => {
      throw new Error('producer module has not landed');
    },
  };
  assert.deepEqual(loadPointsSafely(exploding, { targetPath: '/nowhere', nowMs: 0 }), []);
  withFixture((dir) => {
    const payload = buildTrendsBoardState(dir, 0, [exploding]);
    assert.equal(payload.series[0].hasData, false);
    assert.deepEqual(payload.series[0].trend.series, []);
  });
});

test('a board over an empty target renders every series without error', () => {
  withFixture((dir) => {
    const payload = buildTrendsBoardState(dir, Date.parse('2026-08-29T12:00:00.000Z'));
    assert.equal(payload.series.length, TRENDS_BOARD_SERIES.length);
    for (const series of payload.series) {
      assert.equal(series.hasData, false, `${series.id} should read as no data on an empty target`);
      assert.deepEqual(series.trend.series, []);
    }
  });
});

test('self-heal-events reads as no data while its producer has recorded nothing', () => {
  withFixture((dir) => {
    const payload = buildTrendsBoardState(dir, Date.parse('2026-08-29T12:00:00.000Z'));
    const selfHeal = payload.series.find((s) => s.id === 'self-heal-events');
    assert.equal(selfHeal.hasData, false);
    assert.deepEqual(selfHeal.trend.series, []);
  });
});

// ── trends-published-on-mini-app-03 ─────────────────────────────────────

test('the trends board offers no control that mutates state', () => {
  const html = getHolisticUiHtml();
  const board = html.slice(html.indexOf('renderTrendsBoard'), html.indexOf('function renderBacklogBoard'));
  assert.ok(board.length > 0, 'expected the trends renderer in the page');
  for (const token of ['<form', '<button', '<input', "method: 'POST'", 'onclick', 'fetch(']) {
    assert.ok(!board.includes(token), `trends board must not contain ${token}`);
  }
});

// ── trends-published-on-mini-app-04 ─────────────────────────────────────

test('a newly registered series appears without editing the renderer', () => {
  const tenth = {
    id: 'tenth-series',
    label: 'Tenth series',
    producer: 'tenth.ts',
    loadPoints: () => [{ periodStart: '2026-08-28T00:00:00.000Z', value: 7 }],
  };
  withFixture((dir) => {
    const payload = buildTrendsBoardState(dir, 0, [...TRENDS_BOARD_SERIES, tenth]);
    const found = payload.series.find((s) => s.id === 'tenth-series');
    assert.ok(found, 'the newly registered series must appear on the board');
    assert.equal(found.hasData, true);
    assert.equal(found.trend.currentValue, 7);
  });
  // The renderer maps over the payload; no per-series list exists to edit.
  const html = getHolisticUiHtml();
  for (const id of registeredSeriesIds()) {
    assert.ok(!html.includes("'" + id + "'"), `renderer must not name series ${id}`);
  }
});

// ── combine helpers ─────────────────────────────────────────────────────

test('sumPointsByPeriod totals counts per period without back-filling zeros', () => {
  const combined = sumPointsByPeriod([
    [
      { periodStart: '2026-08-27T00:00:00.000Z', value: 2 },
      { periodStart: '2026-08-28T00:00:00.000Z', value: 1 },
    ],
    [{ periodStart: '2026-08-28T00:00:00.000Z', value: 4 }],
  ]);
  assert.deepEqual(combined, [
    { periodStart: '2026-08-27T00:00:00.000Z', value: 2 },
    { periodStart: '2026-08-28T00:00:00.000Z', value: 5 },
  ]);
});

test('meanPointsByPeriod averages only over the inputs that recorded a period', () => {
  const combined = meanPointsByPeriod([
    [{ periodStart: '2026-08-28T00:00:00.000Z', value: 10 }],
    [{ periodStart: '2026-08-28T00:00:00.000Z', value: 20 }],
    [{ periodStart: '2026-08-27T00:00:00.000Z', value: 5 }],
  ]);
  assert.deepEqual(combined, [
    { periodStart: '2026-08-27T00:00:00.000Z', value: 5 },
    { periodStart: '2026-08-28T00:00:00.000Z', value: 15 },
  ]);
});

test('both combine helpers return nothing for no inputs', () => {
  assert.deepEqual(sumPointsByPeriod([]), []);
  assert.deepEqual(meanPointsByPeriod([]), []);
  assert.deepEqual(sumPointsByPeriod([[], []]), []);
  assert.deepEqual(meanPointsByPeriod([[], []]), []);
});
