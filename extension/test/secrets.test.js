const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveResendApiKey,
  RESEND_SECRET_KEY,
  trimmedResendKeyInput,
  describeSetResult,
  describeClearResult,
} = require('../out/notify/secrets');

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

test('RESEND_SECRET_KEY is the stable SecretStorage key (a mismatch here would silently split reads/writes across two different storage slots)', () => {
  assert.equal(RESEND_SECRET_KEY, 'swarmforge.resendApiKey');
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

// --- BL-103: pure helpers behind the Set/Clear Resend API Key commands.
//     The input-box UI is the untestable boundary; the resolution-order
//     message and empty-input handling are pure and tested directly. ---

test('trimmedResendKeyInput returns undefined for empty input (a safe no-op)', () => {
  assert.equal(trimmedResendKeyInput(''), undefined);
  assert.equal(trimmedResendKeyInput(undefined), undefined);
});

test('trimmedResendKeyInput returns undefined for whitespace-only input', () => {
  assert.equal(trimmedResendKeyInput('   '), undefined);
});

test('trimmedResendKeyInput trims and returns non-empty input', () => {
  assert.equal(trimmedResendKeyInput('  a-real-key  '), 'a-real-key');
});

test('describeSetResult states precedence when the env var is set', () => {
  assert.equal(
    describeSetResult(true),
    'Resend API key stored in SecretStorage. Note: the RESEND_API_KEY environment variable is currently set and takes precedence over this value until it is unset.'
  );
});

test('describeSetResult has no precedence caveat when no env var is set', () => {
  // Exact equality, not just doesNotMatch(/RESEND_API_KEY/): a doesNotMatch
  // check alone can't tell an empty caveat from a non-empty one that simply
  // never mentions RESEND_API_KEY, so it can't catch precedenceNote's empty
  // branch being replaced with other non-matching text.
  assert.equal(describeSetResult(false), 'Resend API key stored in SecretStorage.');
});

test('describeClearResult never echoes anything sensitive and states precedence when the env var is set', () => {
  assert.equal(
    describeClearResult(true),
    'Resend API key cleared from SecretStorage. Note: the RESEND_API_KEY environment variable is currently set and takes precedence over this value until it is unset.'
  );
});

test('describeClearResult has no precedence caveat when no env var is set', () => {
  assert.equal(describeClearResult(false), 'Resend API key cleared from SecretStorage.');
});
