const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseArgs,
  buildRelayAdapters,
  runPostProposal,
  runPoll,
  pollLoop,
  readRelayOffset,
  writeRelayOffset,
  launchNegotiationRelayScriptPath,
  main: relayMain,
} = require('../out/tools/relay-onboarding-negotiation-telegram');
const { main: proposeMain } = require('../out/tools/propose-onboarding-contract');
const { parseContractYaml } = require('../out/onboarding/contractView');
const { writeTelegramChannel } = require('../out/onboarding/telegramChannelStore');
const { storeTelegramBotToken } = require('../out/onboarding/telegramChannelSecretStore');

const VALID_FACTS = {
  languages: ['TypeScript'],
  layoutSummary: 'src/ + test/',
  readmeSummary: 'A CLI tool.',
  seedVision: 'Ship the MVP.',
  initialBacklogSummary: '5 tickets queued.',
  useCaseObservations: [],
};

const PROPOSE_CLI = path.join(__dirname, '..', 'out', 'tools', 'propose-onboarding-contract.js');
const RELAY_CLI = path.join(__dirname, '..', 'out', 'tools', 'relay-onboarding-negotiation-telegram.js');
const CHAT_ID = '-100123';
const NEGOTIATION_TOPIC_ID = 42;
const PRINCIPAL_ID = '111';

async function runMainInProcess(main, cliPath, argv, env = {}) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const previousEnv = {};
  for (const key of Object.keys(env)) {
    previousEnv[key] = process.env[key];
    process.env[key] = env[key];
  }
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', cliPath, ...argv];
    process.exitCode = undefined;
    await main();
    const exitCode = process.exitCode;
    const raw = writes.join('');
    return { exitCode, output: raw ? JSON.parse(raw) : null };
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
    for (const key of Object.keys(env)) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
}

async function runProposeCli(targetRepoPath, surveyFactsPath) {
  await runMainInProcess(proposeMain, PROPOSE_CLI, [targetRepoPath, surveyFactsPath]);
}

function runRelayCli(argv, env) {
  return runMainInProcess(relayMain, RELAY_CLI, argv, env);
}

// The git-repo + already-proposed-contract fixture is IDENTICAL for every
// test in this file - built ONCE (real `git init` + one real propose-CLI
// run), then each test takes a cheap `fs.cpSync` copy, mirroring
// negotiateOnboardingContractCli.test.js's own PREPARED_ROOT convention.
let PREPARED_ROOT;

beforeAll(async () => {
  PREPARED_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-onboarding-negotiation-prepared-'));
  execFileSync('git', ['init'], { cwd: PREPARED_ROOT });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: PREPARED_ROOT });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: PREPARED_ROOT });
  const surveyPath = path.join(PREPARED_ROOT, 'survey.json');
  fs.writeFileSync(surveyPath, JSON.stringify(VALID_FACTS));
  await runProposeCli(PREPARED_ROOT, surveyPath);
});

function mkTargetWithProposedContract() {
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-onboarding-negotiation-target-'));
  fs.cpSync(PREPARED_ROOT, targetRepo, { recursive: true });
  return targetRepo;
}

function mkSecretsPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-onboarding-negotiation-secrets-'));
  return path.join(dir, 'secrets.json');
}

function provisionChannelAndToken(targetRepo, secretsFile, botToken = 'sk-bot-token') {
  writeTelegramChannel(targetRepo, { chatId: CHAT_ID, negotiationTopicId: NEGOTIATION_TOPIC_ID });
  storeTelegramBotToken(secretsFile, targetRepo, botToken);
}

function readContract(targetRepo) {
  return parseContractYaml(fs.readFileSync(path.join(targetRepo, '.swarmforge', 'contract.yaml'), 'utf8'));
}

