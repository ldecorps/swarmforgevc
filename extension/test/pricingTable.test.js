const assert = require('node:assert/strict');
const { estimateCostUsd, PRICING_TABLE, PRICING_TABLE_VERSION } = require('../out/metrics/pricingTable');

// BL-100 cost-03: cost derives from a versioned, in-repo pricing table -
// data, not code (a rate update is a one-line PR).

test('the pricing table is versioned', () => {
  assert.equal(typeof PRICING_TABLE_VERSION, 'number');
  assert.ok(PRICING_TABLE_VERSION >= 1);
});

test('estimateCostUsd follows the table\'s per-model input/output rates', () => {
  const model = Object.keys(PRICING_TABLE)[0];
  const rates = PRICING_TABLE[model];
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const cost = estimateCostUsd(usage, model);
  assert.ok(Math.abs(cost - (rates.inputPerMTok + rates.outputPerMTok)) < 1e-9);
});

test('cache-read tokens are priced at their own (cheaper) rate, not the input rate', () => {
  const model = Object.keys(PRICING_TABLE)[0];
  const rates = PRICING_TABLE[model];
  assert.notEqual(rates.cacheReadPerMTok, rates.inputPerMTok, 'fixture assumption: cache reads are priced differently from fresh input');

  const usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 1_000_000 };
  const cost = estimateCostUsd(usage, model);
  assert.ok(Math.abs(cost - rates.cacheReadPerMTok) < 1e-9);
});

test('cache-creation tokens are priced at their own rate', () => {
  const model = Object.keys(PRICING_TABLE)[0];
  const rates = PRICING_TABLE[model];
  const usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 1_000_000, cacheReadTokens: 0 };
  const cost = estimateCostUsd(usage, model);
  assert.ok(Math.abs(cost - rates.cacheCreatePerMTok) < 1e-9);
});

test('estimateCostUsd sums all four token categories at their own rates', () => {
  const model = Object.keys(PRICING_TABLE)[0];
  const rates = PRICING_TABLE[model];
  const usage = { inputTokens: 500_000, outputTokens: 250_000, cacheCreationTokens: 100_000, cacheReadTokens: 2_000_000 };
  const expected =
    0.5 * rates.inputPerMTok + 0.25 * rates.outputPerMTok + 0.1 * rates.cacheCreatePerMTok + 2 * rates.cacheReadPerMTok;
  const cost = estimateCostUsd(usage, model);
  assert.ok(Math.abs(cost - expected) < 1e-6);
});

test('estimateCostUsd returns null for a model absent from the table, rather than guessing', () => {
  const usage = { inputTokens: 100, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 };
  assert.equal(estimateCostUsd(usage, 'totally-unknown-model'), null);
});

test('estimateCostUsd returns zero for a known model with zero usage', () => {
  const model = Object.keys(PRICING_TABLE)[0];
  const usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  assert.equal(estimateCostUsd(usage, model), 0);
});

test('the table includes the models actually observed in this session\'s transcripts', () => {
  assert.ok(PRICING_TABLE['claude-sonnet-5'], 'claude-sonnet-5 must be priced - it is the model this repo runs on');
});
