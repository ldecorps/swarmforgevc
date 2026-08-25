const assert = require('node:assert/strict');
const {
  LLM_COST_HORIZONS_MS,
  isKnownLlmCostHorizon,
  rankLlmInvocations,
  rollupLlmInvocationsByOrigin,
  DEFAULT_ORIGIN_COST_TREND_BANDS,
  buildOriginCostTrendSeries,
  chooseCostTrendAxisScale,
} = require('../out/metrics/llmCostLedger');

function origin(overrides = {}) {
  return {
    subsystem: 'pipeline',
    role: 'coder',
    stage: 'coder',
    trigger: 'handoff',
    ticketId: 'BL-551',
    handoffId: 'h1',
    handoffType: 'git_handoff',
    script: null,
    pack: 'openrouter-anthropic-mono-router',
    model: 'claude-sonnet-5',
    provider: 'claude',
    ...overrides,
  };
}

function invocation(overrides = {}) {
  return {
    type: 'llm_invocation',
    at: '2026-07-22T12:00:00Z',
    model: 'claude-sonnet-5',
    tokens: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 },
    costUsd: 1,
    origin: origin(),
    ...overrides,
  };
}

// ── schema-01 ────────────────────────────────────────────────────────────

test('every llm_invocation record carries origin attribution for where the spend came from (schema-01)', () => {
  const record = invocation();
  const requiredFields = [
    'subsystem', 'role', 'stage', 'trigger', 'ticketId', 'handoffId',
    'handoffType', 'script', 'pack', 'model', 'provider',
  ];
  for (const field of requiredFields) {
    assert.ok(Object.prototype.hasOwnProperty.call(record.origin, field), `origin missing ${field}`);
  }
});

// ── named horizons ───────────────────────────────────────────────────────

test('named horizons are fixed 3h/24h/7d millisecond windows', () => {
  assert.equal(LLM_COST_HORIZONS_MS['3h'], 3 * 60 * 60 * 1000);
  assert.equal(LLM_COST_HORIZONS_MS['24h'], 24 * 60 * 60 * 1000);
  assert.equal(LLM_COST_HORIZONS_MS['7d'], 7 * 24 * 60 * 60 * 1000);
});

test('isKnownLlmCostHorizon rejects a horizon that is not one of the named three', () => {
  assert.equal(isKnownLlmCostHorizon('24h'), true);
  assert.equal(isKnownLlmCostHorizon('30m'), false);
});

// ── rank-single-04 ───────────────────────────────────────────────────────

test('top expensive calls in the last 3 hours are ranked by cost descending, excluding records outside the window (rank-single-04)', () => {
  const nowMs = Date.parse('2026-07-22T12:00:00Z');
  const inside = [
    invocation({ at: '2026-07-22T11:00:00Z', costUsd: 2 }),
    invocation({ at: '2026-07-22T10:00:00Z', costUsd: 5 }),
  ];
  const outside = invocation({ at: '2026-07-22T08:00:00Z', costUsd: 100 });
  const result = rankLlmInvocations([...inside, outside], { horizonMs: LLM_COST_HORIZONS_MS['3h'], nowMs });

  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records.map((r) => r.costUsd), [5, 2]);
});

test('unknown-cost records rank after every priced row regardless of magnitude (rank-single-04)', () => {
  const nowMs = Date.parse('2026-07-22T12:00:00Z');
  const records = [
    invocation({ at: '2026-07-22T11:00:00Z', costUsd: null }),
    invocation({ at: '2026-07-22T11:30:00Z', costUsd: 1 }),
  ];
  const result = rankLlmInvocations(records, { horizonMs: LLM_COST_HORIZONS_MS['3h'], nowMs });

  assert.equal(result.records[0].costUsd, 1);
  assert.equal(result.records[1].costUsd, null);
});

test('a record with an unparseable timestamp is excluded from the window, never treated as always-in-range (rank-single-04)', () => {
  const nowMs = Date.parse('2026-07-22T12:00:00Z');
  const records = [
    invocation({ at: 'not-a-timestamp', costUsd: 100 }),
    invocation({ at: '2026-07-22T11:30:00Z', costUsd: 1 }),
  ];
  const result = rankLlmInvocations(records, { horizonMs: LLM_COST_HORIZONS_MS['3h'], nowMs });

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].costUsd, 1);
});