function mkUpdate({ updateId = 1, fromId = 111, chatId = CHAT_ID, topicId = NEGOTIATION_TOPIC_ID, text = 'also add accessibility support' } = {}) {
  return { update_id: updateId, message: { message_id: updateId, chat: { id: chatId }, from: { id: fromId }, message_thread_id: topicId, text } };
}

// ── buildRelayAdapters ──────────────────────────────────────────────────

test('buildRelayAdapters.objectToContract revises the real contract via runObject and returns it', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const adapters = buildRelayAdapters(targetRepo, 'unused-token', CHAT_ID, NEGOTIATION_TOPIC_ID);

  const result = await adapters.objectToContract('also add accessibility support');

  assert.equal(result.outcome, 'revised');
  assert.ok(result.contract.scope.some((s) => s.includes('accessibility support')));
  assert.deepEqual(result.contract, readContract(targetRepo));
});

test('buildRelayAdapters.objectToContract reports already-ended rather than throwing, once agreed', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const adapters = buildRelayAdapters(targetRepo, 'unused-token', CHAT_ID, NEGOTIATION_TOPIC_ID);
  await adapters.approveContract();

  const result = await adapters.objectToContract('too late');

  assert.deepEqual(result, { outcome: 'already-ended' });
});

test('buildRelayAdapters.objectToContract reports round-limit once the round cap is exhausted', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const adapters = buildRelayAdapters(targetRepo, 'unused-token', CHAT_ID, NEGOTIATION_TOPIC_ID);
  for (let round = 1; round <= 5; round += 1) {
    const result = await adapters.objectToContract(`objection round ${round}`);
    assert.equal(result.outcome, 'revised');
  }

  const result = await adapters.objectToContract('one objection past the cap');

  assert.deepEqual(result, { outcome: 'round-limit' });
});

test('buildRelayAdapters.objectToContract propagates a non-already-ended error rather than swallowing it', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const adapters = buildRelayAdapters(targetRepo, 'unused-token', CHAT_ID, NEGOTIATION_TOPIC_ID);
  fs.writeFileSync(path.join(targetRepo, '.swarmforge', 'contract.yaml'), 'not: a-valid-contract-shape\n');

  await assert.rejects(() => adapters.objectToContract('too late for a missing contract'), /missing or malformed/);
});

test('buildRelayAdapters.approveContract agrees the real contract via runApprove and returns it', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const adapters = buildRelayAdapters(targetRepo, 'unused-token', CHAT_ID, NEGOTIATION_TOPIC_ID);

  const result = await adapters.approveContract();

  assert.equal(result.outcome, 'agreed');
  assert.equal(result.contract.agreement, 'agreed');
  assert.deepEqual(result.contract, readContract(targetRepo));
});

test('buildRelayAdapters.approveContract reports already-ended rather than throwing, on a second approval', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const adapters = buildRelayAdapters(targetRepo, 'unused-token', CHAT_ID, NEGOTIATION_TOPIC_ID);
  await adapters.approveContract();

  const result = await adapters.approveContract();

  assert.deepEqual(result, { outcome: 'already-ended' });
});

test('buildRelayAdapters.approveContract propagates a non-already-ended error rather than swallowing it', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const adapters = buildRelayAdapters(targetRepo, 'unused-token', CHAT_ID, NEGOTIATION_TOPIC_ID);
  fs.writeFileSync(path.join(targetRepo, '.swarmforge', 'contract.yaml'), 'not: a-valid-contract-shape\n');

  await assert.rejects(() => adapters.approveContract(), /missing or malformed/);
});

test('buildRelayAdapters.postToTopic sends the text via the injected postFn to the negotiation topic', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const calls = [];
  const postFn = async (url, body) => {
    calls.push(JSON.parse(body));
    return { ok: true, status: 200, json: { result: { message_id: 1 } } };
  };
  const adapters = buildRelayAdapters(targetRepo, 'good-token', CHAT_ID, NEGOTIATION_TOPIC_ID, postFn);

  await adapters.postToTopic('hello negotiation topic');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].chat_id, CHAT_ID);
  assert.equal(calls[0].text, 'hello negotiation topic');
  assert.equal(calls[0].message_thread_id, NEGOTIATION_TOPIC_ID);
});

