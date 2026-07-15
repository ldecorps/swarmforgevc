const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { main, parseArgs, buildAdapters } = require('../out/tools/provision-onboarding-telegram-channel');

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'provision-onboarding-telegram-channel.js');

// ── buildAdapters (BL-380 QA bounce - the actual defect location) ─────────
// backlog/evidence/BL-380-onboarding-provisions-the-targets-channel-bounce-
// 20260715.md: this getUpdates wiring discarded the fetch's own
// success/error and handed provisionTelegramChannel only `.updates`, so a
// bad/revoked bot token was indistinguishable from "no updates yet". Drives
// the REAL compiled buildAdapters with an injected failing/succeeding postFn
// (no live network), mirroring QA's own repro command.

function mkTmpSecretsPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-onboarding-telegram-channel-test-'));
  return path.join(dir, 'secrets.json');
}

test('buildAdapters.getUpdates surfaces a fetch failure as an error, not an empty success', async () => {
  const failingPostFn = async () => ({ ok: false, status: 401, json: { description: 'Unauthorized' } });
  const adapters = buildAdapters('/unused-target', 'bad-token', mkTmpSecretsPath(), failingPostFn);

  const result = await adapters.getUpdates();

  assert.equal(result.success, false);
  assert.match(result.error, /Unauthorized|401/);
});

test('buildAdapters.getUpdates returns the fetched updates on success', async () => {
  const okPostFn = async () => ({ ok: true, status: 200, json: { result: [{ update_id: 1 }] } });
  const adapters = buildAdapters('/unused-target', 'good-token', mkTmpSecretsPath(), okPostFn);

  const result = await adapters.getUpdates();

  assert.equal(result.success, true);
  assert.deepEqual(result.updates, [{ update_id: 1 }]);
});

// buildAdapters' other three adapter methods were newly exported by this
// same BL-380 bounce fix but never directly driven - only .getUpdates had a
// test above, so createNegotiationTopic/persistChannel/persistBotToken's own
// wiring (which real telegramClient.ts/telegramChannelStore.ts/
// telegramChannelSecretStore.ts function each closes over) stayed untested
// at the unit level even after buildAdapters became a testable export.

test('buildAdapters.createNegotiationTopic opens a topic via the injected postFn, no live network', async () => {
  const okPostFn = async () => ({ ok: true, status: 200, json: { result: { message_thread_id: 42 } } });
  const adapters = buildAdapters('/unused-target', 'good-token', mkTmpSecretsPath(), okPostFn);

  const result = await adapters.createNegotiationTopic('-100123');

  assert.equal(result.success, true);
  assert.equal(result.messageThreadId, 42);
});

test('buildAdapters.persistChannel writes the chat id and topic id under the target repo path', () => {
  const targetRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-onboarding-telegram-channel-target-'));
  const adapters = buildAdapters(targetRepoPath, 'good-token', mkTmpSecretsPath());

  adapters.persistChannel('-100123', 42);

  const written = JSON.parse(fs.readFileSync(path.join(targetRepoPath, '.swarmforge', 'operator', 'telegram-channel.json'), 'utf8'));
  assert.deepEqual(written, { chatId: '-100123', negotiationTopicId: 42 });
});

test('buildAdapters.persistBotToken writes the token to the host secrets file, keyed by target repo path', () => {
  const targetRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-onboarding-telegram-channel-target-'));
  const secretsFilePath = mkTmpSecretsPath();
  const adapters = buildAdapters(targetRepoPath, 'good-token', secretsFilePath);

  adapters.persistBotToken();

  const written = JSON.parse(fs.readFileSync(secretsFilePath, 'utf8'));
  assert.equal(written[targetRepoPath], 'good-token');
});

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs returns all four positional args when given', () => {
  assert.deepEqual(parseArgs(['/target', 'bot-token', 'bot-username', '/host/secrets.json']), {
    targetRepoPath: '/target',
    botToken: 'bot-token',
    botUsername: 'bot-username',
    hostSecretsFilePath: '/host/secrets.json',
  });
});

test('parseArgs returns null when no arguments are given', () => {
  assert.equal(parseArgs([]), null);
});

test('parseArgs returns null when the host secrets file path is missing', () => {
  assert.equal(parseArgs(['/target', 'bot-token', 'bot-username']), null);
});

// ── main() wiring (no real network - a missing arg is caught by
// makeArgsGuardedMain strictly before buildAdapters/provisionTelegramChannel
// ever runs, so this never reaches api.telegram.org - safe to run
// in-process) ────────────────────────────────────────────────────────────

// Runs the REAL main() in-process, so in-process coverage and mutation
// tooling can see the argv guard branch a subprocess-only smoke test cannot
// (the engineering article's CLI main()-thin-wrapper rule; mirrors
// proposeOnboardingContractCli.test.js's own identical seam).
async function runCli(args) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const stderrChunks = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    stderrChunks.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', CLI_PATH, ...args];
    process.exitCode = undefined;
    await main();
    return { exitCode: process.exitCode ?? 0, stderr: stderrChunks.join('') };
  } finally {
    process.stderr.write = originalStderrWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

test('main() prints usage and exits non-zero when a required argument is missing', async () => {
  const result = await runCli([]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /Usage: node provision-onboarding-telegram-channel\.js/);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv boundary) - an ADDITION to the
// in-process test above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  try {
    execFileSync('node', [CLI_PATH], { encoding: 'utf8', stdio: 'pipe' });
    assert.fail('expected the CLI to exit non-zero with no arguments');
  } catch (err) {
    assert.notEqual(err.status, 0);
    assert.match(err.stderr, /Usage: node provision-onboarding-telegram-channel\.js/);
  }
});
