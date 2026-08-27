'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  totalTokensFromRecord,
  aggregateGlobalTokenBuckets,
  summarizeGlobalTokenWindow,
  globalTokenTrendSeries,
  computeGlobalTokenConsumptionFromTranscripts,
} = require('../out/metrics/globalTokenConsumption');
const { trendForGlobalTokenConsumption } = require('../out/metrics/trend');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-07-09T08:00:00.000Z');

function record(roleOffset, tokens, atMs = T0) {
  return {
    messageId: `m-${roleOffset}-${atMs}`,
    timestampMs: atMs,
    model: 'claude-sonnet-5',
    usage: {
      inputTokens: tokens,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    },
  };
}

test('totalTokensFromRecord sums input, output, and cache fields', () => {
  const total = totalTokensFromRecord({
    messageId: 'x',
    timestampMs: T0,
    model: 'm',
    usage: { inputTokens: 10, outputTokens: 20, cacheCreationTokens: 3, cacheReadTokens: 7 },
  });
  assert.equal(total, 40);
});

test('aggregateGlobalTokenBuckets sums every role per bucket', () => {
  const buckets = aggregateGlobalTokenBuckets({
    recordsByRole: {
      coder: [record('c', 100, T0), record('c', 50, T0 + HOUR)],
      cleaner: [record('cl', 200, T0)],
    },
    expectedRoles: ['coder', 'cleaner'],
    bucketMs: DAY,
  });
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].totalTokens, 350);
  assert.equal(buckets[0].incomplete, false);
});

test('aggregateGlobalTokenBuckets marks bucket incomplete when a role has no records in it', () => {
  const buckets = aggregateGlobalTokenBuckets({
    recordsByRole: {
      coder: [record('c', 100, T0)],
      cleaner: [],
    },
    expectedRoles: ['coder', 'cleaner'],
    bucketMs: DAY,
  });
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].incomplete, true);
  assert.equal(buckets[0].totalTokens, null);
});

test('summarizeGlobalTokenWindow reports cumulative total and rate', () => {
  const windowStart = T0;
  const windowEnd = T0 + HOUR;
  const summary = summarizeGlobalTokenWindow({
    recordsByRole: {
      coder: [record('c', 120, T0 + 30 * 60 * 1000)],
      cleaner: [record('cl', 180, T0 + 45 * 60 * 1000)],
    },
    expectedRoles: ['coder', 'cleaner'],
    windowStartMs: windowStart,
    windowEndMs: windowEnd,
  });
  assert.equal(summary.cumulativeTotalTokens, 300);
  assert.equal(summary.rateTokensPerHour, 300);
  assert.equal(summary.incomplete, false);
});

test('computeGlobalTokenConsumptionFromTranscripts ignores ledger-shaped inputs', () => {
  const result = computeGlobalTokenConsumptionFromTranscripts({
    recordsByRole: { coder: [record('c', 50, T0)] },
    expectedRoles: ['coder'],
    bucketMs: DAY,
    ledgerRecords: [
      {
        type: 'llm_invocation',
        at: '2026-07-09T08:30:00.000Z',
        model: 'x',
        tokens: null,
        costUsd: null,
        origin: { subsystem: 'pipeline', role: 'coder', stage: null, trigger: 'handoff', ticketId: null, handoffId: null, handoffType: null, script: null, pack: null, model: null, provider: null },
      },
    ],
  });
  assert.equal(result.buckets[0].totalTokens, 50);
});

test('globalTokenTrendSeries omits incomplete buckets', () => {
  const series = globalTokenTrendSeries([
    { bucketStartMs: T0, periodStart: new Date(T0).toISOString(), totalTokens: 10, incomplete: false },
    { bucketStartMs: T0 + DAY, periodStart: new Date(T0 + DAY).toISOString(), totalTokens: null, incomplete: true },
  ]);
  assert.equal(series.length, 1);
  assert.equal(series[0].value, 10);
});

test('trendForGlobalTokenConsumption is exported from trend.ts', () => {
  const trend = trendForGlobalTokenConsumption([
    { bucketStartMs: T0, periodStart: new Date(T0).toISOString(), totalTokens: 10, incomplete: false },
    { bucketStartMs: T0 + DAY, periodStart: new Date(T0 + DAY).toISOString(), totalTokens: 20, incomplete: false },
  ]);
  assert.equal(trend.currentValue, 20);
  assert.equal(trend.priorValue, 10);
});