test('buildRelayAdapters.postToTopic does not throw when the send fails - it only logs', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const failingPostFn = async () => ({ ok: false, status: 401, json: { description: 'Unauthorized' } });
  const adapters = buildRelayAdapters(targetRepo, 'bad-token', CHAT_ID, NEGOTIATION_TOPIC_ID, failingPostFn);

  await assert.doesNotReject(() => adapters.postToTopic('anything'));
});

// ── runPostProposal (BL-381 scenario 01) ───────────────────────────────

// Every success-path test below injects this no-op in place of the real
// defaultLaunchRelaySupervisor (a real `child_process.spawn` of a bash
// script) - the "does it actually launch" wiring is its own dedicated test
// block further down, never exercised as a side effect of an unrelated test.
const noopLaunchRelaySupervisor = () => {};

test('runPostProposal posts the proposed contract into the negotiation topic', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  const calls = [];
  const postFn = async (url, body) => {
    calls.push(JSON.parse(body));
    return { ok: true, status: 200, json: { result: { message_id: 1 } } };
  };

  const outcome = await runPostProposal(targetRepo, secretsFile, postFn, noopLaunchRelaySupervisor);

  assert.equal(outcome.posted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message_thread_id, NEGOTIATION_TOPIC_ID);
  assert.match(calls[0].text, /Agreement: proposed/);
});

test('runPostProposal is idempotent - a second call is a no-op, no second post', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  const calls = [];
  const postFn = async (url, body) => {
    calls.push(JSON.parse(body));
    return { ok: true, status: 200, json: { result: { message_id: 1 } } };
  };

  await runPostProposal(targetRepo, secretsFile, postFn, noopLaunchRelaySupervisor);
  const second = await runPostProposal(targetRepo, secretsFile, postFn, noopLaunchRelaySupervisor);

  assert.equal(second.posted, false);
  assert.equal(calls.length, 1);
});

test('runPostProposal throws when contract.yaml is missing or malformed', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  fs.writeFileSync(path.join(targetRepo, '.swarmforge', 'contract.yaml'), 'not: a-valid-contract-shape\n');

  await assert.rejects(() => runPostProposal(targetRepo, secretsFile, undefined, noopLaunchRelaySupervisor), /missing or malformed/);
});

test('runPostProposal throws when the Telegram send fails', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  const failingPostFn = async () => ({ ok: false, status: 401, json: { description: 'Unauthorized' } });

  await assert.rejects(() => runPostProposal(targetRepo, secretsFile, failingPostFn, noopLaunchRelaySupervisor), /Unauthorized|401/);
});

test('runPostProposal throws when no channel has been provisioned yet', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();

  await assert.rejects(() => runPostProposal(targetRepo, secretsFile), /no provisioned Telegram channel/);
});

test('runPostProposal throws when no bot token has been stored for this target', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  writeTelegramChannel(targetRepo, { chatId: CHAT_ID, negotiationTopicId: NEGOTIATION_TOPIC_ID });

  await assert.rejects(() => runPostProposal(targetRepo, secretsFile), /no Telegram bot token found/);
});

// ── runPostProposal launches the negotiation-relay supervisor (BL-381
//    architect bounce: launch_negotiation_relay.sh had no live caller) ────

function poisonLaunchRelaySupervisor() {
  return () => {
    throw new Error('launchRelaySupervisor must not be called on this path');
  };
}

const successfulPostFn = async (url, body) => ({ ok: true, status: 200, json: { result: { message_id: 1 } } });

