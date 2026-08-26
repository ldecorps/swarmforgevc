const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { main, parseArgs, buildAdapters, readProvisioningOffset, writeProvisioningOffset } = require('../out/tools/provision-onboarding-telegram-channel');

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'provision-onboarding-telegram-channel.js');

// ── buildAdapters (BL-380 QA bounce - the actual defect location) ─────────
// backlog/evidence/BL-380-onboarding-provisions-the-targets-channel-bounce-
// 20260715.md: this getUpdates wiring discarded the fetch's own
// success/error and handed provisionTelegramChannel only `.updates`, so a
// bad/revoked bot token was indistinguishable from "no updates yet". Drives
// the REAL compiled buildAdapters with an injected failing/succeeding postFn
// (no live network), mirroring QA's own repro command.

function mkTmpSecretsPath() {
  const dir = mkTmpDir('provision-onboarding-telegram-channel-test-');
  return path.join(dir, 'secrets.json');
}

// BL-436: a fixture HOME directory standing in for the real one -
// buildAdapters' fleet-creds write must never touch the real $HOME during
// a test.
function mkTmpHomeDir() {
  return mkTmpDir('provision-onboarding-telegram-channel-home-');
}

const TEST_SWARM_NAME = 'fes';
const TEST_BRIDGE_PORT = 9001;

test('buildAdapters.getUpdates surfaces a fetch failure as an error, not an empty success', async () => {
  const failingPostFn = async () => ({ ok: false, status: 401, json: { description: 'Unauthorized' } });
  const adapters = buildAdapters('/unused-target', 'bad-token', mkTmpSecretsPath(), TEST_SWARM_NAME, TEST_BRIDGE_PORT, failingPostFn);

  const result = await adapters.getUpdates();

  assert.equal(result.success, false);
  assert.match(result.error, /Unauthorized|401/);
});

test('buildAdapters.getUpdates returns the fetched updates on success', async () => {
  const okPostFn = async () => ({ ok: true, status: 200, json: { result: [{ update_id: 1 }] } });
  const adapters = buildAdapters('/unused-target', 'good-token', mkTmpSecretsPath(), TEST_SWARM_NAME, TEST_BRIDGE_PORT, okPostFn);

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
  const adapters = buildAdapters('/unused-target', 'good-token', mkTmpSecretsPath(), TEST_SWARM_NAME, TEST_BRIDGE_PORT, okPostFn);

  const result = await adapters.createNegotiationTopic('-100123');

  assert.equal(result.success, true);
  assert.equal(result.messageThreadId, 42);
});

test('buildAdapters.persistChannel writes the chat id and topic id under the target repo path', () => {
  const targetRepoPath = mkTmpDir('provision-onboarding-telegram-channel-target-');
  const adapters = buildAdapters(targetRepoPath, 'good-token', mkTmpSecretsPath(), TEST_SWARM_NAME, TEST_BRIDGE_PORT, undefined, mkTmpHomeDir());

  adapters.persistChannel('-100123', 42);

  const written = JSON.parse(fs.readFileSync(path.join(targetRepoPath, '.swarmforge', 'operator', 'telegram-channel.json'), 'utf8'));
  assert.deepEqual(written, { chatId: '-100123', negotiationTopicId: 42 });
});

test('buildAdapters.persistBotToken writes the token to the host secrets file, keyed by target repo path', () => {
  const targetRepoPath = mkTmpDir('provision-onboarding-telegram-channel-target-');
  const secretsFilePath = mkTmpSecretsPath();
  const adapters = buildAdapters(targetRepoPath, 'good-token', secretsFilePath, TEST_SWARM_NAME, TEST_BRIDGE_PORT, undefined, mkTmpHomeDir());

  adapters.persistBotToken();

  const written = JSON.parse(fs.readFileSync(secretsFilePath, 'utf8'));
  assert.equal(written[targetRepoPath], 'good-token');
});

// ── BL-436: persistChannel ALSO writes the swarm's fleet creds file,
//    additive to the existing target-repo-keyed write above ──────────────

test('buildAdapters.persistChannel also writes botToken/chatId/bridgePort to the fleet creds file for this swarm', () => {
  const targetRepoPath = mkTmpDir('provision-onboarding-telegram-channel-target-');
  const homeDir = mkTmpHomeDir();
  const adapters = buildAdapters(targetRepoPath, 'fes-bot-token', mkTmpSecretsPath(), TEST_SWARM_NAME, TEST_BRIDGE_PORT, undefined, homeDir);

  adapters.persistChannel('-100123', 42);

  const written = JSON.parse(fs.readFileSync(path.join(homeDir, '.swarmforge', 'fleet', TEST_SWARM_NAME, 'telegram.json'), 'utf8'));
  assert.deepEqual(written, { botToken: 'fes-bot-token', chatId: '-100123', bridgePort: TEST_BRIDGE_PORT });
});