test('two unknown-cost records within the same window tie-break by timestamp descending, most recent first (rank-single-04)', () => {
  const nowMs = Date.parse('2026-07-22T12:00:00Z');
  const records = [
    invocation({ at: '2026-07-22T10:00:00Z', costUsd: null }),
    invocation({ at: '2026-07-22T11:00:00Z', costUsd: null }),
  ];
  const result = rankLlmInvocations(records, { horizonMs: LLM_COST_HORIZONS_MS['3h'], nowMs });

  assert.deepEqual(result.records.map((r) => r.at), ['2026-07-22T11:00:00Z', '2026-07-22T10:00:00Z']);
});

// ── rank-horizons-05 ─────────────────────────────────────────────────────

for (const horizon of ['3h', '24h', '7d']) {
  test(`each named horizon (${horizon}) ranks independently and only includes records inside its window (rank-horizons-05)`, () => {
    const nowMs = Date.parse('2026-07-22T12:00:00Z');
    const records = [
      invocation({ at: '2026-07-22T11:30:00Z' }), // 30 min ago — inside all
      invocation({ at: '2026-07-21T13:00:00Z' }), // ~23h ago — outside 3h, inside 24h/7d
      invocation({ at: '2026-07-19T12:00:00Z' }), // 3 days ago — outside 3h/24h, inside 7d
      invocation({ at: '2026-07-14T12:00:00Z' }), // 8 days ago — outside all
    ];
    const result = rankLlmInvocations(records, { horizonMs: LLM_COST_HORIZONS_MS[horizon], nowMs });

    const expectedCounts = { '3h': 1, '24h': 2, '7d': 3 };
    assert.equal(result.records.length, expectedCounts[horizon]);
  });
}

// ── group-by-06 ──────────────────────────────────────────────────────────

test('rollups group spend by origin trigger and role, summing cost and count, ordered by summed cost descending (group-by-06)', () => {
  const nowMs = Date.parse('2026-07-22T12:00:00Z');
  const records = [
    invocation({ at: '2026-07-22T11:00:00Z', costUsd: 1, origin: origin({ trigger: 'handoff', role: 'coder' }) }),
    invocation({ at: '2026-07-22T11:10:00Z', costUsd: 2, origin: origin({ trigger: 'handoff', role: 'coder' }) }),
    invocation({ at: '2026-07-22T11:20:00Z', costUsd: 10, origin: origin({ trigger: 'chase_nudge', role: 'qa' }) }),
  ];
  const groups = rollupLlmInvocationsByOrigin(records, {
    horizonMs: LLM_COST_HORIZONS_MS['24h'],
    nowMs,
    groupBy: ['trigger', 'role'],
  });

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].key, { trigger: 'chase_nudge', role: 'qa' });
  assert.equal(groups[0].costUsd, 10);
  assert.equal(groups[0].invocationCount, 1);
  assert.deepEqual(groups[1].key, { trigger: 'handoff', role: 'coder' });
  assert.equal(groups[1].costUsd, 3);
  assert.equal(groups[1].invocationCount, 2);
});

// ── unknown-cost-07 ──────────────────────────────────────────────────────

test('unknown-cost invocations are excluded from the dollar total, never counted as zero (unknown-cost-07)', () => {
  const nowMs = Date.parse('2026-07-22T12:00:00Z');
  const records = [
    invocation({ at: '2026-07-22T11:00:00Z', costUsd: 4 }),
    invocation({ at: '2026-07-22T11:05:00Z', costUsd: null }),
  ];
  const result = rankLlmInvocations(records, { horizonMs: LLM_COST_HORIZONS_MS['24h'], nowMs });

  assert.equal(result.totalCostUsd, 4);
  assert.equal(result.unknownCostCount, 1);
  assert.equal(result.records.length, 2);
});

test('rollup groups also exclude unknown cost from summed cost but still count the invocation', () => {
  const nowMs = Date.parse('2026-07-22T12:00:00Z');
  const records = [
    invocation({ at: '2026-07-22T11:00:00Z', costUsd: 4, origin: origin({ trigger: 'reap' }) }),
    invocation({ at: '2026-07-22T11:05:00Z', costUsd: null, origin: origin({ trigger: 'reap' }) }),
  ];
  const groups = rollupLlmInvocationsByOrigin(records, { horizonMs: LLM_COST_HORIZONS_MS['24h'], nowMs, groupBy: ['trigger'] });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].costUsd, 4);
  assert.equal(groups[0].invocationCount, 2);
  assert.equal(groups[0].unknownCostCount, 1);
});

// ── trend-series-11 / trend-sampling-12 ─────────────────────────────────