test('runPostProposal launches the relay supervisor exactly once, with the target repo path and secrets file path, after a real first post', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  const launchCalls = [];

  const outcome = await runPostProposal(targetRepo, secretsFile, successfulPostFn, (...args) => launchCalls.push(args));

  assert.equal(outcome.posted, true);
  assert.deepEqual(launchCalls, [[targetRepo, secretsFile]]);
});

test('runPostProposal does NOT launch the relay supervisor a second time on the idempotent no-op path', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  const launchCalls = [];

  await runPostProposal(targetRepo, secretsFile, successfulPostFn, (...args) => launchCalls.push(args));
  const second = await runPostProposal(targetRepo, secretsFile, successfulPostFn, (...args) => launchCalls.push(args));

  assert.equal(second.posted, false);
  assert.equal(launchCalls.length, 1);
});

test('runPostProposal does NOT launch the relay supervisor when the contract is missing or malformed', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  fs.writeFileSync(path.join(targetRepo, '.swarmforge', 'contract.yaml'), 'not: a-valid-contract-shape\n');

  await assert.rejects(() => runPostProposal(targetRepo, secretsFile, undefined, poisonLaunchRelaySupervisor()));
});

test('runPostProposal does NOT launch the relay supervisor when the Telegram send fails', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  const failingPostFn = async () => ({ ok: false, status: 401, json: { description: 'Unauthorized' } });

  await assert.rejects(() => runPostProposal(targetRepo, secretsFile, failingPostFn, poisonLaunchRelaySupervisor()));
});

test('runPostProposal does NOT launch the relay supervisor when no channel has been provisioned', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();

  await assert.rejects(() => runPostProposal(targetRepo, secretsFile, undefined, poisonLaunchRelaySupervisor()));
});

test('launchNegotiationRelayScriptPath resolves to the real launch_negotiation_relay.sh on disk (locks the __dirname math)', () => {
  const resolved = launchNegotiationRelayScriptPath();
  assert.equal(path.basename(resolved), 'launch_negotiation_relay.sh');
  assert.ok(fs.existsSync(resolved), `expected ${resolved} to exist`);
});

// A live incident during THIS ticket's own acceptance runs (before the
// steps file was fixed to inject a noop) leaked several real, bounded-
// restart-forever supervisor processes polling the real Telegram API with
// a fake token - the fixture's target repo lived under os.tmpdir() and
// nothing stopped the REAL defaultLaunchRelaySupervisor from firing. This
// test drives the REAL default adapter (no injected fake) against exactly
// that kind of fixture and proves the test-fixture-root safety net
// (mirroring daemon_alarm_lib.bb's own test-fixture-root?) suppresses it:
// no auto-launch log ever appears, which is what a real spawn would have
// written first.
test('runPostProposal, using the REAL default launcher, never actually spawns for a target repo under the system temp dir', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  const autoLaunchLog = path.join(targetRepo, '.swarmforge', 'operator', 'negotiation-relay-auto-launch.log');

  const outcome = await runPostProposal(targetRepo, secretsFile, successfulPostFn);

  assert.equal(outcome.posted, true);
  assert.equal(fs.existsSync(autoLaunchLog), false, 'expected no real spawn (and therefore no auto-launch log) for a temp-dir fixture');
});

// ── runPoll (BL-381 scenarios 02/04) ───────────────────────────────────

test('runPoll routes a fetched objection through to a revised contract posted in the topic', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  const posted = [];
  const postFn = async (url, body) => {
    const parsed = JSON.parse(body);
    if (url.endsWith('/getUpdates')) {
      return { ok: true, status: 200, json: { result: [mkUpdate({ updateId: 1, text: 'also add accessibility support' })] } };
    }
    posted.push(parsed);
    return { ok: true, status: 200, json: { result: { message_id: 1 } } };
  };

  const result = await runPoll(targetRepo, secretsFile, PRINCIPAL_ID, postFn);

  assert.equal(result.posted, 1);
  assert.equal(result.dropped, 0);
  assert.equal(posted.length, 1);
  assert.match(posted[0].text, /accessibility support/);
  assert.ok(readContract(targetRepo).scope.some((s) => s.includes('accessibility support')));
});

