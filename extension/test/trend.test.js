const assert = require('node:assert/strict');
const { computeTrend } = require('../out/metrics/trend');

// BL-096 metrics-06: one shared pure function applied uniformly to every
// series (velocity, burndown, cycle time, suite duration all reuse this).

test('computeTrend on an empty series reports unknown direction and null values', () => {
  const result = computeTrend([]);
  assert.deepEqual(result, { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' });
});

test('computeTrend on a single-point series reports the current value but no prior/delta', () => {
  const series = [{ periodStart: '2026-01-01', value: 5 }];
  const result = computeTrend(series);
  assert.equal(result.currentValue, 5);
  assert.equal(result.priorValue, null);
  assert.equal(result.delta, null);
  assert.equal(result.direction, 'unknown');
});

test('computeTrend reports up when the latest point is greater than the prior one', () => {
  const series = [
    { periodStart: '2026-01-01', value: 3 },
    { periodStart: '2026-01-08', value: 4 },
  ];
  const result = computeTrend(series);
  assert.equal(result.currentValue, 4);
  assert.equal(result.priorValue, 3);
  assert.equal(result.delta, 1);
  assert.equal(result.direction, 'up');
});

test('computeTrend reports down when the latest point is less than the prior one', () => {
  const series = [
    { periodStart: '2026-01-01', value: 10 },
    { periodStart: '2026-01-08', value: 6 },
  ];
  const result = computeTrend(series);
  assert.equal(result.delta, -4);
  assert.equal(result.direction, 'down');
});

test('computeTrend reports flat when the latest point equals the prior one', () => {
  const series = [
    { periodStart: '2026-01-01', value: 7 },
    { periodStart: '2026-01-08', value: 7 },
  ];
  const result = computeTrend(series);
  assert.equal(result.delta, 0);
  assert.equal(result.direction, 'flat');
});

test('computeTrend only compares the last two points of a longer series', () => {
  const series = [
    { periodStart: '2026-01-01', value: 1 },
    { periodStart: '2026-01-08', value: 100 },
    { periodStart: '2026-01-15', value: 8 },
    { periodStart: '2026-01-22', value: 9 },
  ];
  const result = computeTrend(series);
  assert.equal(result.currentValue, 9);
  assert.equal(result.priorValue, 8);
  assert.equal(result.delta, 1);
  assert.equal(result.direction, 'up');
});

test('computeTrend returns the series unchanged (echoed) alongside the summary', () => {
  const series = [
    { periodStart: '2026-01-01', value: 1 },
    { periodStart: '2026-01-08', value: 2 },
  ];
  const result = computeTrend(series);
  assert.deepEqual(result.series, series);
});
