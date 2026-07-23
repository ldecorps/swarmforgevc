const assert = require('node:assert/strict');
const {
  resolveResendApiKey,
  RESEND_SECRET_KEY,
  trimmedResendKeyInput,
  describeSetResult,
  describeClearResult,
  resolveOpenAIApiKey,
  OPENAI_SECRET_KEY,
  resolveMistralApiKey,
  MISTRAL_SECRET_KEY,
  resolveTelegramBotToken,
  TELEGRAM_BOT_TOKEN_SECRET_KEY,
  resolveTelegramChatId,
  TELEGRAM_CHAT_ID_SECRET_KEY,
} = require('../out/notify/secrets');

// Per the constitution's secrets rule: RESEND_API_KEY must resolve only from
// the host env var or VS Code SecretStorage, never a workspace setting.
const ORIGINAL_ENV = process.env.RESEND_API_KEY;
const ORIGINAL_OPENAI_ENV = process.env.OPENAI_API_KEY;
const ORIGINAL_MISTRAL_ENV = process.env.MISTRAL_API_KEY;
const ORIGINAL_TELEGRAM_TOKEN_ENV = process.env.TELEGRAM_BOT_TOKEN;
const ORIGINAL_TELEGRAM_CHAT_ENV = process.env.TELEGRAM_CHAT_ID;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.RESEND_API_KEY;
  } else {
    process.env.RESEND_API_KEY = ORIGINAL_ENV;
  }
  if (ORIGINAL_OPENAI_ENV === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_ENV;
  }
  if (ORIGINAL_MISTRAL_ENV === undefined) {
    delete process.env.MISTRAL_API_KEY;
  } else {
    process.env.MISTRAL_API_KEY = ORIGINAL_MISTRAL_ENV;
  }
  if (ORIGINAL_TELEGRAM_TOKEN_ENV === undefined) {
    delete process.env.TELEGRAM_BOT_TOKEN;
  } else {
    process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TELEGRAM_TOKEN_ENV;
  }
  if (ORIGINAL_TELEGRAM_CHAT_ENV === undefined) {
    delete process.env.TELEGRAM_CHAT_ID;
  } else {
    process.env.TELEGRAM_CHAT_ID = ORIGINAL_TELEGRAM_CHAT_ENV;
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

// --- BL-130: per-role alternate agent runtime provider keys. Same
//     env-first, then-SecretStorage, never-a-repo-file resolution rule as
//     Resend above. ---

test('OPENAI_SECRET_KEY and MISTRAL_SECRET_KEY are the stable SecretStorage keys', () => {
  assert.equal(OPENAI_SECRET_KEY, 'swarmforge.openaiApiKey');
  assert.equal(MISTRAL_SECRET_KEY, 'swarmforge.mistralApiKey');
});

test('resolveOpenAIApiKey returns the env var when set, without consulting SecretStorage', async () => {
  process.env.OPENAI_API_KEY = 'env-openai-123';
  const { calls, storage } = fakeSecrets('storage-key-should-not-be-used');

  const result = await resolveOpenAIApiKey(storage);

  assert.equal(result, 'env-openai-123');
  assert.deepEqual(calls, []);
});

test('resolveOpenAIApiKey falls back to SecretStorage when no env var is set', async () => {
  delete process.env.OPENAI_API_KEY;
  const { calls, storage } = fakeSecrets('storage-openai-456');

  const result = await resolveOpenAIApiKey(storage);

  assert.equal(result, 'storage-openai-456');
  assert.deepEqual(calls, [OPENAI_SECRET_KEY]);
});

test('resolveOpenAIApiKey returns undefined when neither source has a value', async () => {
  delete process.env.OPENAI_API_KEY;

  assert.equal(await resolveOpenAIApiKey(undefined), undefined);
});

test('resolveMistralApiKey returns the env var when set, without consulting SecretStorage', async () => {
  process.env.MISTRAL_API_KEY = 'env-mistral-123';
  const { calls, storage } = fakeSecrets('storage-key-should-not-be-used');

  const result = await resolveMistralApiKey(storage);

  assert.equal(result, 'env-mistral-123');
  assert.deepEqual(calls, []);
});

test('resolveMistralApiKey falls back to SecretStorage when no env var is set', async () => {
  delete process.env.MISTRAL_API_KEY;
  const { calls, storage } = fakeSecrets('storage-mistral-456');

  const result = await resolveMistralApiKey(storage);

  assert.equal(result, 'storage-mistral-456');
  assert.deepEqual(calls, [MISTRAL_SECRET_KEY]);
});

test('resolveMistralApiKey returns undefined when neither source has a value', async () => {
  delete process.env.MISTRAL_API_KEY;

  assert.equal(await resolveMistralApiKey(undefined), undefined);
});

// --- BL-239: the Telegram chat adapter's bot token and authorized chat id.
//     Same env-first, then-SecretStorage, never-a-repo-file resolution rule. ---

test('TELEGRAM_BOT_TOKEN_SECRET_KEY and TELEGRAM_CHAT_ID_SECRET_KEY are the stable SecretStorage keys', () => {
  assert.equal(TELEGRAM_BOT_TOKEN_SECRET_KEY, 'swarmforge.telegramBotToken');
  assert.equal(TELEGRAM_CHAT_ID_SECRET_KEY, 'swarmforge.telegramChatId');
});

test('resolveTelegramBotToken returns the env var when set, without consulting SecretStorage', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'env-telegram-token-123';
  const { calls, storage } = fakeSecrets('storage-key-should-not-be-used');

  const result = await resolveTelegramBotToken(storage);

  assert.equal(result, 'env-telegram-token-123');
  assert.deepEqual(calls, []);
});

test('resolveTelegramBotToken falls back to SecretStorage when no env var is set', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  const { calls, storage } = fakeSecrets('storage-telegram-token-456');

  const result = await resolveTelegramBotToken(storage);

  assert.equal(result, 'storage-telegram-token-456');
  assert.deepEqual(calls, [TELEGRAM_BOT_TOKEN_SECRET_KEY]);
});

test('resolveTelegramBotToken returns undefined when neither source has a value', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;

  assert.equal(await resolveTelegramBotToken(undefined), undefined);
});

test('resolveTelegramChatId returns the env var when set, without consulting SecretStorage', async () => {
  process.env.TELEGRAM_CHAT_ID = '999888777';
  const { calls, storage } = fakeSecrets('storage-chat-id-should-not-be-used');

  const result = await resolveTelegramChatId(storage);

  assert.equal(result, '999888777');
  assert.deepEqual(calls, []);
});

test('resolveTelegramChatId falls back to SecretStorage when no env var is set', async () => {
  delete process.env.TELEGRAM_CHAT_ID;
  const { calls, storage } = fakeSecrets('storage-chat-id-456');

  const result = await resolveTelegramChatId(storage);

  assert.equal(result, 'storage-chat-id-456');
  assert.deepEqual(calls, [TELEGRAM_CHAT_ID_SECRET_KEY]);
});

test('resolveTelegramChatId returns undefined when neither source has a value', async () => {
  delete process.env.TELEGRAM_CHAT_ID;

  assert.equal(await resolveTelegramChatId(undefined), undefined);
});