test('runPoll routes a fetched agreement through to approveContract, flipping the contract to agreed', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  const postFn = async (url) => {
    if (url.endsWith('/getUpdates')) {
      return { ok: true, status: 200, json: { result: [mkUpdate({ updateId: 1, text: 'agree' })] } };
    }
    return { ok: true, status: 200, json: { result: { message_id: 1 } } };
  };

  await runPoll(targetRepo, secretsFile, PRINCIPAL_ID, postFn);

  assert.equal(readContract(targetRepo).agreement, 'agreed');
});

test('runPoll persists the offset so a second (restarted) poll never reprocesses the same update', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  let getUpdatesCalls = 0;
  const postFn = async (url) => {
    if (url.endsWith('/getUpdates')) {
      getUpdatesCalls += 1;
      // The SAME update is returned both times, exactly as Telegram would
      // redeliver if the offset were not advanced - a correctly persisted
      // offset means the second poll's own getUpdates call carries the
      // NEW offset (asserted below), even though this fake always returns
      // the same fixed update regardless of what offset it was called with.
      return { ok: true, status: 200, json: { result: [mkUpdate({ updateId: 5, text: 'first objection' })] } };
    }
    return { ok: true, status: 200, json: { result: { message_id: 1 } } };
  };

  await runPoll(targetRepo, secretsFile, PRINCIPAL_ID, postFn);
  assert.equal(readRelayOffset(targetRepo), 6);
  assert.equal(getUpdatesCalls, 1);

  const bodies = [];
  const capturingPostFn = async (url, body) => {
    if (url.endsWith('/getUpdates')) {
      bodies.push(JSON.parse(body));
      return { ok: true, status: 200, json: { result: [] } };
    }
    return { ok: true, status: 200, json: { result: { message_id: 1 } } };
  };
  await runPoll(targetRepo, secretsFile, PRINCIPAL_ID, capturingPostFn);
  assert.equal(bodies[0].offset, 6);
});

test('runPoll surfaces a getUpdates failure as a thrown error, never silently swallowed', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  const failingPostFn = async () => ({ ok: false, status: 401, json: { description: 'Unauthorized' } });

  await assert.rejects(() => runPoll(targetRepo, secretsFile, PRINCIPAL_ID, failingPostFn), /Unauthorized|401/);
});

// ── pollLoop (BL-381 QA bounce: the live trigger for `poll`) ──────────────

test('pollLoop calls runPoll repeatedly, one getUpdates cycle per iteration, until a cycle fails', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  let getUpdatesCalls = 0;
  const postFn = async (url) => {
    if (url.endsWith('/getUpdates')) {
      getUpdatesCalls += 1;
      if (getUpdatesCalls >= 3) {
        return { ok: false, status: 401, json: { description: 'Unauthorized' } };
      }
      return { ok: true, status: 200, json: { result: [] } };
    }
    return { ok: true, status: 200, json: { result: { message_id: 1 } } };
  };

  await assert.rejects(() => pollLoop(targetRepo, secretsFile, PRINCIPAL_ID, postFn), /Unauthorized|401/);

  assert.equal(getUpdatesCalls, 3);
});

test('pollLoop writes a heartbeat after every successful cycle, so a supervisor can tell it is still alive', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  const heartbeatPath = path.join(targetRepo, '.swarmforge', 'operator', 'negotiation-relay-poll-heartbeat.json');
  let getUpdatesCalls = 0;
  const postFn = async (url) => {
    if (url.endsWith('/getUpdates')) {
      getUpdatesCalls += 1;
      if (getUpdatesCalls >= 2) {
        return { ok: false, status: 401, json: { description: 'Unauthorized' } };
      }
      return { ok: true, status: 200, json: { result: [] } };
    }
    return { ok: true, status: 200, json: { result: { message_id: 1 } } };
  };
  assert.equal(fs.existsSync(heartbeatPath), false);

  await assert.rejects(() => pollLoop(targetRepo, secretsFile, PRINCIPAL_ID, postFn));

  const heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8'));
  assert.equal(typeof heartbeat.lastHeartbeatMs, 'number');
});

