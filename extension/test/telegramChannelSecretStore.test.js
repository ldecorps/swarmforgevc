const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { storeTelegramBotToken } = require('../out/onboarding/telegramChannelSecretStore');

// Every test writes into an os.tmpdir() fixture standing in for a host-level
// path (never a path inside any target repo) - mirrors
// recruiterSecretStore.test.js's own established convention for exactly this
// "host state outside the working tree" shape.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-telegram-channel-secrets-'));
}

test('storeTelegramBotToken writes the token to the secrets file, keyed by target repo path', () => {
  const targetRepo = mkTmp();
  const secretsFile = path.join(mkTmp(), 'telegram-bot-tokens.json');

  storeTelegramBotToken(secretsFile, targetRepo, 'sk-bot-token-a');

  const written = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
  assert.equal(written[targetRepo], 'sk-bot-token-a');
});

test('storeTelegramBotToken creates any missing parent directories', () => {
  const targetRepo = mkTmp();
  const secretsFile = path.join(mkTmp(), 'nested', 'deeper', 'telegram-bot-tokens.json');

  storeTelegramBotToken(secretsFile, targetRepo, 'sk-bot-token-a');

  assert.ok(fs.existsSync(secretsFile));
});

// BL-380 scenario 05: a second onboarded target gets its own bot, and the
// first target's is left untouched.
test('provisioning a second target does not clobber the first target\'s stored token', () => {
  const targetRepoA = mkTmp();
  const targetRepoB = mkTmp();
  const secretsFile = path.join(mkTmp(), 'telegram-bot-tokens.json');

  storeTelegramBotToken(secretsFile, targetRepoA, 'sk-bot-token-a');
  storeTelegramBotToken(secretsFile, targetRepoB, 'sk-bot-token-b');

  const written = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
  assert.equal(written[targetRepoA], 'sk-bot-token-a');
  assert.equal(written[targetRepoB], 'sk-bot-token-b');
});

test('re-provisioning the same target overwrites its own token rather than duplicating an entry', () => {
  const targetRepo = mkTmp();
  const secretsFile = path.join(mkTmp(), 'telegram-bot-tokens.json');

  storeTelegramBotToken(secretsFile, targetRepo, 'sk-old');
  storeTelegramBotToken(secretsFile, targetRepo, 'sk-new');

  const written = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
  assert.deepEqual(Object.keys(written), [targetRepo]);
  assert.equal(written[targetRepo], 'sk-new');
});

test('the secrets file is created with owner-only read/write permissions', () => {
  const targetRepo = mkTmp();
  const secretsFile = path.join(mkTmp(), 'telegram-bot-tokens.json');

  storeTelegramBotToken(secretsFile, targetRepo, 'sk-bot-token-a');

  const mode = fs.statSync(secretsFile).mode & 0o777;
  assert.equal(mode, 0o600);
});

// The secrets rule (local-engineering article): the token must never be
// written into the target's own working directory - structurally enforced,
// not just a caller-discipline comment (recruiter/secretStore.ts's own
// architect bounce 2d96adcb10 was exactly a comment-only promise).
test('refuses to store the token inside the target working directory', () => {
  const targetRepo = mkTmp();
  const secretsFile = path.join(targetRepo, 'telegram-bot-tokens.json');

  assert.throws(() => storeTelegramBotToken(secretsFile, targetRepo, 'sk-bot-token-a'), /target working directory/i);
});

test('refuses to store the token several directories deep inside the target working directory', () => {
  const targetRepo = mkTmp();
  const secretsFile = path.join(targetRepo, '.swarmforge', 'operator', 'telegram-bot-tokens.json');

  assert.throws(() => storeTelegramBotToken(secretsFile, targetRepo, 'sk-bot-token-a'), /target working directory/i);
});

test('does not throw for a path outside the given target working directory', () => {
  const targetRepo = mkTmp();
  const secretsFile = path.join(mkTmp(), 'telegram-bot-tokens.json'); // a SIBLING tmpdir, not under targetRepo

  assert.doesNotThrow(() => storeTelegramBotToken(secretsFile, targetRepo, 'sk-bot-token-a'));
});
