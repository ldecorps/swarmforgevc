'use strict';

const assert = require('node:assert/strict');
const {
  deriveCompactionRecordFromContextEvent,
  deriveCompactionRecords,
  aggregateCompactionCadence,
  queryCompactionCadenceForRole,
  trendForCompactionCadencePerHour,
} = require('../out/metrics/compactionCadence');

test('deriveCompactionRecordFromContextEvent emits role model tokens and timestamp', () => {
  const record = deriveCompactionRecordFromContextEvent({
    role: 'coder',
    model: 'claude-sonnet-5',
    timestamp: '2026-08-27T06:00:00Z',
    compaction: true,
    contextUtilizationPct: 92,
    inputTokens: 180000,
  });
  assert.ok(record);
  assert.equal(record.role, 'coder');
  assert.equal(record.model, 'claude-sonnet-5');
  assert.equal(record.tokensAtCompaction, 180000);
  assert.equal(record.timestamp, '2026-08-27T06:00:00Z');
});

test('non-compaction context events emit no record', () => {
  const record = deriveCompactionRecordFromContextEvent({
    role: 'coder',
    model: 'claude-sonnet-5',
    timestamp: '2026-08-27T06:00:00Z',
    compaction: false,
    contextUtilizationPct: 50,
    inputTokens: 10000,
  });
  assert.equal(record, null);
});

test('pane spinner text alone does not emit compaction records', () => {
  const records = deriveCompactionRecords({
    spinnerText: 'auto-compact 92%',
    contextEvents: [],
  });
  assert.deepEqual(records, []);
});

test('aggregateCompactionCadence reports compactions per hour and token distribution', () => {
  const records = [
    {
      role: 'coder',
      model: 'claude-sonnet-5',
      tokensAtCompaction: 180000,
      timestamp: '2026-08-27T06:00:00Z',
      timestampMs: Date.parse('2026-08-27T06:00:00Z'),
    },
    {
      role: 'coder',
      model: 'claude-sonnet-5',
      tokensAtCompaction: 190000,
      timestamp: '2026-08-27T18:00:00Z',
      timestampMs: Date.parse('2026-08-27T18:00:00Z'),
    },
    {
      role: 'QA',
      model: 'gpt-5',
      tokensAtCompaction: 95000,
      timestamp: '2026-08-28T07:00:00Z',
      timestampMs: Date.parse('2026-08-28T07:00:00Z'),
    },
  ];
  const nowMs = Date.parse('2026-08-29T00:00:00Z');
  const agg = aggregateCompactionCadence(records, ['coder', 'QA'], nowMs);
  const coder = agg.find((series) => series.role === 'coder');
  assert.ok(coder?.applicable);
  assert.ok(coder.windows.length >= 2);
  const day = coder.windows.find((window) => window.compactionCount === 2);
  assert.ok(day);
  assert.equal(day.compactionsPerHour, 2 / 24);
  assert.equal(day.tokenDistribution.min, 180000);
  assert.equal(day.tokenDistribution.max, 190000);
});

test('undetectable roles read NA not zero compactions', () => {
  const series = queryCompactionCadenceForRole(
    'documenter',
    [],
    ['coder', 'QA'],
    Date.parse('2026-08-29T00:00:00Z')
  );
  assert.equal(series.applicable, false);
  assert.equal(series.windows.length, 0);
});

test('trendForCompactionCadencePerHour reports current prior delta and direction', () => {
  const windows = [
    {
      periodStart: '2026-08-27T00:00:00.000Z',
      compactionsPerHour: 0.1,
      tokenDistribution: { min: null, max: null, median: null, values: [] },
      compactionCount: 0,
    },
    {
      periodStart: '2026-08-28T00:00:00.000Z',
      compactionsPerHour: 0.2,
      tokenDistribution: { min: null, max: null, median: null, values: [] },
      compactionCount: 0,
    },
  ];
  const trend = trendForCompactionCadencePerHour(windows);
  assert.equal(trend.currentValue, 0.2);
  assert.equal(trend.priorValue, 0.1);
  assert.equal(trend.direction, 'up');
});