test('pollLoop never writes a heartbeat for a cycle that failed - only completed cycles count as alive', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  const heartbeatPath = path.join(targetRepo, '.swarmforge', 'operator', 'negotiation-relay-poll-heartbeat.json');
  const failingPostFn = async () => ({ ok: false, status: 401, json: { description: 'Unauthorized' } });

  await assert.rejects(() => pollLoop(targetRepo, secretsFile, PRINCIPAL_ID, failingPostFn));

  assert.equal(fs.existsSync(heartbeatPath), false);
});

// ── readRelayOffset / writeRelayOffset ─────────────────────────────────

test('readRelayOffset returns 0 when no offset has ever been written', () => {
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-onboarding-negotiation-offset-'));
  assert.equal(readRelayOffset(targetRepo), 0);
});

test('writeRelayOffset then readRelayOffset round-trips the value', () => {
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-onboarding-negotiation-offset-'));
  writeRelayOffset(targetRepo, 17);
  assert.equal(readRelayOffset(targetRepo), 17);
});

test('readRelayOffset returns 0 when the persisted offset is not a number', () => {
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-onboarding-negotiation-offset-'));
  fs.mkdirSync(path.join(targetRepo, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(path.join(targetRepo, '.swarmforge', 'operator', 'negotiation-relay-offset.json'), JSON.stringify({ offset: 'not-a-number' }));
  assert.equal(readRelayOffset(targetRepo), 0);
});

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs accepts a post-proposal command', () => {
  assert.deepEqual(parseArgs(['/target', '/secrets.json', 'post-proposal']), {
    targetRepoPath: '/target',
    hostSecretsFilePath: '/secrets.json',
    action: 'post-proposal',
  });
});

test('parseArgs accepts a poll command when TELEGRAM_PRINCIPAL_USER_ID is set', () => {
  const previous = process.env.TELEGRAM_PRINCIPAL_USER_ID;
  process.env.TELEGRAM_PRINCIPAL_USER_ID = '111';
  try {
    assert.deepEqual(parseArgs(['/target', '/secrets.json', 'poll']), {
      targetRepoPath: '/target',
      hostSecretsFilePath: '/secrets.json',
      action: 'poll',
      principalUserId: '111',
    });
  } finally {
    if (previous === undefined) delete process.env.TELEGRAM_PRINCIPAL_USER_ID;
    else process.env.TELEGRAM_PRINCIPAL_USER_ID = previous;
  }
});

test('parseArgs rejects a poll command when TELEGRAM_PRINCIPAL_USER_ID is unset', () => {
  const previous = process.env.TELEGRAM_PRINCIPAL_USER_ID;
  delete process.env.TELEGRAM_PRINCIPAL_USER_ID;
  try {
    assert.equal(parseArgs(['/target', '/secrets.json', 'poll']), null);
  } finally {
    if (previous !== undefined) process.env.TELEGRAM_PRINCIPAL_USER_ID = previous;
  }
});

test('parseArgs accepts a poll-loop command when TELEGRAM_PRINCIPAL_USER_ID is set', () => {
  const previous = process.env.TELEGRAM_PRINCIPAL_USER_ID;
  process.env.TELEGRAM_PRINCIPAL_USER_ID = '111';
  try {
    assert.deepEqual(parseArgs(['/target', '/secrets.json', 'poll-loop']), {
      targetRepoPath: '/target',
      hostSecretsFilePath: '/secrets.json',
      action: 'poll-loop',
      principalUserId: '111',
    });
  } finally {
    if (previous === undefined) delete process.env.TELEGRAM_PRINCIPAL_USER_ID;
    else process.env.TELEGRAM_PRINCIPAL_USER_ID = previous;
  }
});

