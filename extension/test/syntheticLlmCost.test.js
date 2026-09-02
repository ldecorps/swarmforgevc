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
const { estimateCostUsdAt } = require('../out/metrics/pricingTable');

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

// BL-1056: costed at the invocation's OWN instant, not "now" - the fixture's
// default `at` ('2026-07-22T12:00:00Z') sits inside Sonnet 5's intro window,
// which the real clock has since closed, so `> 0` alone cannot tell a correct
// intro-rate estimate from a silently-wrong list-rate one computed at "now".
test('BL-1056: synthetic cost is derived at the record\'s OWN instant, not "now"', () => {
  const record = invocation();
  const expectedAtRecordTime = estimateCostUsdAt(
    { inputTokens: 1_000_000, outputTokens: 500_000, cacheCreationTokens: 0, cacheReadTokens: 0 },
    'claude-sonnet-5',
    new Date(record.at)
  );
  const costIfCostedAtNow = estimateCostUsdAt(
    { inputTokens: 1_000_000, outputTokens: 500_000, cacheCreationTokens: 0, cacheReadTokens: 0 },
    'claude-sonnet-5',
    new Date()
  );
  assert.notEqual(
    expectedAtRecordTime,
    costIfCostedAtNow,
    'vacuous unless the real clock has moved past the intro window - if this fires, the window has not yet closed'
  );
  assert.equal(deriveSyntheticCostUsd(record), expectedAtRecordTime);
});

// An unparseable `at` costs at now rather than throwing or returning null -
// the record's OWN documented fallback (costingInstantFor), otherwise
// unexercised by any test.
test('BL-1056: an unparseable record.at still derives a synthetic cost, at now', () => {
  const record = invocation({ at: 'not-a-timestamp' });
  const synthetic = deriveSyntheticCostUsd(record);
  assert.ok(typeof synthetic === 'number' && synthetic > 0, 'must still cost the record, just at now');
});

test('deriveSyntheticCostUsd stays null for a provider-billed record (billed-cost-unchanged-04)', () => {
  const record = invocation({ costUsd: 0.74 });
  assert.equal(deriveSyntheticCostUsd(record), null);
});

test('deriveSyntheticCostUsd returns null when token fields are only partially present', () => {
  const record = invocation({
    tokens: { inputTokens: 1_000, outputTokens: null, cacheCreationTokens: 0, cacheReadTokens: 0 },
  });
  assert.equal(deriveSyntheticCostUsd(record), null);
});

test('deriveSyntheticCostUsd returns null when list-price estimate is zero', () => {
  const record = invocation({
    tokens: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  });
  assert.equal(deriveSyntheticCostUsd(record), null);
});

test('enrichLlmInvocationRecord leaves the record unchanged when synthetic cannot be derived', () => {
  const record = invocation({
    tokens: { inputTokens: null, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 },
  });
  const enriched = enrichLlmInvocationRecord(record);
  assert.equal(enriched.syntheticCostUsd, undefined);
});

test('isUnknownSyntheticPrice is false when tokens are absent even for unknown models', () => {
  const record = invocation({ tokens: null, model: 'not-in-pricing-table', origin: origin({ model: 'not-in-pricing-table' }) });
  assert.equal(isUnknownSyntheticPrice(record), false);
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
