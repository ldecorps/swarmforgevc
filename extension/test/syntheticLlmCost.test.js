const assert = require('node:assert/strict');
const {
  LLM_COST_HORIZONS_MS,
  rankLlmInvocations,
  rollupLlmInvocationsByOrigin,
} = require('../out/metrics/llmCostLedger');
const {
  deriveSyntheticCostUsd,
  enrichLlmInvocationRecord,
  isUnknownSyntheticPrice,
  PRICING_TABLE_AS_OF_LABEL,
} = require('../out/metrics/syntheticLlmCost');

function origin(overrides = {}) {
  return {
    subsystem: 'pipeline',
    role: 'coder',
    stage: 'coder',
    trigger: 'handoff',
    ticketId: 'BL-565',
    handoffId: 'h1',
    handoffType: 'git_handoff',
    script: null,
    pack: null,
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
    tokens: { inputTokens: 1_000_000, outputTokens: 500_000, cacheCreationTokens: 0, cacheReadTokens: 0 },
    costUsd: null,
    origin: origin(),
    ...overrides,
  };
}

test('syntheticCostUsd is a positive list-price estimate when tokens are known and costUsd is null (synthetic-distinct-from-billed-03)', () => {
  const record = invocation();
  const synthetic = deriveSyntheticCostUsd(record);
  assert.ok(synthetic > 0);
  assert.equal(record.costUsd, null);
});

test('deriveSyntheticCostUsd stays null for a provider-billed record (billed-cost-unchanged-04)', () => {
  const record = invocation({ costUsd: 0.74 });
  assert.equal(deriveSyntheticCostUsd(record), null);
});

test('unknown model with tokens yields null synthetic and isUnknownSyntheticPrice (unknown-model-unknown-price-bucket-06)', () => {
  const record = invocation({ model: 'not-in-pricing-table', origin: origin({ model: 'not-in-pricing-table' }) });
  assert.equal(deriveSyntheticCostUsd(record), null);
  assert.equal(isUnknownSyntheticPrice(record), true);
});

test('enrichLlmInvocationRecord attaches syntheticCostUsd without touching costUsd', () => {
  const enriched = enrichLlmInvocationRecord(invocation());
  assert.ok(enriched.syntheticCostUsd > 0);
  assert.equal(enriched.costUsd, null);
});

test('rankLlmInvocations keeps billed and synthetic totals separate (rollups-separate-columns-05)', () => {
  const nowMs = Date.parse('2026-07-22T18:00:00Z');
  const records = [
    invocation({ at: '2026-07-22T17:00:00Z', costUsd: null, origin: origin({ role: 'coder' }) }),
    invocation({
      at: '2026-07-22T17:30:00Z',
      costUsd: 2,
      tokens: null,
      origin: origin({ role: 'front-desk-operator', subsystem: 'front_desk', trigger: 'reap' }),
    }),
  ].map(enrichLlmInvocationRecord);
  const result = rankLlmInvocations(records, { horizonMs: LLM_COST_HORIZONS_MS['7d'], nowMs });
  assert.equal(result.totalCostUsd, 2);
  assert.ok(result.totalSyntheticCostUsd > 0);
  assert.notEqual(result.totalCostUsd, result.totalSyntheticCostUsd);
  assert.equal(result.pricingTableAsOf, PRICING_TABLE_AS_OF_LABEL);
});
