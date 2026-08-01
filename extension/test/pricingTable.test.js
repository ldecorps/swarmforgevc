const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  estimateCostUsd,
  PRICING_TABLE,
  PRICING_TABLE_VERSION,
  checkPricingCoverage,
  collectReferencedClaudeModels,
  assertPricingCoverage,
} = require('../out/metrics/pricingTable');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');

// BL-100 cost-03 / BL-627: cost derives from a versioned, in-repo pricing table -
// data, not code (a rate update is a one-line PR).

test('the pricing table is versioned and bumped for BL-627', () => {
  assert.equal(typeof PRICING_TABLE_VERSION, 'number');
  assert.ok(PRICING_TABLE_VERSION >= 2, `expected PRICING_TABLE_VERSION >= 2, got ${PRICING_TABLE_VERSION}`);
});

test('BL-627 corrected and newly-added per-MTok rates', () => {
  const expected = {
    'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
    'claude-fable-5': { inputPerMTok: 10, outputPerMTok: 50 },
    'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5 },
    'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
    'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
  };
  for (const [model, rates] of Object.entries(expected)) {
    assert.ok(PRICING_TABLE[model], `missing PRICING_TABLE entry for ${model}`);
    assert.equal(PRICING_TABLE[model].inputPerMTok, rates.inputPerMTok, `${model} input`);
    assert.equal(PRICING_TABLE[model].outputPerMTok, rates.outputPerMTok, `${model} output`);
  }
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
  assert.ok(PRICING_TABLE['claude-opus-5'], 'claude-opus-5 must be priced - architect/specifier seat');
});

test('BL-627: an unpriced model referenced by a fixture conf fails loud and names it', () => {
  const root = mkTmpDir('bl627-unpriced-');
  try {
    fs.mkdirSync(path.join(root, 'swarmforge', 'packs'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'swarmforge', 'swarmforge.conf'),
      'window coder claude coder --model claude-unpriced-test-model --dangerously-skip-permissions\n'
    );
    assert.equal(PRICING_TABLE['claude-unpriced-test-model'], undefined);
    const result = checkPricingCoverage(root);
    assert.equal(result.ok, false);
    assert.ok(result.missing.includes('claude-unpriced-test-model'));
    assert.match(result.message, /claude-unpriced-test-model/);
    assert.throws(() => assertPricingCoverage(root), /claude-unpriced-test-model/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BL-627: the current repo roster passes the pricing coverage check', () => {
  const referenced = collectReferencedClaudeModels(REPO_ROOT);
  assert.ok(referenced.length > 0, 'expected at least one claude-* model in conf/packs');
  const result = checkPricingCoverage(REPO_ROOT);
  assert.equal(result.ok, true, result.message);
  assertPricingCoverage(REPO_ROOT);
});
