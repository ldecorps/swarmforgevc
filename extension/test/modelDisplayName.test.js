const assert = require('node:assert/strict');
const { formatModelDisplayName, MODEL_DISPLAY_NAMES } = require('../out/swarm/modelDisplayName');

test('formatModelDisplayName maps known claude model ids to friendly labels', () => {
  assert.equal(formatModelDisplayName('claude-sonnet-5'), 'Sonnet 5');
  assert.equal(formatModelDisplayName('claude-opus-4-8'), 'Opus 4.8');
  assert.equal(formatModelDisplayName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
});

test('formatModelDisplayName falls back to the raw id for unknown models', () => {
  assert.equal(formatModelDisplayName('some-custom-model'), 'some-custom-model');
});

test('formatModelDisplayName maps qwen models and strips openai/ prefix for unknown gateway ids', () => {
  assert.equal(formatModelDisplayName('openai/qwen3.7-plus'), 'Qwen 3.7 Plus');
  assert.equal(formatModelDisplayName('openai/some-other-model'), 'some-other-model');
});

test('MODEL_DISPLAY_NAMES covers every priced claude model', () => {
  const { PRICING_TABLE } = require('../out/metrics/pricingTable');
  for (const modelId of Object.keys(PRICING_TABLE)) {
    assert.ok(MODEL_DISPLAY_NAMES[modelId], `missing display name for ${modelId}`);
  }
});