test('buildAdapters.persistChannel keeps two different swarms\' fleet creds files separate', () => {
  const homeDir = mkTmpHomeDir();
  const targetA = mkTmpDir('provision-onboarding-telegram-channel-target-');
  const targetB = mkTmpDir('provision-onboarding-telegram-channel-target-');
  const adaptersA = buildAdapters(targetA, 'token-a', mkTmpSecretsPath(), 'fes', 9001, undefined, homeDir);
  const adaptersB = buildAdapters(targetB, 'token-b', mkTmpSecretsPath(), 'primary', 8765, undefined, homeDir);

  adaptersA.persistChannel('-100111', 1);
  adaptersB.persistChannel('-100222', 2);

  const writtenA = JSON.parse(fs.readFileSync(path.join(homeDir, '.swarmforge', 'fleet', 'fes', 'telegram.json'), 'utf8'));
  const writtenB = JSON.parse(fs.readFileSync(path.join(homeDir, '.swarmforge', 'fleet', 'primary', 'telegram.json'), 'utf8'));
  assert.deepEqual(writtenA, { botToken: 'token-a', chatId: '-100111', bridgePort: 9001 });
  assert.deepEqual(writtenB, { botToken: 'token-b', chatId: '-100222', bridgePort: 8765 });
});

// ── BL-444: the confirm offset is the one piece of state this CLI owns ────

test('readProvisioningOffset returns 0 when no offset has ever been persisted', () => {
  const targetRepoPath = mkTmpDir('provision-onboarding-telegram-channel-target-');
  assert.equal(readProvisioningOffset(targetRepoPath), 0);
});

test('writeProvisioningOffset then readProvisioningOffset round-trips the persisted value', () => {
  const targetRepoPath = mkTmpDir('provision-onboarding-telegram-channel-target-');

  writeProvisioningOffset(targetRepoPath, 143744673);

  assert.equal(readProvisioningOffset(targetRepoPath), 143744673);
});

test('BL-444: buildAdapters.getUpdates reads the persisted offset instead of a hardcoded 0', async () => {
  const targetRepoPath = mkTmpDir('provision-onboarding-telegram-channel-target-');
  writeProvisioningOffset(targetRepoPath, 143744673);
  const seenBodies = [];
  const postFn = async (_url, body) => {
    seenBodies.push(JSON.parse(body));
    return { ok: true, status: 200, json: { result: [] } };
  };
  const adapters = buildAdapters(targetRepoPath, 'good-token', mkTmpSecretsPath(), TEST_SWARM_NAME, TEST_BRIDGE_PORT, postFn);

  await adapters.getUpdates();

  assert.equal(seenBodies[0].offset, 143744673, `expected the persisted offset to be sent, got: ${JSON.stringify(seenBodies)}`);
});

test('BL-444: buildAdapters.persistConfirmOffset writes the offset that getUpdates will next read', () => {
  const targetRepoPath = mkTmpDir('provision-onboarding-telegram-channel-target-');
  const adapters = buildAdapters(targetRepoPath, 'good-token', mkTmpSecretsPath(), TEST_SWARM_NAME, TEST_BRIDGE_PORT, undefined, mkTmpHomeDir());

  adapters.persistConfirmOffset(143744673);

  assert.equal(readProvisioningOffset(targetRepoPath), 143744673);
});

test('BL-444: buildAdapters.createNegotiationTopic surfaces migrateToChatId as a string when Telegram reports the supergroup upgrade', async () => {
  const migratePostFn = async () => ({
    ok: false,
    status: 400,
    json: { description: 'Bad Request: group chat was upgraded to a supergroup chat', parameters: { migrate_to_chat_id: -1003886489685 } },
  });
  const adapters = buildAdapters('/unused-target', 'good-token', mkTmpSecretsPath(), TEST_SWARM_NAME, TEST_BRIDGE_PORT, migratePostFn);

  const result = await adapters.createNegotiationTopic('-5274683022');

  assert.equal(result.success, false);
  assert.equal(result.migrateToChatId, '-1003886489685');
});

test('buildAdapters.createNegotiationTopic reports no migrateToChatId on an ordinary failure', async () => {
  const failingPostFn = async () => ({ ok: false, status: 400, json: { description: 'Bad Request: chat not found' } });
  const adapters = buildAdapters('/unused-target', 'good-token', mkTmpSecretsPath(), TEST_SWARM_NAME, TEST_BRIDGE_PORT, failingPostFn);

  const result = await adapters.createNegotiationTopic('-100123');

  assert.equal(result.success, false);
  assert.equal(result.migrateToChatId, undefined);
});

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs returns all positional args when given, defaulting bridgePort when omitted', () => {
  assert.deepEqual(parseArgs(['/target', 'bot-token', 'bot-username', '/host/secrets.json', 'fes']), {
    targetRepoPath: '/target',
    botToken: 'bot-token',
    botUsername: 'bot-username',
    hostSecretsFilePath: '/host/secrets.json',
    swarmName: 'fes',
    bridgePort: 8765,
  });
});

test('parseArgs reads an explicit bridge port when given', () => {
  assert.deepEqual(parseArgs(['/target', 'bot-token', 'bot-username', '/host/secrets.json', 'fes', '9001']), {
    targetRepoPath: '/target',
    botToken: 'bot-token',
    botUsername: 'bot-username',
    hostSecretsFilePath: '/host/secrets.json',
    swarmName: 'fes',
    bridgePort: 9001,
  });
});

test('parseArgs returns null when no arguments are given', () => {
  assert.equal(parseArgs([]), null);
});

test('parseArgs returns null when the host secrets file path is missing', () => {
  assert.equal(parseArgs(['/target', 'bot-token', 'bot-username']), null);
});

test('parseArgs returns null when swarm-name is missing', () => {
  assert.equal(parseArgs(['/target', 'bot-token', 'bot-username', '/host/secrets.json']), null);
});

test('parseArgs returns null when the given bridge port is not a number', () => {
  assert.equal(parseArgs(['/target', 'bot-token', 'bot-username', '/host/secrets.json', 'fes', 'not-a-port']), null);
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
