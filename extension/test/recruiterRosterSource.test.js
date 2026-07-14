const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFileRosterSource } = require('../out/recruiter/rosterSource');

// BL-250 roster-enumerates-01: the bake-off's curated three-provider
// roster source. Mirrors discoverySource.ts's own choice - an operator-
// maintained JSON catalog file rather than live provider-API calls (the
// TESTABLE-boundary constraint calls for an injectable seam here
// regardless; no real network in tests).

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-recruiter-roster-'));
}

function catalogPath(dir) {
  return path.join(dir, 'catalog.json');
}

function chatEntry(overrides = {}) {
  return {
    provider: 'anthropic',
    model: 'claude-fable-5',
    planCost: { amountUsd: 0, unit: 'free' },
    signupPath: { url: 'https://console.anthropic.com', automation: 'automatable' },
    endpointType: 'chat',
    costTier: 'free/eval-tier',
    ...overrides,
  };
}

test('lists each candidate\'s provider, model id, plan cost, and cost tier', async () => {
  const dir = mkTmp();
  fs.writeFileSync(catalogPath(dir), JSON.stringify([chatEntry()]));
  const source = createFileRosterSource(catalogPath(dir));

  const candidates = await source.discover();

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].provider, 'anthropic');
  assert.equal(candidates[0].model, 'claude-fable-5');
  assert.deepEqual(candidates[0].planCost, { amountUsd: 0, unit: 'free' });
  assert.equal(candidates[0].costTier, 'free/eval-tier');
});

test('lists candidates across all three providers, each labeled paid-only or free/eval-tier', async () => {
  const dir = mkTmp();
  fs.writeFileSync(
    catalogPath(dir),
    JSON.stringify([
      chatEntry({ provider: 'anthropic', model: 'claude-fable-5', costTier: 'free/eval-tier' }),
      chatEntry({ provider: 'mistral', model: 'mistral-large', costTier: 'paid-only', planCost: { amountUsd: 9, unit: 'monthly' } }),
      chatEntry({ provider: 'openai', model: 'gpt-5', costTier: 'paid-only', planCost: { amountUsd: 20, unit: 'monthly' } }),
    ])
  );
  const source = createFileRosterSource(catalogPath(dir));

  const candidates = await source.discover();

  const byProvider = Object.fromEntries(candidates.map((c) => [c.provider, c.costTier]));
  assert.deepEqual(byProvider, { anthropic: 'free/eval-tier', mistral: 'paid-only', openai: 'paid-only' });
});

test('excludes non-chat endpoints (embeddings, image, audio, moderation) from the roster', async () => {
  const dir = mkTmp();
  fs.writeFileSync(
    catalogPath(dir),
    JSON.stringify([
      chatEntry({ model: 'chat-model', endpointType: 'chat' }),
      chatEntry({ model: 'embed-model', endpointType: 'embeddings' }),
      chatEntry({ model: 'image-model', endpointType: 'image' }),
      chatEntry({ model: 'audio-model', endpointType: 'audio' }),
      chatEntry({ model: 'moderation-model', endpointType: 'moderation' }),
    ])
  );
  const source = createFileRosterSource(catalogPath(dir));

  const candidates = await source.discover();

  assert.deepEqual(candidates.map((c) => c.model), ['chat-model']);
});

test('a missing catalog file reads as no candidates discovered yet, not an error', async () => {
  const dir = mkTmp();
  const source = createFileRosterSource(catalogPath(dir));

  const candidates = await source.discover();

  assert.deepEqual(candidates, []);
});

test('a malformed (non-array) catalog file reads as no candidates, not a throw', async () => {
  const dir = mkTmp();
  fs.writeFileSync(catalogPath(dir), JSON.stringify({ not: 'an array' }));
  const source = createFileRosterSource(catalogPath(dir));

  const candidates = await source.discover();

  assert.deepEqual(candidates, []);
});

test('an entry missing a required field is dropped, not fabricated or thrown on', async () => {
  const dir = mkTmp();
  fs.writeFileSync(
    catalogPath(dir),
    JSON.stringify([chatEntry({ model: 'complete' }), { model: 'missing-provider', endpointType: 'chat' }])
  );
  const source = createFileRosterSource(catalogPath(dir));

  const candidates = await source.discover();

  assert.deepEqual(candidates.map((c) => c.model), ['complete']);
});