test('parseArgs rejects a poll-loop command when TELEGRAM_PRINCIPAL_USER_ID is unset', () => {
  const previous = process.env.TELEGRAM_PRINCIPAL_USER_ID;
  delete process.env.TELEGRAM_PRINCIPAL_USER_ID;
  try {
    assert.equal(parseArgs(['/target', '/secrets.json', 'poll-loop']), null);
  } finally {
    if (previous !== undefined) process.env.TELEGRAM_PRINCIPAL_USER_ID = previous;
  }
});

test('parseArgs returns null for an unknown action', () => {
  assert.equal(parseArgs(['/target', '/secrets.json', 'reject']), null);
});

test('parseArgs returns null when arguments are missing', () => {
  assert.equal(parseArgs([]), null);
});

test('parseArgs returns null when only the target repo path is missing', () => {
  assert.equal(parseArgs([undefined, '/secrets.json', 'post-proposal']), null);
});

test('parseArgs returns null when only the host secrets file path is missing', () => {
  assert.equal(parseArgs(['/target', undefined, 'post-proposal']), null);
});

test('parseArgs returns null when only the action is missing', () => {
  assert.equal(parseArgs(['/target', '/secrets.json']), null);
});

// ── the CLI's own main(), run in-process ──────────────────────────────────

// Drives main()'s real 'post-proposal' dispatch branch in-process, with no
// live network call: pre-creating the posted marker hits runPostProposal's
// own idempotent short-circuit (returns before ever reading the bot token
// or calling sendTelegramMessage) - a genuine, network-free way to exercise
// the branch a subprocess-only smoke test would leave coverage-invisible
// (the engineering article's CLI main()-thin-wrapper rule).
test("main() post-proposal dispatches to runPostProposal and prints its outcome", async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  fs.mkdirSync(path.join(targetRepo, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(path.join(targetRepo, '.swarmforge', 'operator', 'negotiation-topic-posted.json'), JSON.stringify({ posted: true }));

  const { exitCode, output } = await runRelayCli([targetRepo, secretsFile, 'post-proposal']);

  assert.equal(exitCode, undefined);
  assert.deepEqual(output, { posted: false });
});

test("main() poll dispatches to runPoll and prints its outcome", async () => {
  const targetRepo = mkTargetWithProposedContract();
  const secretsFile = mkSecretsPath();
  provisionChannelAndToken(targetRepo, secretsFile);
  // main()'s poll branch calls runPoll with no injected postFn, so it goes
  // through the real network seam (defaultPost's global fetch) - monkeypatch
  // it the same way recertWebhookVercelHandler.test.js does to keep this
  // in-process test network-free while still exercising main() itself.
  const originalFetch = global.fetch;
  global.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes('/getUpdates') ? { result: [] } : { result: { message_id: 1 } }),
  });
  let result;
  try {
    result = await runRelayCli([targetRepo, secretsFile, 'poll'], { TELEGRAM_PRINCIPAL_USER_ID: PRINCIPAL_ID });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(result.exitCode, undefined);
  assert.deepEqual(result.output, { nextOffset: 0, posted: 0, dropped: 0 });
});

test('main() sets a non-zero exit code and prints nothing when arguments are missing', async () => {
  const { exitCode, output } = await runRelayCli([]);
  assert.equal(exitCode, 1);
  assert.equal(output, null);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and prints usage on missing args', () => {
  try {
    execFileSync('node', [RELAY_CLI], { encoding: 'utf8', stdio: 'pipe' });
    assert.fail('expected the CLI to exit non-zero with no arguments');
  } catch (err) {
    assert.notEqual(err.status, 0);
    assert.match(err.stderr, /Usage: node relay-onboarding-negotiation-telegram\.js/);
  }
});
