const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveResendApiKey, RESEND_SECRET_KEY } = require('../out/notify/secrets');

// Per the constitution's secrets rule: RESEND_API_KEY must resolve only from
// the host env var or VS Code SecretStorage, never a workspace setting.
const ORIGINAL_ENV = process.env.RESEND_API_KEY;

test.afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.RESEND_API_KEY;
  } else {
    process.env.RESEND_API_KEY = ORIGINAL_ENV;
  }
});

function fakeSecrets(stored) {
  const calls = [];
  return {
    calls,
    storage: {
      get: async (key) => {
        calls.push(key);
        return stored;
      },
    },
  };
}

test('resolveResendApiKey returns the env var when set, without consulting SecretStorage', async () => {
  process.env.RESEND_API_KEY = 'env-key-123';
  const { calls, storage } = fakeSecrets('storage-key-should-not-be-used');

  const result = await resolveResendApiKey(storage);

  assert.equal(result, 'env-key-123');
  assert.deepEqual(calls, [], 'the env var takes priority; SecretStorage must not be read when it is set');
});

test('resolveResendApiKey falls back to SecretStorage when no env var is set', async () => {
  delete process.env.RESEND_API_KEY;
  const { calls, storage } = fakeSecrets('storage-key-456');

  const result = await resolveResendApiKey(storage);

  assert.equal(result, 'storage-key-456');
  assert.deepEqual(calls, [RESEND_SECRET_KEY]);
});

test('resolveResendApiKey returns undefined when neither the env var nor SecretStorage is available', async () => {
  delete process.env.RESEND_API_KEY;

  const result = await resolveResendApiKey(undefined);

  assert.equal(result, undefined);
});

test('resolveResendApiKey returns undefined when SecretStorage has no value stored', async () => {
  delete process.env.RESEND_API_KEY;
  const { storage } = fakeSecrets(undefined);

  const result = await resolveResendApiKey(storage);

  assert.equal(result, undefined);
});
