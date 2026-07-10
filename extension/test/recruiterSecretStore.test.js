const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFileSecretStore } = require('../out/recruiter/secretStore');

// BL-233 slice 2 (auto-acquire-free-02): the real "host secret store"
// implementation. Every test writes into an os.tmpdir() fixture standing in
// for a host-level path (never a path inside this or any target repo) - the
// module itself never assumes a location, callers always supply one, so
// these tests prove the real read/write/merge behavior without touching the
// actual host store.

function candidate(overrides = {}) {
  return {
    model: 'free-model-mini',
    provider: 'acme-ai',
    planCost: { amountUsd: 0, unit: 'free' },
    signupPath: { url: 'https://acme.example/signup', automation: 'automatable' },
    ...overrides,
  };
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-recruiter-secrets-'));
}

test('store writes the key to the secrets file, keyed by provider and model', async () => {
  const secretsFile = path.join(mkTmp(), 'secrets.json');
  const store = createFileSecretStore(secretsFile);

  await store.store(candidate(), 'sk-live-abc123');

  const written = JSON.parse(fs.readFileSync(secretsFile, 'utf-8'));
  assert.equal(written['acme-ai:free-model-mini'], 'sk-live-abc123');
});

test('store creates any missing parent directories', async () => {
  const secretsFile = path.join(mkTmp(), 'nested', 'deeper', 'secrets.json');
  const store = createFileSecretStore(secretsFile);

  await store.store(candidate(), 'sk-live-abc123');

  assert.ok(fs.existsSync(secretsFile));
});

test('storing a second candidate does not clobber a previously stored one', async () => {
  const secretsFile = path.join(mkTmp(), 'secrets.json');
  const store = createFileSecretStore(secretsFile);

  await store.store(candidate(), 'sk-live-abc123');
  await store.store(candidate({ model: 'cheap-model-pro', provider: 'beta-labs' }), 'sk-live-xyz789');

  const written = JSON.parse(fs.readFileSync(secretsFile, 'utf-8'));
  assert.equal(written['acme-ai:free-model-mini'], 'sk-live-abc123');
  assert.equal(written['beta-labs:cheap-model-pro'], 'sk-live-xyz789');
});

test('re-storing the same candidate overwrites its previous key rather than duplicating an entry', async () => {
  const secretsFile = path.join(mkTmp(), 'secrets.json');
  const store = createFileSecretStore(secretsFile);

  await store.store(candidate(), 'sk-old');
  await store.store(candidate(), 'sk-new');

  const written = JSON.parse(fs.readFileSync(secretsFile, 'utf-8'));
  assert.deepEqual(Object.keys(written), ['acme-ai:free-model-mini']);
  assert.equal(written['acme-ai:free-model-mini'], 'sk-new');
});

test('the secrets file is created with owner-only read/write permissions', async () => {
  const secretsFile = path.join(mkTmp(), 'secrets.json');
  const store = createFileSecretStore(secretsFile);

  await store.store(candidate(), 'sk-live-abc123');

  const mode = fs.statSync(secretsFile).mode & 0o777;
  assert.equal(mode, 0o600);
});