test('the three time bands use strictly finer bucket widths closer to now (trend-sampling-12)', () => {
  const byName = Object.fromEntries(DEFAULT_ORIGIN_COST_TREND_BANDS.map((b) => [b.name, b]));
  assert.ok(byName['3h'].bucketMs < byName['24h'].bucketMs, 'expected the 3h band to sample finer than the 24h band');
  assert.ok(byName['24h'].bucketMs < byName['7d'].bucketMs, 'expected the 24h band to sample finer than the 7d band');
});

test('buildOriginCostTrendSeries sums only priced invocations per bucket, oldest bucket first (trend-series-11)', () => {
  const nowMs = Date.parse('2026-07-22T18:00:00Z');
  const records = [
    invocation({ at: '2026-07-15T18:30:00Z', costUsd: 3 }), // ~6d23h30m ago — oldest, inside the 7d window
    invocation({ at: '2026-07-22T17:00:00Z', costUsd: 2 }), // 1h ago — newest
    invocation({ at: '2026-07-22T17:30:00Z', costUsd: null }), // unpriced, must not count as $0
  ];
  const [series] = buildOriginCostTrendSeries(records, { nowMs });

  assert.ok(series.buckets.length > 1);
  assert.ok(series.buckets[0].bucketStartMs < series.buckets[series.buckets.length - 1].bucketStartMs, 'expected buckets ordered oldest (left) to latest (right)');
  const totalBucketed = series.buckets.reduce((sum, b) => sum + b.costUsd, 0);
  assert.equal(totalBucketed, 5, 'expected only the two priced invocations summed across buckets, never the unpriced one');
});

test('buildOriginCostTrendSeries never places a record in more than one bucket', () => {
  const nowMs = Date.parse('2026-07-22T18:00:00Z');
  const records = [invocation({ at: '2026-07-22T17:45:00Z', costUsd: 9 })];
  const [series] = buildOriginCostTrendSeries(records, { nowMs });
  const bucketsWithCost = series.buckets.filter((b) => b.costUsd > 0);
  assert.equal(bucketsWithCost.length, 1);
  assert.equal(bucketsWithCost[0].costUsd, 9);
});

// ── trend-rank-latest-13 ─────────────────────────────────────────────────

test('origins are ranked by cost in the latest bucket, not lifetime total (trend-rank-latest-13)', () => {
  const nowMs = Date.parse('2026-07-22T18:00:00Z');
  const records = [
    // "cheap" origin spent a lot a week ago but nothing recently.
    invocation({ at: '2026-07-15T18:30:00Z', costUsd: 50, origin: origin({ role: 'cheap' }) }),
    // "pricey" origin spent little a week ago but the most in the latest bucket.
    invocation({ at: '2026-07-15T18:30:00Z', costUsd: 1, origin: origin({ role: 'pricey' }) }),
    invocation({ at: '2026-07-22T17:55:00Z', costUsd: 20, origin: origin({ role: 'pricey' }) }),
  ];
  const series = buildOriginCostTrendSeries(records, { nowMs, groupBy: ['role'] });

  assert.equal(series[0].key.role, 'pricey', 'expected the origin with the higher latest-bucket cost ranked first');
  assert.equal(series[1].key.role, 'cheap');
});

// ── trend-log-scale-14 ────────────────────────────────────────────────────

test('chooseCostTrendAxisScale returns log when priced buckets span at least a tenfold range (trend-log-scale-14)', () => {
  const series = [{ key: { role: 'coder' }, buckets: [{ bucketStartMs: 0, bucketEndMs: 1, costUsd: 0.1 }, { bucketStartMs: 1, bucketEndMs: 2, costUsd: 5 }] }];
  assert.equal(chooseCostTrendAxisScale(series), 'log');
});

test('chooseCostTrendAxisScale returns linear when the priced range is under a tenfold spread', () => {
  const series = [{ key: { role: 'coder' }, buckets: [{ bucketStartMs: 0, bucketEndMs: 1, costUsd: 2 }, { bucketStartMs: 1, bucketEndMs: 2, costUsd: 5 }] }];
  assert.equal(chooseCostTrendAxisScale(series), 'linear');
});

test('chooseCostTrendAxisScale returns linear when every bucket is zero or unset', () => {
  const series = [{ key: { role: 'coder' }, buckets: [{ bucketStartMs: 0, bucketEndMs: 1, costUsd: 0 }] }];
  assert.equal(chooseCostTrendAxisScale(series), 'linear');
});
