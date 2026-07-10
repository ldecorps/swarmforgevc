const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFileDiscoverySource } = require('../out/recruiter/discoverySource');

// BL-233 discover-candidates-01: discovery reports each candidate's model,
// provider, plan cost, and signup path. The default production source
// reads an operator-maintained JSON file (the injectable seam per the
// ticket's TESTABLE-boundary constraint) - no real network in tests.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-recruiter-discovery-'));
}

function candidatesPath(dir) {
  return path.join(dir, 'candidates.json');
}

test('discover reports each candidate\'s model, provider, plan cost, and signup path', async () => {
  const dir = mkTmp();
  fs.writeFileSync(
    candidatesPath(dir),
    JSON.stringify([
      {
        model: 'free-model-mini',
        provider: 'acme-ai',
        planCost: { amountUsd: 0, unit: 'free' },
        signupPath: { url: 'https://acme.example/signup', automation: 'automatable' },
      },
    ])
  );
  const source = createFileDiscoverySource(candidatesPath(dir));

  const candidates = await source.discover();

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].model, 'free-model-mini');
  assert.equal(candidates[0].provider, 'acme-ai');
  assert.deepEqual(candidates[0].planCost, { amountUsd: 0, unit: 'free' });
  assert.deepEqual(candidates[0].signupPath, { url: 'https://acme.example/signup', automation: 'automatable' });
});

test('discover lists every candidate in the file, in order', async () => {
  const dir = mkTmp();
  fs.writeFileSync(
    candidatesPath(dir),
    JSON.stringify([
      { model: 'a', provider: 'p1', planCost: { amountUsd: 0, unit: 'free' }, signupPath: { url: 'https://a', automation: 'automatable' } },
      { model: 'b', provider: 'p2', planCost: { amountUsd: 5, unit: 'monthly' }, signupPath: { url: 'https://b', automation: 'payment-wall' } },
    ])
  );
  const source = createFileDiscoverySource(candidatesPath(dir));

  const candidates = await source.discover();

  assert.deepEqual(candidates.map((c) => c.model), ['a', 'b']);
});

test('a missing candidates file reads as no candidates discovered yet, not an error', async () => {
  const dir = mkTmp();
  const source = createFileDiscoverySource(candidatesPath(dir));

  const candidates = await source.discover();

  assert.deepEqual(candidates, []);
});

test('a malformed (non-array) candidates file reads as no candidates, not a throw', async () => {
  const dir = mkTmp();
  fs.writeFileSync(candidatesPath(dir), JSON.stringify({ not: 'an array' }));
  const source = createFileDiscoverySource(candidatesPath(dir));

  const candidates = await source.discover();

  assert.deepEqual(candidates, []);
});

test('an entry missing a required field is dropped, not fabricated or thrown on', async () => {
  const dir = mkTmp();
  fs.writeFileSync(
    candidatesPath(dir),
    JSON.stringify([
      { model: 'complete', provider: 'p', planCost: { amountUsd: 0, unit: 'free' }, signupPath: { url: 'https://x', automation: 'automatable' } },
      { model: 'missing-provider', planCost: { amountUsd: 0, unit: 'free' }, signupPath: { url: 'https://y', automation: 'automatable' } },
    ])
  );
  const source = createFileDiscoverySource(candidatesPath(dir));

  const candidates = await source.discover();

  assert.deepEqual(candidates.map((c) => c.model), ['complete']);
});
