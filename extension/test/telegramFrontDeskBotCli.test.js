const { mkTmpDir } = require('./helpers/tmpDir');
const { installInProcessTmux } = require('./helpers/fakeTmux');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseCliArgs,
  conciergeTickIntervalMs,
  readRoleTicket,
  toFoldersSnapshot,
  ensureOperatorTopic,
  ensureApprovalsTopic,
  ensureRecertTopic,
  ensureAgentQuestionsTopic,
  ensureControlTopic,
  controlDrainTimeoutMs,
  controlRestartAckTimeoutMs,
  controlPauseStatePath,
  readControlPauseState,
  writeControlPauseState,
  pendingControlConfirmPath,
  readPendingControlConfirm,
  writePendingControlConfirm,
  humanizePauseDurationMs,
  stopModesButtons,
  restartConfirmButtons,
  pauseMenuButtons,
  resumeNowButtons,
  isPipelineEmpty,
  killAllSwarmScriptPath,
  runKillAllSwarm,
  bounceSentinelPath,
  writeBounceSentinel,
  postControlMessage,
  executeStop,
  executeRestart,
  applyPause,
  resumeNow,
  readPollMap,
  writePollMap,
  pollMapPath,
  readAwaitingAnswer,
  ensureRoleTopics,
  resolveRolePaneTarget,
  redirectToRole,
  postOperatorContext,
  openSubjectAndRecord,
  standingTopicTargets,
  roleTopicTargets,
  iconStickersOnce,
  __resetIconStickersCacheForTest,
  transcribeVoiceNote,
  synthesizeVoiceReply,
  readRootIntakeFiles,
  readRepoBaseUrl,
  readApprovalAskMessages,
  recordApprovalAskMessage,
  approvalAskMessagesPath,
  main,
} = require('../out/tools/telegram-front-desk-bot');
const { readRecord: readTopicRecord } = require('../out/concierge/blTopicStore');
const { readRoleTopicMap, writeRoleTopicMap } = require('../out/concierge/roleTopicMapStore');

// parseNextSseRecord's own tests live in telegramFrontDeskBotCore.test.js -
// its implementation moved there (the testable core); this file re-exports
// it only for backward compatibility, so testing it again here would just
// be the same assertions against the same function through a second import
// path.

// ── parseCliArgs (pure) ───────────────────────────────────────────────────

test('parseCliArgs returns both positional args when given', () => {
  assert.deepEqual(parseCliArgs(['http://127.0.0.1:9000', '/some/target']), {
    bridgeUrl: 'http://127.0.0.1:9000',
    targetPath: '/some/target',
  });
});

test('parseCliArgs returns null when no arguments are given', () => {
  assert.equal(parseCliArgs([]), null);
});

test('parseCliArgs returns null when only the bridge url is given', () => {
  assert.equal(parseCliArgs(['http://127.0.0.1:9000']), null);
});

// ── conciergeTickIntervalMs (pure, BL-300) ───────────────────────────────

test('conciergeTickIntervalMs defaults to 30000ms when the env var is unset', () => {
  assert.equal(conciergeTickIntervalMs(undefined), 30_000);
});

test('conciergeTickIntervalMs uses a valid positive override', () => {
  assert.equal(conciergeTickIntervalMs('5000'), 5000);
});

test('conciergeTickIntervalMs falls back to the default for a non-numeric value', () => {
  assert.equal(conciergeTickIntervalMs('not-a-number'), 30_000);
});

test('conciergeTickIntervalMs falls back to the default for a non-positive value', () => {
  assert.equal(conciergeTickIntervalMs('0'), 30_000);
  assert.equal(conciergeTickIntervalMs('-100'), 30_000);
});

// ── readRoleTicket (thin fs adapter, BL-301) ─────────────────────────────
// A real .swarmforge/roles.tsv + real handoff fixtures - mirrors
// liveHolder.test.js/ticketHoldingWindows.test.js's own fixture shape,
// since readRoleTicket composes parseRolesTsv + readRoleHoldingWindows +
// computeCurrentHolders, all themselves tested against real fs elsewhere.

function mkTmp() {
  return mkTmpDir('sfvc-role-ticket-');
}

function writeRolesTsv(targetPath, roles) {
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  const tsv = roles.map((r) => [r.role, 'session', r.worktreePath, `swarmforge-${r.role}`, r.role, 'claude', 'task'].join('\t')).join('\n');
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), tsv + '\n');
}

function writeHandoff(worktreePath, subdir, filename, headers) {
  const dir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', subdir);
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, filename), lines.join('\n') + '\n\nbody\n');
}

test('readRoleTicket maps a role to the ticket its currently-open (in_process) handoff names', () => {
  const target = mkTmp();
  const coderWorktree = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWorktree }]);
  writeHandoff(coderWorktree, 'in_process', '00_test.handoff', {
    task: 'BL-123-a-fine-feature',
    dequeued_at: '2026-07-09T08:00:00Z',
  });

  assert.deepEqual(readRoleTicket(target), { coder: 'BL-123' });
});

test('readRoleTicket omits a role with no currently-open window (only completed handoffs)', () => {
  const target = mkTmp();
  const coderWorktree = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWorktree }]);
  writeHandoff(coderWorktree, 'completed', '00_test.handoff', {
    task: 'BL-123-a-fine-feature',
    dequeued_at: '2026-07-09T08:00:00Z',
    completed_at: '2026-07-09T09:00:00Z',
  });

  assert.deepEqual(readRoleTicket(target), {});
});

test('readRoleTicket maps multiple roles to their own held tickets independently', () => {
  const target = mkTmp();
  const coderWorktree = mkTmp();
  const cleanerWorktree = mkTmp();
  writeRolesTsv(target, [
    { role: 'coder', worktreePath: coderWorktree },
    { role: 'cleaner', worktreePath: cleanerWorktree },
  ]);
  writeHandoff(coderWorktree, 'in_process', '00_test.handoff', { task: 'BL-1-x', dequeued_at: '2026-07-09T08:00:00Z' });
  writeHandoff(cleanerWorktree, 'in_process', '00_test.handoff', { task: 'BL-2-y', dequeued_at: '2026-07-09T08:00:00Z' });

  assert.deepEqual(readRoleTicket(target), { coder: 'BL-1', cleaner: 'BL-2' });
});

test('readRoleTicket returns an empty map when roles.tsv is missing (never a crash)', () => {
  const target = mkTmp();
  assert.deepEqual(readRoleTicket(target), {});
});

// ── main() wiring (no real network - every case below fails before any
// request, well before main()'s own Promise.all of three forever-loops:
// each requiredEnv() check runs strictly before ensureOperatorTopic() and
// the poll/reply-relay/concierge-tick loops, so none of these ever reach a
// real network call or an unbounded await - safe to run in-process) ────────

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'telegram-front-desk-bot.js');

function runCliSubprocess(args, env) {
  try {
    const out = execFileSync('node', [CLI_PATH, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 5000 });
    return { exitCode: 0, stdout: out };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout, stderr: err.stderr };
  }
}

// Runs the REAL main() in-process, so in-process coverage and mutation
// tooling can see the argv/env guard branches a subprocess-only smoke test
// cannot (the engineering article's CLI main()-thin-wrapper rule). main()
// reads process.argv directly (no parameters) and writes its usage message
// via process.stderr.write directly (not console.error, so no Vitest
// console-interception gap on that branch); a later requiredEnv() throw is
// caught here and folded into the SAME "Fatal error: <message>" shape
// runCliMain's own reportFatalAndExit would have produced on stderr for a
// real standalone run. An explicit ALLOWLIST env, never {...process.env,
// ...overrides} - this box's own shell exports the REAL Telegram bot token
// globally.
const ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_PRINCIPAL_USER_ID', 'BRIDGE_TOKEN', 'BRIDGE_CONTROL_TOKEN'];
async function runCli(args, overrides = {}) {
  const previousArgv = process.argv;
  const previousEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const previousExitCode = process.exitCode;
  const stdoutChunks = [];
  const stderrChunks = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    stdoutChunks.push(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    stderrChunks.push(chunk);
    return true;
  };
  process.argv = ['node', CLI_PATH, ...args];
  for (const key of ENV_KEYS) {
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  process.exitCode = undefined;

  let exitCode = 0;
  try {
    await main();
    exitCode = process.exitCode ?? 0;
  } catch (error) {
    stderrChunks.push(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
    exitCode = 1;
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
  return { exitCode, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
}

test('no args: exits non-zero and prints usage to stderr', async () => {
  const result = await runCli([], {});
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /Usage: telegram-front-desk-bot\.js/);
});

test('a missing TELEGRAM_BOT_TOKEN exits non-zero with a clear message, never a raw network error', async () => {
  const result = await runCli(['http://127.0.0.1:1', '/tmp/nonexistent-target'], { TELEGRAM_BOT_TOKEN: '' });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /TELEGRAM_BOT_TOKEN is not set/);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result: a missing BRIDGE_CONTROL_TOKEN exits non-zero with a clear message', () => {
  const result = runCliSubprocess(['http://127.0.0.1:1', '/tmp/nonexistent-target'], {
    TELEGRAM_BOT_TOKEN: 'fake',
    TELEGRAM_CHAT_ID: 'fake',
    TELEGRAM_PRINCIPAL_USER_ID: '111',
    BRIDGE_TOKEN: 'fake',
    BRIDGE_CONTROL_TOKEN: '',
  });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /BRIDGE_CONTROL_TOKEN is not set/);
});

// ── ensureOperatorTopic (BL-346 standing-operator-topic-01/06/07) ────────

function mkTmpRoot() {
  return mkTmpDir('sfvc-operator-topic-');
}

function topicMapPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json');
}

function readTopicMapFixture(root) {
  return JSON.parse(fs.readFileSync(topicMapPath(root), 'utf8'));
}

function writeTopicMapFixture(root, map) {
  fs.mkdirSync(path.dirname(topicMapPath(root)), { recursive: true });
  fs.writeFileSync(topicMapPath(root), JSON.stringify(map));
}

// BL-453: the {subjectId: title} rename change-gate marker.
function standingTopicTitlesPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'telegram-standing-topic-titles.json');
}

function writeStandingTopicTitlesFixture(root, titles) {
  fs.mkdirSync(path.dirname(standingTopicTitlesPath(root)), { recursive: true });
  fs.writeFileSync(standingTopicTitlesPath(root), JSON.stringify(titles));
}

function readStandingTopicTitlesFixture(root) {
  return JSON.parse(fs.readFileSync(standingTopicTitlesPath(root), 'utf8'));
}

// Mirrors telegramClient.test.js's own fake postFn convention - never a
// real network call.
function fakeCreateOk(threadId) {
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: threadId, name: 'Operator' } } };
  };
  return { postFn, calls };
}

test('BL-346 standing-operator-topic-01: creates the Operator topic and binds it to the reserved subject when the map has no binding yet', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeCreateOk(42);
  await ensureOperatorTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 1);
  const map = readTopicMapFixture(root);
  assert.equal(map['42'], 'OPERATOR');
});

// ── openSubjectAndRecord idempotency (BL-389 rework, architect bounce) ──
// A redelivered update (offset never advanced - e.g. a crash between
// openSubject minting a fresh SUP-### and the topicId mapping being
// persisted) used to mint a SECOND, duplicate SUP-### for the same
// original conversation opener. The REDELIVERY case itself never needs to
// shell out to support_thread.bb at all (it short-circuits on the
// already-recorded updateId), so it is fully testable here with no real
// `bb` subprocess involved - proof this returns the EXISTING subjectId and
// writes nothing new, not merely that it "would" behave that way.

test('BL-389 rework: openSubjectAndRecord returns the EXISTING subjectId for an already-opened updateId, without writing anything new', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '7': 'SUP-500', 'update:900': 'SUP-500' });
  const before = fs.readFileSync(topicMapPath(root), 'utf8');

  const subjectId = await openSubjectAndRecord(root, 7, 'a redelivered message', 900);

  assert.equal(subjectId, 'SUP-500');
  assert.equal(fs.readFileSync(topicMapPath(root), 'utf8'), before, 'expected no write at all for an already-opened update');
});

test('BL-389 rework: a DIFFERENT updateId for the same topic is not short-circuited by an unrelated updateId already on record', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '7': 'SUP-500', 'update:900': 'SUP-500' });

  // A genuinely new updateId (901, never 900) must NOT hit the short-circuit
  // - it would proceed to mint via the real support_thread.bb CLI, which
  // this fixture root has none of, so the call is expected to reject rather
  // than silently return the OTHER update's subjectId.
  await assert.rejects(() => openSubjectAndRecord(root, 7, 'a genuinely new message', 901));
});

// BL-453: the Operator standing topic is rebranded "Concierge".
test('the create call names the topic "Concierge"', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeCreateOk(7);
  await ensureOperatorTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.match(calls[0].url, /createForumTopic$/);
  assert.match(calls[0].body, /"name":"Concierge"/);
});

test('BL-346 standing-operator-topic-06: a map that already binds the reserved subject never creates a second topic', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'OPERATOR' });
  // BL-453: the title is already recorded as current, so the rename
  // change-gate is also a no-op here - this test's own concern is
  // create-avoidance, not the rename behavior (covered separately below).
  writeStandingTopicTitlesFixture(root, { OPERATOR: 'Concierge' });
  const { postFn, calls } = fakeCreateOk(999);
  await ensureOperatorTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 0);
  assert.deepEqual(readTopicMapFixture(root), { '42': 'OPERATOR' });
});

test('BL-346 standing-operator-topic-07: a reserved subject absent from the map is created again, bound to the SAME subject id as before', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '7': 'SUP-1' }); // ordinary support subjects, no Operator binding
  const { postFn, calls } = fakeCreateOk(55);
  await ensureOperatorTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 1);
  const map = readTopicMapFixture(root);
  assert.equal(map['55'], 'OPERATOR');
  assert.equal(map['7'], 'SUP-1');
});

test('a failed create degrades quietly - never throws, never writes a partial binding', async () => {
  const root = mkTmpRoot();
  const postFn = async () => ({ ok: false, status: 500, json: { description: 'simulated failure' } });
  await ensureOperatorTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(fs.existsSync(topicMapPath(root)), false);
});

// BL-358: ensureOperatorTopic now RETURNS the resolved topicId, so
// topicRouter.ts's RouteAdapters.ensureOperatorTopic can wire straight to
// it - the pre-poll-loop call site above ignores the return value, this is
// the NEW caller's own contract.

test('BL-358: a freshly created Operator topic returns its own new topicId', async () => {
  const root = mkTmpRoot();
  const { postFn } = fakeCreateOk(42);
  const topicId = await ensureOperatorTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(topicId, 42);
});

test('BL-358: an already-bound Operator topic returns its existing topicId, without calling create', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'OPERATOR' });
  writeStandingTopicTitlesFixture(root, { OPERATOR: 'Concierge' }); // BL-453: rename already up to date too
  const { postFn, calls } = fakeCreateOk(999);
  const topicId = await ensureOperatorTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(topicId, 42);
  assert.equal(calls.length, 0);
});

test('BL-358: a failed create returns undefined, never a fabricated topicId', async () => {
  const root = mkTmpRoot();
  const postFn = async () => ({ ok: false, status: 500, json: { description: 'simulated failure' } });
  const topicId = await ensureOperatorTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(topicId, undefined);
});

// ── BL-453: Operator -> Concierge rebrand renames the already-bound topic ──

test('BL-453 concierge-icon-02/03: an already-bound topic with no title recorded yet (a pre-BL-453 install) is renamed to Concierge', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'OPERATOR' });
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: {} } };
  };
  const topicId = await ensureOperatorTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /editForumTopic$/);
  assert.match(calls[0].body, /"message_thread_id":42/);
  assert.match(calls[0].body, /"name":"Concierge"/);
  assert.equal(readStandingTopicTitlesFixture(root).OPERATOR, 'Concierge');
  assert.equal(topicId, 42, 'the durable binding id is unchanged - the same topic is reused, never re-created');
});

test('BL-453: an already-bound topic with a STALE recorded title ("Operator") is renamed to Concierge', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'OPERATOR' });
  writeStandingTopicTitlesFixture(root, { OPERATOR: 'Operator' });
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: {} } };
  };
  await ensureOperatorTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /editForumTopic$/);
  assert.equal(readStandingTopicTitlesFixture(root).OPERATOR, 'Concierge');
});

test('BL-453: a rename that fails degrades quietly - never throws, never records the marker (retries next time)', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'OPERATOR' });
  const postFn = async () => ({ ok: false, status: 500, json: { description: 'simulated failure' } });
  const topicId = await ensureOperatorTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(topicId, 42, 'the rename failing must never lose the resolved topicId');
  assert.equal(fs.existsSync(standingTopicTitlesPath(root)), false);
});

test('BL-453: a freshly created topic records its own title, so an immediate later reuse never fires a redundant rename', async () => {
  const root = mkTmpRoot();
  const { postFn: createPostFn } = fakeCreateOk(77);
  await ensureOperatorTopic(root, 'fake-token', 'fake-chat', createPostFn);
  assert.equal(readStandingTopicTitlesFixture(root).OPERATOR, 'Concierge');

  const calls = [];
  const reusePostFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: {} } };
  };
  const topicId = await ensureOperatorTopic(root, 'fake-token', 'fake-chat', reusePostFn);
  assert.equal(topicId, 77);
  assert.equal(calls.length, 0, 'expected no rename call - the create-time title is already correct');
});

// ── ensureApprovalsTopic (BL-434, mirrors ensureOperatorTopic above) ─────

test('BL-434: creates the Approvals topic and binds it to the reserved subject when the map has no binding yet', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeCreateOk(42);
  await ensureApprovalsTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 1);
  const map = readTopicMapFixture(root);
  assert.equal(map['42'], 'APPROVALS');
});

test('BL-434: the create call names the topic "Approvals"', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeCreateOk(7);
  await ensureApprovalsTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.match(calls[0].url, /createForumTopic$/);
  assert.match(calls[0].body, /"name":"Approvals"/);
});

test('BL-434: a map that already binds the reserved Approvals subject never creates a second topic', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'APPROVALS' });
  const { postFn, calls } = fakeCreateOk(999);
  await ensureApprovalsTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 0);
  assert.deepEqual(readTopicMapFixture(root), { '42': 'APPROVALS' });
});

test('BL-434: the Approvals topic and the Operator topic bind independently in the SAME map, never colliding', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'OPERATOR' });
  const { postFn, calls } = fakeCreateOk(55);
  const topicId = await ensureApprovalsTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 1);
  assert.equal(topicId, 55);
  const map = readTopicMapFixture(root);
  assert.equal(map['55'], 'APPROVALS');
  assert.equal(map['42'], 'OPERATOR');
});

test('BL-434: a failed create degrades quietly - never throws, never writes a partial binding', async () => {
  const root = mkTmpRoot();
  const postFn = async () => ({ ok: false, status: 500, json: { description: 'simulated failure' } });
  const topicId = await ensureApprovalsTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(topicId, undefined);
  assert.equal(fs.existsSync(topicMapPath(root)), false);
});

test('BL-434: an already-bound Approvals topic returns its existing topicId, without calling create', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'APPROVALS' });
  const { postFn, calls } = fakeCreateOk(999);
  const topicId = await ensureApprovalsTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(topicId, 42);
  assert.equal(calls.length, 0);
});

// ── ensureRecertTopic (BL-450, mirrors ensureApprovalsTopic above) ───────

test('BL-450: creates the Recert topic and binds it to the reserved subject when the map has no binding yet', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeCreateOk(42);
  await ensureRecertTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 1);
  const map = readTopicMapFixture(root);
  assert.equal(map['42'], 'RECERT');
});

test('BL-450: the create call names the topic "Recert"', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeCreateOk(7);
  await ensureRecertTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.match(calls[0].url, /createForumTopic$/);
  assert.match(calls[0].body, /"name":"Recert"/);
});

test('BL-450: a map that already binds the reserved Recert subject never creates a second topic', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'RECERT' });
  const { postFn, calls } = fakeCreateOk(999);
  await ensureRecertTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 0);
  assert.deepEqual(readTopicMapFixture(root), { '42': 'RECERT' });
});

test('BL-450: the Recert topic and the Approvals topic bind independently in the SAME map, never colliding', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'APPROVALS' });
  const { postFn, calls } = fakeCreateOk(55);
  const topicId = await ensureRecertTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 1);
  assert.equal(topicId, 55);
  const map = readTopicMapFixture(root);
  assert.equal(map['55'], 'RECERT');
  assert.equal(map['42'], 'APPROVALS');
});

test('BL-450: a failed create degrades quietly - never throws, never writes a partial binding', async () => {
  const root = mkTmpRoot();
  const postFn = async () => ({ ok: false, status: 500, json: { description: 'simulated failure' } });
  const topicId = await ensureRecertTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(topicId, undefined);
  assert.equal(fs.existsSync(topicMapPath(root)), false);
});

test('BL-450: an already-bound Recert topic returns its existing topicId, without calling create', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'RECERT' });
  const { postFn, calls } = fakeCreateOk(999);
  const topicId = await ensureRecertTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(topicId, 42);
  assert.equal(calls.length, 0);
});

// ── ensureAgentQuestionsTopic (BL-466, mirrors ensureRecertTopic above) ──

test('BL-466: creates the Agent Questions topic and binds it to the reserved subject when the map has no binding yet', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeCreateOk(42);
  await ensureAgentQuestionsTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 1);
  const map = readTopicMapFixture(root);
  assert.equal(map['42'], 'AGENT_QUESTIONS');
});

test('BL-466: the create call names the topic "Agent Questions"', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeCreateOk(7);
  await ensureAgentQuestionsTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.match(calls[0].url, /createForumTopic$/);
  assert.match(calls[0].body, /"name":"Agent Questions"/);
});

test('BL-466: a map that already binds the reserved Agent Questions subject never creates a second topic', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'AGENT_QUESTIONS' });
  const { postFn, calls } = fakeCreateOk(999);
  await ensureAgentQuestionsTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 0);
  assert.deepEqual(readTopicMapFixture(root), { '42': 'AGENT_QUESTIONS' });
});

test('BL-466: the Agent Questions topic and the Recert topic bind independently in the SAME map, never colliding', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'RECERT' });
  const { postFn, calls } = fakeCreateOk(55);
  const topicId = await ensureAgentQuestionsTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 1);
  assert.equal(topicId, 55);
  const map = readTopicMapFixture(root);
  assert.equal(map['55'], 'AGENT_QUESTIONS');
  assert.equal(map['42'], 'RECERT');
});

test('BL-466: a failed create degrades quietly - never throws, never writes a partial binding', async () => {
  const root = mkTmpRoot();
  const postFn = async () => ({ ok: false, status: 500, json: { description: 'simulated failure' } });
  const topicId = await ensureAgentQuestionsTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(topicId, undefined);
  assert.equal(fs.existsSync(topicMapPath(root)), false);
});

test('BL-466: an already-bound Agent Questions topic returns its existing topicId, without calling create', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'AGENT_QUESTIONS' });
  const { postFn, calls } = fakeCreateOk(999);
  const topicId = await ensureAgentQuestionsTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(topicId, 42);
  assert.equal(calls.length, 0);
});

// ── ensureControlTopic (BL-423, mirrors ensureAgentQuestionsTopic above) ──

test('BL-423: creates the Control topic and binds it to the reserved subject when the map has no binding yet', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeCreateOk(42);
  await ensureControlTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 1);
  const map = readTopicMapFixture(root);
  assert.equal(map['42'], 'CONTROL');
});

test('BL-423: the create call names the topic "Control"', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeCreateOk(7);
  await ensureControlTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.match(calls[0].url, /createForumTopic$/);
  assert.match(calls[0].body, /"name":"Control"/);
});

test('BL-423: a map that already binds the reserved Control subject never creates a second topic', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'CONTROL' });
  const { postFn, calls } = fakeCreateOk(999);
  await ensureControlTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 0);
  assert.deepEqual(readTopicMapFixture(root), { '42': 'CONTROL' });
});

test('BL-423: the Control topic and the Agent Questions topic bind independently in the SAME map, never colliding', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'AGENT_QUESTIONS' });
  const { postFn, calls } = fakeCreateOk(55);
  const topicId = await ensureControlTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(calls.length, 1);
  assert.equal(topicId, 55);
  const map = readTopicMapFixture(root);
  assert.equal(map['55'], 'CONTROL');
  assert.equal(map['42'], 'AGENT_QUESTIONS');
});

test('BL-423: a failed create degrades quietly - never throws, never writes a partial binding', async () => {
  const root = mkTmpRoot();
  const postFn = async () => ({ ok: false, status: 500, json: { description: 'simulated failure' } });
  const topicId = await ensureControlTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(topicId, undefined);
  assert.equal(fs.existsSync(topicMapPath(root)), false);
});

test('BL-423: an already-bound Control topic returns its existing topicId, without calling create', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'CONTROL' });
  const { postFn, calls } = fakeCreateOk(999);
  const topicId = await ensureControlTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.equal(topicId, 42);
  assert.equal(calls.length, 0);
});

// ── controlDrainTimeoutMs / controlRestartAckTimeoutMs (BL-423, pure, mirrors conciergeTickIntervalMs) ──

test('controlDrainTimeoutMs defaults to 10 minutes when the env var is unset', () => {
  assert.equal(controlDrainTimeoutMs(undefined), 10 * 60 * 1000);
});

test('controlDrainTimeoutMs uses a valid positive override', () => {
  assert.equal(controlDrainTimeoutMs('5000'), 5000);
});

test('controlDrainTimeoutMs falls back to the default for a non-numeric or non-positive value', () => {
  assert.equal(controlDrainTimeoutMs('not-a-number'), 10 * 60 * 1000);
  assert.equal(controlDrainTimeoutMs('0'), 10 * 60 * 1000);
  assert.equal(controlDrainTimeoutMs('-5'), 10 * 60 * 1000);
});

test('controlRestartAckTimeoutMs defaults to 5 minutes when the env var is unset', () => {
  assert.equal(controlRestartAckTimeoutMs(undefined), 5 * 60 * 1000);
});

test('controlRestartAckTimeoutMs uses a valid positive override', () => {
  assert.equal(controlRestartAckTimeoutMs('1500'), 1500);
});

// ── readControlPauseState / writeControlPauseState (BL-423 pause marker) ──
// backlog_depth_lib.bb's own read-pause-state reads this EXACT file on the
// Babashka side - the cross-language contract this proves.

test('readControlPauseState degrades to inactive when no marker has ever been written', () => {
  const root = mkTmpRoot();
  assert.deepEqual(readControlPauseState(root), { active: false });
});

test('readControlPauseState degrades to inactive for a malformed marker file, never a crash', () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.dirname(controlPauseStatePath(root)), { recursive: true });
  fs.writeFileSync(controlPauseStatePath(root), 'not json');
  assert.deepEqual(readControlPauseState(root), { active: false });
});

test('writeControlPauseState/readControlPauseState round-trips a timed pause', () => {
  const root = mkTmpRoot();
  writeControlPauseState(root, { active: true, untilMs: 1784300000000 });
  assert.deepEqual(readControlPauseState(root), { active: true, untilMs: 1784300000000 });
});

test('writeControlPauseState/readControlPauseState round-trips an "until I resume" pause (no untilMs)', () => {
  const root = mkTmpRoot();
  writeControlPauseState(root, { active: true, untilMs: undefined });
  assert.deepEqual(readControlPauseState(root), { active: true, untilMs: undefined });
});

test('writeControlPauseState/readControlPauseState round-trips an explicit inactive (post-resume) state', () => {
  const root = mkTmpRoot();
  writeControlPauseState(root, { active: true, untilMs: 1000 });
  writeControlPauseState(root, { active: false });
  assert.deepEqual(readControlPauseState(root), { active: false });
});

// ── readPendingControlConfirm / writePendingControlConfirm (BL-423) ───────

test('readPendingControlConfirm is undefined when no marker has ever been written', () => {
  const root = mkTmpRoot();
  assert.equal(readPendingControlConfirm(root), undefined);
});

test('readPendingControlConfirm is undefined for a malformed marker file, never a crash', () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.dirname(pendingControlConfirmPath(root)), { recursive: true });
  fs.writeFileSync(pendingControlConfirmPath(root), 'not json');
  assert.equal(readPendingControlConfirm(root), undefined);
});

test('writePendingControlConfirm/readPendingControlConfirm round-trips a stop-modes confirm', () => {
  const root = mkTmpRoot();
  writePendingControlConfirm(root, { kind: 'stop-modes' });
  assert.deepEqual(readPendingControlConfirm(root), { kind: 'stop-modes' });
});

test('writePendingControlConfirm/readPendingControlConfirm round-trips a restart-confirm', () => {
  const root = mkTmpRoot();
  writePendingControlConfirm(root, { kind: 'restart-confirm' });
  assert.deepEqual(readPendingControlConfirm(root), { kind: 'restart-confirm' });
});

test('writePendingControlConfirm(undefined) clears an armed confirm entirely (the marker file is removed)', () => {
  const root = mkTmpRoot();
  writePendingControlConfirm(root, { kind: 'stop-modes' });
  writePendingControlConfirm(root, undefined);
  assert.equal(fs.existsSync(pendingControlConfirmPath(root)), false);
  assert.equal(readPendingControlConfirm(root), undefined);
});

test('writePendingControlConfirm(undefined) is a safe no-op when no marker exists yet', () => {
  const root = mkTmpRoot();
  fs.mkdirSync(root, { recursive: true });
  assert.doesNotThrow(() => writePendingControlConfirm(root, undefined));
});

// ── humanizePauseDurationMs (BL-423, pure) ────────────────────────────────

test('humanizePauseDurationMs renders a sub-hour duration in minutes', () => {
  assert.equal(humanizePauseDurationMs(15 * 60 * 1000), 'for 15 min');
});

test('humanizePauseDurationMs renders an hour-plus duration in hours', () => {
  assert.equal(humanizePauseDurationMs(60 * 60 * 1000), 'for 1 hr');
  assert.equal(humanizePauseDurationMs(4 * 60 * 60 * 1000), 'for 4 hr');
});

// ── button builders (BL-423, pure - just the shape Telegram's own inline
//    keyboard expects, callback_data drawn from telegramControlCore.ts's
//    own CONTROL_CALLBACK_DATA so a tap always round-trips through the
//    SAME parser that built it) ─────────────────────────────────────────

test('stopModesButtons offers Drain & stop / Emergency stop on one row and Cancel on its own row', () => {
  assert.deepEqual(stopModesButtons(), [
    [
      { text: 'Drain & stop', callbackData: 'control:drain-stop' },
      { text: 'Emergency stop', callbackData: 'control:emergency-stop' },
    ],
    [{ text: 'Cancel', callbackData: 'control:cancel' }],
  ]);
});

test('restartConfirmButtons offers Confirm restart and Cancel on one row', () => {
  assert.deepEqual(restartConfirmButtons(), [
    [
      { text: 'Confirm restart', callbackData: 'control:confirm-restart' },
      { text: 'Cancel', callbackData: 'control:cancel' },
    ],
  ]);
});

test('pauseMenuButtons offers 15 min / 1 hr / 4 hr on one row and Until I resume on its own row', () => {
  assert.deepEqual(pauseMenuButtons(), [
    [
      { text: '15 min', callbackData: 'control:pause-15m' },
      { text: '1 hr', callbackData: 'control:pause-1h' },
      { text: '4 hr', callbackData: 'control:pause-4h' },
    ],
    [{ text: 'Until I resume', callbackData: 'control:pause-until-resume' }],
  ]);
});

test('resumeNowButtons offers a single Resume now button', () => {
  assert.deepEqual(resumeNowButtons(), [[{ text: 'Resume now', callbackData: 'control:resume-now' }]]);
});

// ── postControlMessage (BL-423) ───────────────────────────────────────────

function fakeSendOk(messageId) {
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: { message_id: messageId } } };
  };
  return { postFn, calls };
}

// BL-423 architect follow-up: executeStop/executeRestart's own drain/
// restart-ack poll loops take an injected now()/wait() (defaulting to the
// real clock/setTimeout in production) - this fake advances a virtual
// clock on every wait() call with NO real delay at all, so a test that
// needs the loop to cross its own timeout can do so in ~0ms rather than
// taking real wall-clock seconds.
function fakeClock(startMs = 0) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

test('postControlMessage sends nothing at all when the Control topic is not yet bound (controlTopicId undefined)', async () => {
  const { postFn, calls } = fakeSendOk(1);
  await postControlMessage('fake-token', 'fake-chat', undefined, 'hello', undefined, postFn);
  assert.equal(calls.length, 0);
});

test('postControlMessage sends into the given Control topic id, with buttons when given', async () => {
  const { postFn, calls } = fakeSendOk(1);
  await postControlMessage('fake-token', 'fake-chat', 900, 'Stop the swarm how?', stopModesButtons(), postFn);
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.message_thread_id, 900);
  assert.equal(body.text, 'Stop the swarm how?');
  assert.deepEqual(body.reply_markup.inline_keyboard[1], [{ text: 'Cancel', callback_data: 'control:cancel' }]);
});

// ── isPipelineEmpty (BL-423) ───────────────────────────────────────────────

// Column order per swarmState.ts's own parseRolesTsv: role, worktreeName,
// worktreePath, <unused>, displayName, agent.
function writeRolesTsvFixture(root, roleName, worktreePath) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `${roleName}\t${roleName}\t${worktreePath}\t_\t${roleName}\tclaude\n`
  );
}

test('isPipelineEmpty is true when no role has any inbox/new or in_process work', () => {
  const root = mkTmpRoot();
  writeRolesTsvFixture(root, 'coder', root);
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  assert.equal(isPipelineEmpty(root), true);
});

test('isPipelineEmpty is false when a role has a queued inbox/new handoff', () => {
  const root = mkTmpRoot();
  writeRolesTsvFixture(root, 'coder', root);
  const newDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new');
  fs.mkdirSync(newDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  fs.writeFileSync(path.join(newDir, 'BL-1.handoff'), 'type: note\nto: coder\npriority: 50\n\nhi\n');
  assert.equal(isPipelineEmpty(root), false);
});

test('isPipelineEmpty is false when a role has in-flight (in_process) work', () => {
  const root = mkTmpRoot();
  writeRolesTsvFixture(root, 'coder', root);
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  const inProcessDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(inProcessDir, { recursive: true });
  fs.writeFileSync(path.join(inProcessDir, 'BL-1.handoff'), 'type: note\nto: coder\npriority: 50\n\nhi\n');
  assert.equal(isPipelineEmpty(root), false);
});

// ── runKillAllSwarm / executeStop (BL-423) ─────────────────────────────────

function writeFakeKillAllSwarm(root, body) {
  const scriptPath = killAllSwarmScriptPath(root);
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

test('runKillAllSwarm reports ok on a successful teardown script', async () => {
  const root = mkTmpRoot();
  writeFakeKillAllSwarm(root, 'echo "SwarmForge stopped and cleaned."; exit 0');
  const result = await runKillAllSwarm(root);
  assert.equal(result.ok, true);
  assert.match(result.output, /stopped and cleaned/);
});

test('runKillAllSwarm degrades to ok:false, never throws, when the teardown script fails', async () => {
  const root = mkTmpRoot();
  writeFakeKillAllSwarm(root, 'echo "survivors remain" >&2; exit 1');
  const result = await runKillAllSwarm(root);
  assert.equal(result.ok, false);
});

test('BL-423: executeStop in emergency mode tears down immediately with no drain wait, and reports it', async () => {
  const root = mkTmpRoot();
  writeFakeKillAllSwarm(root, 'exit 0');
  const { postFn, calls } = fakeSendOk(1);
  await executeStop(root, 'fake-token', 'fake-chat', 900, 'emergency', postFn);
  const texts = calls.map((c) => JSON.parse(c.body).text);
  assert.ok(texts.some((t) => /Emergency stop/.test(t)));
  assert.ok(texts.some((t) => /Stop complete: stopped \(emergency\)/.test(t)));
});

test('BL-423: executeStop in drain mode reports drained once the pipeline is already empty', async () => {
  const root = mkTmpRoot();
  writeRolesTsvFixture(root, 'coder', root);
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  writeFakeKillAllSwarm(root, 'exit 0');
  const { postFn, calls } = fakeSendOk(1);
  const clock = fakeClock();
  let waitCalls = 0;
  await executeStop(root, 'fake-token', 'fake-chat', 900, 'drain', postFn, clock.now, async () => {
    waitCalls += 1;
  });
  const texts = calls.map((c) => JSON.parse(c.body).text);
  assert.ok(texts.some((t) => /Draining in-flight work/.test(t)));
  assert.ok(texts.some((t) => /Stop complete: drained/.test(t)));
  assert.ok(!texts.some((t) => /forcing teardown/.test(t)));
  assert.equal(waitCalls, 0, 'expected the drain wait loop never to poll at all - the pipeline was already empty on the first check');
});

test('BL-423: executeStop in drain mode forces teardown and reports forced once the drain window elapses with work still in flight', async () => {
  const root = mkTmpRoot();
  writeRolesTsvFixture(root, 'coder', root);
  const newDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new');
  fs.mkdirSync(newDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  // Never drains - a queued item sits in inbox/new for the whole test.
  fs.writeFileSync(path.join(newDir, 'BL-1.handoff'), 'type: note\nto: coder\npriority: 50\n\nhi\n');
  writeFakeKillAllSwarm(root, 'exit 0');
  const { postFn, calls } = fakeSendOk(1);
  const clock = fakeClock();
  // Jumps the injected clock 20 minutes forward on every wait() call - past
  // even the 10-minute default drain timeout in a single hop, no real
  // delay and no SWARMFORGE_CONTROL_DRAIN_TIMEOUT_MS override needed.
  const waitCallArgs = [];
  await executeStop(root, 'fake-token', 'fake-chat', 900, 'drain', postFn, clock.now, async (ms) => {
    waitCallArgs.push(ms);
    clock.advance(20 * 60 * 1000);
  });
  const texts = calls.map((c) => JSON.parse(c.body).text);
  assert.ok(texts.some((t) => /forcing teardown/.test(t)));
  assert.ok(texts.some((t) => /Stop complete: forced/.test(t)));
  // Proves the injected wait seam is genuinely load-bearing (called with a
  // real positive interval), not silently bypassed - the wiring-test rule
  // for a new seam this file's own engineering conventions call for.
  assert.ok(waitCallArgs.length >= 1 && waitCallArgs.every((ms) => ms > 0), `expected the drain loop to call wait() with a positive interval, got: ${JSON.stringify(waitCallArgs)}`);
});

// ── writeBounceSentinel / executeRestart (BL-423) ─────────────────────────

test('writeBounceSentinel writes the "swarm" bounce type - reuses the sanctioned bounce sentinel, never a second mechanism', () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  writeBounceSentinel(root);
  assert.equal(fs.readFileSync(bounceSentinelPath(root), 'utf8'), 'swarm');
});

function writeBounceAckFixture(root, phase, message) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'bounce-ack.json'),
    JSON.stringify({ bounceType: 'swarm', phase, updatedAt: new Date().toISOString(), message })
  );
}

test('BL-423: executeRestart reports success once the bounce-ack reports done AND bootstrap actually verifies', async () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  writeBounceAckFixture(root, 'done');
  const { postFn, calls } = fakeSendOk(1);
  await executeRestart(root, 'fake-token', 'fake-chat', 900, postFn, () => true);
  const texts = calls.map((c) => JSON.parse(c.body).text);
  assert.ok(texts.some((t) => /Restart complete - every agent bootstrapped/.test(t)));
  assert.equal(fs.readFileSync(bounceSentinelPath(root), 'utf8'), 'swarm');
});

test('BL-423: a relaunch that creates windows but bootstraps no agents is reported failed, not done', async () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  writeBounceAckFixture(root, 'done');
  const { postFn, calls } = fakeSendOk(1);
  await executeRestart(root, 'fake-token', 'fake-chat', 900, postFn, () => false);
  const texts = calls.map((c) => JSON.parse(c.body).text);
  assert.ok(texts.some((t) => /reporting failed/.test(t)));
  assert.ok(!texts.some((t) => /Restart complete/.test(t)));
});

test('BL-423: executeRestart stops streaming once the bounce-ack reports failed, without ever claiming success', async () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  writeBounceAckFixture(root, 'failed', 'launch failed');
  const { postFn, calls } = fakeSendOk(1);
  await executeRestart(root, 'fake-token', 'fake-chat', 900, postFn, () => true);
  const texts = calls.map((c) => JSON.parse(c.body).text);
  assert.ok(texts.some((t) => /Restart: failed - launch failed/.test(t)));
  assert.ok(!texts.some((t) => /Restart complete/.test(t)));
});

test('BL-423: executeRestart times out and reports it when the bounce-ack never arrives', async () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const { postFn, calls } = fakeSendOk(1);
  const clock = fakeClock();
  // Jumps the injected clock 20 minutes forward on every wait() call - past
  // even the 5-minute default restart-ack timeout in a single hop, no real
  // delay and no SWARMFORGE_CONTROL_RESTART_ACK_TIMEOUT_MS override needed.
  const waitCallArgs = [];
  await executeRestart(root, 'fake-token', 'fake-chat', 900, postFn, () => true, clock.now, async (ms) => {
    waitCallArgs.push(ms);
    clock.advance(20 * 60 * 1000);
  });
  const texts = calls.map((c) => JSON.parse(c.body).text);
  assert.ok(texts.some((t) => /timed out/.test(t)));
  assert.ok(waitCallArgs.length >= 1 && waitCallArgs.every((ms) => ms > 0), `expected the restart-ack loop to call wait() with a positive interval, got: ${JSON.stringify(waitCallArgs)}`);
});

// ── applyPause / resumeNow (BL-423) ────────────────────────────────────────

test('BL-423: applyPause writes a timed pause marker and announces it with a Resume now button', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeSendOk(1);
  await applyPause(root, 'fake-token', 'fake-chat', 900, 15 * 60 * 1000, postFn);
  const state = readControlPauseState(root);
  assert.equal(state.active, true);
  assert.ok(state.untilMs > Date.now());
  const body = JSON.parse(calls[0].body);
  assert.match(body.text, /Paused - new work will not be promoted for 15 min/);
  assert.deepEqual(body.reply_markup.inline_keyboard, [[{ text: 'Resume now', callback_data: 'control:resume-now' }]]);
});

test('BL-423: applyPause with no duration writes an "until I resume" pause (no untilMs, no auto-expiry)', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeSendOk(1);
  await applyPause(root, 'fake-token', 'fake-chat', 900, undefined, postFn);
  assert.deepEqual(readControlPauseState(root), { active: true, untilMs: undefined });
  const body = JSON.parse(calls[0].body);
  assert.match(body.text, /until you resume/);
});

test('BL-423: resumeNow clears the pause marker and announces it', async () => {
  const root = mkTmpRoot();
  writeControlPauseState(root, { active: true, untilMs: Date.now() + 60000 });
  const { postFn, calls } = fakeSendOk(1);
  await resumeNow(root, 'fake-token', 'fake-chat', 900, postFn);
  assert.deepEqual(readControlPauseState(root), { active: false });
  assert.match(JSON.parse(calls[0].body).text, /Resumed/);
});

// ── readPollMap / writePollMap (BL-466, the resolvePollThread/recordPollMapping
//    on-disk backing) — hardener: a NEW on-disk input this ticket introduces,
//    proven load-bearing with a real fixture file (never only exercised through
//    module-private buildPollAdapters/connectAndRelayReplies, which no test
//    reaches) ───────────────────────────────────────────────────────────────

test('BL-466: readPollMap returns {} when the poll map file does not exist yet', () => {
  const root = mkTmpRoot();
  assert.deepEqual(readPollMap(root), {});
});

test('BL-466: readPollMap returns {} when the poll map file is present but not valid JSON (present-but-malformed degrades, never crashes)', () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.dirname(pollMapPath(root)), { recursive: true });
  fs.writeFileSync(pollMapPath(root), 'not json');
  assert.deepEqual(readPollMap(root), {});
});

test('BL-466: writePollMap persists to disk and readPollMap reads back the SAME content - proves the read is load-bearing, not a hardcoded default', () => {
  const root = mkTmpRoot();
  const map = { 'poll-1': { threadId: 'SUP-1', options: ['staging', 'prod'] } };
  writePollMap(root, map);
  assert.deepEqual(JSON.parse(fs.readFileSync(pollMapPath(root), 'utf8')), map);
  assert.deepEqual(readPollMap(root), map);
});

// ── readApprovalAskMessages / recordApprovalAskMessage (BL-484, the
//    sendApprovalAsk/closing-routine on-disk backing) — same reasoning as
//    readPollMap/writePollMap above: a NEW on-disk input this ticket
//    introduces, proven load-bearing with a real fixture file (never only
//    exercised through module-private buildConciergeTickAdapters/
//    buildPollAdapters, which no test reaches) ─────────────────────────────

test('BL-484: readApprovalAskMessages returns {} when the file does not exist yet', () => {
  const root = mkTmpRoot();
  assert.deepEqual(readApprovalAskMessages(root), {});
});

test('BL-484: readApprovalAskMessages returns {} when the file is present but not valid JSON (present-but-malformed degrades, never crashes)', () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.dirname(approvalAskMessagesPath(root)), { recursive: true });
  fs.writeFileSync(approvalAskMessagesPath(root), 'not json');
  assert.deepEqual(readApprovalAskMessages(root), {});
});

test('BL-484: recordApprovalAskMessage persists to disk and readApprovalAskMessages reads back the SAME content - proves the read is load-bearing, not a hardcoded default', () => {
  const root = mkTmpRoot();
  recordApprovalAskMessage(root, 'BL-484', 800, 42, 'BL-484 needs your approval...');
  const expected = { 'BL-484': { topicId: 800, messageId: 42, text: 'BL-484 needs your approval...' } };
  assert.deepEqual(JSON.parse(fs.readFileSync(approvalAskMessagesPath(root), 'utf8')), expected);
  assert.deepEqual(readApprovalAskMessages(root), expected);
});

test('BL-484: recordApprovalAskMessage adds a new entry alongside an existing one, never clobbering it', () => {
  const root = mkTmpRoot();
  recordApprovalAskMessage(root, 'BL-1', 800, 1, 'BL-1 needs your approval...');
  recordApprovalAskMessage(root, 'BL-2', 800, 2, 'BL-2 needs your approval...');
  assert.deepEqual(readApprovalAskMessages(root), {
    'BL-1': { topicId: 800, messageId: 1, text: 'BL-1 needs your approval...' },
    'BL-2': { topicId: 800, messageId: 2, text: 'BL-2 needs your approval...' },
  });
});

test('BL-466: writePollMap overwrites a prior mapping in place - readPollMap sees only the latest write, never a stale one', () => {
  const root = mkTmpRoot();
  writePollMap(root, { 'poll-1': { threadId: 'SUP-1', options: ['a', 'b'] } });
  writePollMap(root, { 'poll-1': { threadId: 'SUP-1', options: ['a', 'b'] }, 'poll-2': { threadId: 'SUP-2', options: ['c', 'd'] } });
  assert.deepEqual(readPollMap(root), {
    'poll-1': { threadId: 'SUP-1', options: ['a', 'b'] },
    'poll-2': { threadId: 'SUP-2', options: ['c', 'd'] },
  });
});

// ── readAwaitingAnswer (BL-466, getPendingAgentQuestionThread's on-disk
//    backing - read-only from this side, operator_runtime.bb/operator_ask.bb
//    own the writes) — hardener: same fixture-proof discipline as
//    readPollMap above ─────────────────────────────────────────────────────

function awaitingAnswerPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'awaiting-answer.json');
}

function writeAwaitingAnswerFixture(root, contents) {
  fs.mkdirSync(path.dirname(awaitingAnswerPath(root)), { recursive: true });
  fs.writeFileSync(awaitingAnswerPath(root), contents);
}

test('BL-466: readAwaitingAnswer returns undefined when no question is pending (file absent)', () => {
  const root = mkTmpRoot();
  assert.equal(readAwaitingAnswer(root), undefined);
});

test('BL-466: readAwaitingAnswer resolves the pending question\'s thread id from a real fixture file - proves the read is load-bearing', () => {
  const root = mkTmpRoot();
  writeAwaitingAnswerFixture(root, JSON.stringify({ question: 'which env?', thread_id: 'SUP-1', asked_at_ms: 1000 }));
  assert.deepEqual(readAwaitingAnswer(root), { threadId: 'SUP-1' });
});

test('BL-466: readAwaitingAnswer break-then-fix - removing the fixture file flips the result from a thread id back to undefined', () => {
  const root = mkTmpRoot();
  writeAwaitingAnswerFixture(root, JSON.stringify({ question: 'which env?', thread_id: 'SUP-1', asked_at_ms: 1000 }));
  assert.deepEqual(readAwaitingAnswer(root), { threadId: 'SUP-1' }, 'sanity: the fixture is read while present');
  fs.rmSync(awaitingAnswerPath(root));
  assert.equal(readAwaitingAnswer(root), undefined, 'once removed, the read must no longer resolve a thread id');
});

test('BL-466: readAwaitingAnswer degrades to undefined on a malformed fixture file, never crashes (present-but-malformed)', () => {
  const root = mkTmpRoot();
  writeAwaitingAnswerFixture(root, 'not json');
  assert.equal(readAwaitingAnswer(root), undefined);
});

// ── ensureRoleTopics (BL-425 slice 1 provision-role-topics-01) ───────────

function fakeCreateSequential(startId = 100) {
  const calls = [];
  let nextId = startId;
  const postFn = async (url, body) => {
    calls.push({ url, body });
    const id = nextId;
    nextId += 1;
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: id, name: JSON.parse(body).name } } };
  };
  return { postFn, calls };
}

test('BL-425 provision-role-topics-01: creates a topic for every role and records each id, named for the role', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeCreateSequential();
  await ensureRoleTopics(root, 'fake-token', 'fake-chat', ['coder', 'QA', 'coordinator'], postFn);
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((c) => JSON.parse(c.body).name),
    ['coder', 'QA', 'coordinator']
  );
  const map = readRoleTopicMap(root);
  assert.equal(typeof map.coder, 'number');
  assert.equal(typeof map.QA, 'number');
  assert.equal(typeof map.coordinator, 'number');
});

test('BL-425: a role already bound in the map is reused, never creating a second topic for it', async () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'role-topic-map.json'), JSON.stringify({ coder: 42 }));
  const { postFn, calls } = fakeCreateSequential();
  await ensureRoleTopics(root, 'fake-token', 'fake-chat', ['coder', 'QA'], postFn);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].body).name, 'QA');
  const map = readRoleTopicMap(root);
  assert.equal(map.coder, 42);
});

test('BL-425: a failed create for one role is logged and skipped, never blocking the remaining roles', async () => {
  const root = mkTmpRoot();
  let call = 0;
  const postFn = async (url, body) => {
    call += 1;
    if (call === 1) {
      return { ok: false, status: 500, json: { description: 'simulated failure' } };
    }
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: 200 + call, name: JSON.parse(body).name } } };
  };
  await ensureRoleTopics(root, 'fake-token', 'fake-chat', ['coder', 'QA'], postFn);
  const map = readRoleTopicMap(root);
  assert.equal(map.coder, undefined);
  assert.equal(typeof map.QA, 'number');
});

test('BL-425: ensureRoleTopics defaults to provisioning all 8 swarm roles when no role list is given', async () => {
  const root = mkTmpRoot();
  const { calls, postFn } = fakeCreateSequential();
  await ensureRoleTopics(root, 'fake-token', 'fake-chat', undefined, postFn);
  assert.equal(calls.length, 8);
});

// ── resolveRolePaneTarget / redirectToRole (BL-425 REDIRECT execution) ───

function writeSwarmRoleFixture(root, role) {
  const stateDir = path.join(root, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), `1\t${role}\tswarmforge-${role}\t${role}\tclaude\n`);
}

test('BL-425: resolveRolePaneTarget resolves the role\'s own session:window.pane target on the swarm socket', () => {
  const root = mkTmpRoot();
  writeSwarmRoleFixture(root, 'coder');
  const fake = installInProcessTmux([{ subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' }]);
  try {
    const resolved = resolveRolePaneTarget(root, 'coder');
    assert.deepEqual(resolved, { socketPath: '/tmp/fake.sock', target: 'swarmforge-coder:coder.1' });
  } finally {
    fake.restore();
  }
});

test('BL-425: resolveRolePaneTarget returns undefined when the swarm has no tmux socket recorded', () => {
  const root = mkTmpRoot();
  assert.equal(resolveRolePaneTarget(root, 'coder'), undefined);
});

test('BL-425: resolveRolePaneTarget returns undefined for a role absent from sessions.tsv', () => {
  const root = mkTmpRoot();
  writeSwarmRoleFixture(root, 'coder');
  assert.equal(resolveRolePaneTarget(root, 'cleaner'), undefined);
});

test('BL-425: redirectToRole injects the text into the addressed role\'s pane as a verified nudge, targeting only that role', async () => {
  const root = mkTmpRoot();
  writeSwarmRoleFixture(root, 'coder');
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: '$ ' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
  ]);
  try {
    await redirectToRole(root, 'coder', 'focus on the edge case first');
    const sendCalls = fake.calls().filter((args) => args.includes('send-keys'));
    assert.ok(sendCalls.length > 0, 'expected at least one send-keys call');
    assert.ok(
      sendCalls.some((args) => args.includes('focus on the edge case first')),
      'expected the redirect text to be typed into the pane'
    );
    assert.ok(
      sendCalls.every((args) => args[args.indexOf('-t') + 1] === 'swarmforge-coder:coder.1'),
      "must target only the addressed role's pane"
    );
  } finally {
    fake.restore();
  }
});

test('BL-425: redirectToRole degrades quietly (no throw) when the role has no live pane to resolve', async () => {
  const root = mkTmpRoot();
  await assert.doesNotReject(() => redirectToRole(root, 'coder', 'anything'));
});

// ── toFoldersSnapshot (thin fs adapter) ───────────────────────────────────
// Real backlog/ ticket fixtures, not adapter-injected - conciergeTick.test.js
// already proves pendingApprovalFor/epicForBacklogId are correct GIVEN a
// BacklogFolderItem carrying humanApproval/epic, but everything upstream of
// that (this function) was never itself proven to carry those fields
// through from the real backlogReader.ts read. BL-357's humanApproval and
// BL-341's epic were both silently dropped here once already (notes/
// firstAcceptanceStep were fixed by BL-322 the same way) - caught only by
// re-reading this function while adding epic, not by any test.

function writeBacklogTicket(targetPath, folder, fileName, content) {
  const dir = path.join(targetPath, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content);
}

test('toFoldersSnapshot carries humanApproval through from the real ticket file', () => {
  const target = mkTmp();
  writeBacklogTicket(target, 'active', 'BL-1.yaml', 'id: BL-1\ntitle: t\nhuman_approval: pending\n');
  const snapshot = toFoldersSnapshot(target);
  assert.equal(snapshot.active[0].humanApproval, 'pending');
});

test('toFoldersSnapshot carries epic through from the real ticket file', () => {
  const target = mkTmp();
  writeBacklogTicket(target, 'active', 'BL-1.yaml', 'id: BL-1\ntitle: t\nepic: dynamic-routing\n');
  const snapshot = toFoldersSnapshot(target);
  assert.equal(snapshot.active[0].epic, 'dynamic-routing');
});

// BL-341 hardening: type/remainingSlices were added to the SAME pick()
// narrowing in the SAME commit as epic above, but neither was ever proven
// to survive the real-file read - conciergeTick.test.js's
// epicDefinitionsFor coverage only proves the logic is right GIVEN a
// BacklogFolderItem that already carries them, exactly the gap this
// function's own comment says bit epic/humanApproval before it (dropped
// here silently, invisible to any fixture-injecting test).

test('toFoldersSnapshot carries type through from the real ticket file - the epic-defining ticket depends on it', () => {
  const target = mkTmp();
  writeBacklogTicket(target, 'paused', 'BL-1.yaml', 'id: BL-1\ntitle: t\ntype: epic\nepic: dynamic-routing\n');
  const snapshot = toFoldersSnapshot(target);
  assert.equal(snapshot.paused[0].type, 'epic');
});

test('toFoldersSnapshot carries remainingSlices through from the real ticket file', () => {
  const target = mkTmp();
  writeBacklogTicket(
    target,
    'paused',
    'BL-1.yaml',
    'id: BL-1\ntitle: t\ntype: epic\nepic: dynamic-routing\nremaining_slices:\n  - warm-core/break-even tuning\n'
  );
  const snapshot = toFoldersSnapshot(target);
  assert.deepEqual(snapshot.paused[0].remainingSlices, ['warm-core/break-even tuning']);
});

// BL-480: approvalContext is the SAME class of field as epic/humanApproval
// above (added to the pick() narrowing, easy to drop silently) - proven the
// same way, a real fixture file through the real read, not an injected
// BacklogFolderItem fixture (which would prove nothing about this hop).
test('toFoldersSnapshot carries approvalContext through from the real ticket file', () => {
  const target = mkTmp();
  writeBacklogTicket(target, 'paused', 'BL-1.yaml', 'id: BL-1\ntitle: t\napproval_context: >\n  Sign-off needed here.\n');
  const snapshot = toFoldersSnapshot(target);
  assert.equal(snapshot.paused[0].approvalContext, 'Sign-off needed here.');
});

test('toFoldersSnapshot leaves humanApproval/epic/type/remainingSlices/approvalContext undefined for a ticket that declares none', () => {
  const target = mkTmp();
  writeBacklogTicket(target, 'active', 'BL-1.yaml', 'id: BL-1\ntitle: t\n');
  const snapshot = toFoldersSnapshot(target);
  assert.equal(snapshot.active[0].humanApproval, undefined);
  assert.equal(snapshot.active[0].epic, undefined);
  assert.equal(snapshot.active[0].type, undefined);
  assert.equal(snapshot.active[0].remainingSlices, undefined);
  assert.equal(snapshot.active[0].approvalContext, undefined);
});

// ── postOperatorContext (BL-389 scenarios 04/05: a message delivered twice
//    is recorded once and answered once) - this was the exact adapter that
//    flooded backlog/topics/BL-359.json with 209 duplicate entries once a
//    dropped update parked the offset and Telegram redelivered the same
//    batch on every poll. ────────────────────────────────────────────────

function operatorEventCount(target, backlogId) {
  const file = path.join(target, '.swarmforge', 'operator', 'events.jsonl');
  if (!fs.existsSync(file)) {
    return 0;
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  return lines.filter((line) => JSON.parse(line).backlogId === backlogId).length;
}

test('BL-389 scenario 04: the same update delivered twice is recorded only once in the topic record', async () => {
  const target = mkTmp();
  await postOperatorContext(target, 'BL-123', 'nothing to approve right now', 501);
  await postOperatorContext(target, 'BL-123', 'nothing to approve right now', 501);
  assert.equal(readTopicRecord(target, 'BL-123').messages.length, 1);
});

test('BL-389 scenario 05: the same update delivered twice raises only one Operator event (answered once, not twice)', async () => {
  const target = mkTmp();
  await postOperatorContext(target, 'BL-123', 'nothing to approve right now', 501);
  await postOperatorContext(target, 'BL-123', 'nothing to approve right now', 501);
  assert.equal(operatorEventCount(target, 'BL-123'), 1);
});

test('a DIFFERENT update (different updateId) for the same ticket is recorded as its own, separate message - the dedup key is the update, not the ticket', async () => {
  const target = mkTmp();
  await postOperatorContext(target, 'BL-123', 'first reply', 501);
  await postOperatorContext(target, 'BL-123', 'second reply', 502);
  assert.equal(readTopicRecord(target, 'BL-123').messages.length, 2);
  assert.equal(operatorEventCount(target, 'BL-123'), 2);
});

// ── standingTopicTargets (BL-418) ─────────────────────────────────────────
// Classifies the front-desk bot's own {topicId: subjectId} map into the
// standing-topic targets conciergeTick.ts's icon sync wants - reads the
// SAME file ensureOperatorTopic/openSubjectAndRecord already maintain, no
// second store.

test('standingTopicTargets classifies the Operator subject as "operator" and every other real topic as "support/intake"', () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { 701: 'OPERATOR', 801: 'SUP-001', 802: 'SUP-002' });

  const targets = standingTopicTargets(root);

  assert.deepEqual(
    targets.sort((a, b) => a.topicId - b.topicId),
    [
      { id: 'OPERATOR', topicId: 701, iconKey: 'operator' },
      { id: 'SUP-001', topicId: 801, iconKey: 'support/intake' },
      { id: 'SUP-002', topicId: 802, iconKey: 'support/intake' },
    ]
  );
});

// BL-434: the Approvals subject gets its own iconKey too, checked before the
// support/intake fallback - same posture as OPERATOR's own check above.
test('BL-434: standingTopicTargets classifies the Approvals subject as "approvals", distinct from the Operator and support/intake', () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { 701: 'OPERATOR', 750: 'APPROVALS', 801: 'SUP-001' });

  const targets = standingTopicTargets(root);

  assert.deepEqual(
    targets.sort((a, b) => a.topicId - b.topicId),
    [
      { id: 'OPERATOR', topicId: 701, iconKey: 'operator' },
      { id: 'APPROVALS', topicId: 750, iconKey: 'approvals' },
      { id: 'SUP-001', topicId: 801, iconKey: 'support/intake' },
    ]
  );
});

test('standingTopicTargets excludes the DEFAULT_SUBJECT_KEY binding (a DM/General origin has no real Telegram topic to iconize)', () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { __default__: 'SUP-003', 801: 'SUP-001' });

  const targets = standingTopicTargets(root);

  assert.deepEqual(targets, [{ id: 'SUP-001', topicId: 801, iconKey: 'support/intake' }]);
});

test('standingTopicTargets excludes openSubjectAndRecord\'s own update:<id> idempotency keys, which share this same map/file', () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { 'update:900': 'SUP-500', 7: 'SUP-500' });

  const targets = standingTopicTargets(root);

  assert.deepEqual(targets, [{ id: 'SUP-500', topicId: 7, iconKey: 'support/intake' }]);
});

test('standingTopicTargets returns an empty list when the map has no bindings yet', () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, {});

  assert.deepEqual(standingTopicTargets(root), []);
});

test('standingTopicTargets returns an empty list when the map file does not exist at all', () => {
  const root = mkTmpRoot();

  assert.deepEqual(standingTopicTargets(root), []);
});

// ── roleTopicTargets (BL-469) ──────────────────────────────────────────────
// Classifies BL-425's own role->topicId map (roleTopicMapStore) into the
// per-agent RoleTopicTarget list conciergeTick.ts's icon sync wants - reads
// the SAME file BL-425's ensureRoleTopics already maintains, no second
// store.

test('roleTopicTargets maps every bound role to its own {role, topicId} target', () => {
  const root = mkTmpRoot();
  writeRoleTopicMap(root, { coder: 904, QA: 907, coordinator: 901 });

  const targets = roleTopicTargets(root);

  assert.deepEqual(
    targets.sort((a, b) => a.topicId - b.topicId),
    [
      { role: 'coordinator', topicId: 901 },
      { role: 'coder', topicId: 904 },
      { role: 'QA', topicId: 907 },
    ]
  );
});

// Defensive: a role key present in the map but absent from ROLE_TOPIC_ICON
// (none exist today - every ALL_SWARM_ROLES entry has a mapping) is
// filtered out rather than producing a target with an unresolvable icon
// lookup.
test('roleTopicTargets excludes a role key not present in ROLE_TOPIC_ICON', () => {
  const root = mkTmpRoot();
  writeRoleTopicMap(root, { coder: 904, 'not-a-real-role': 999 });

  const targets = roleTopicTargets(root);

  assert.deepEqual(targets, [{ role: 'coder', topicId: 904 }]);
});

test('roleTopicTargets returns an empty list when the map has no bindings yet', () => {
  const root = mkTmpRoot();
  writeRoleTopicMap(root, {});

  assert.deepEqual(roleTopicTargets(root), []);
});

test('roleTopicTargets returns an empty list when the map file does not exist at all', () => {
  const root = mkTmpRoot();

  assert.deepEqual(roleTopicTargets(root), []);
});

// ── iconStickersOnce (BL-342: fetch-once-per-process cache) ───────────────

test('iconStickersOnce fetches from Telegram on a cache miss, then reuses the cache without a second call', async () => {
  __resetIconStickersCacheForTest();
  let calls = 0;
  const postFn = async () => {
    calls += 1;
    return { ok: true, status: 200, json: { ok: true, result: [{ emoji: '✅', custom_emoji_id: 'id-check' }] } };
  };

  const first = await iconStickersOnce('123:test-token', postFn);
  const second = await iconStickersOnce('123:test-token', postFn);

  assert.deepEqual(first, [{ emoji: '✅', customEmojiId: 'id-check' }]);
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});

test('iconStickersOnce caches an empty list (not undefined) when the fetch fails, so a failed first call does not retry forever', async () => {
  __resetIconStickersCacheForTest();
  let calls = 0;
  const postFn = async () => {
    calls += 1;
    return { ok: false, status: 500, json: { ok: false, description: 'boom' } };
  };

  const first = await iconStickersOnce('123:test-token', postFn);
  const second = await iconStickersOnce('123:test-token', postFn);

  assert.deepEqual(first, []);
  assert.deepEqual(second, []);
  assert.equal(calls, 1);
});

// ── transcribeVoiceNote / synthesizeVoiceReply (BL-426 slice 1) ─────────
// Both call the real network seam (global fetch) - stubbed the same way
// relayOnboardingNegotiationTelegramCli.test.js / recertWebhookVercelHandler
// .test.js already do, to keep this in-process test network-free.

const OPENAI_KEY = 'sk-test-key';
const BOT_TOKEN = '123456:test-bot-token';

// Buffer.from(str).buffer returns Node's SHARED POOLED ArrayBuffer for a
// small string, not one scoped to just this string - Buffer.from(arrayBuffer)
// on the production side then wraps the WHOLE pool (leftover bytes from
// unrelated allocations included). slice() to the exact byte range first.
function toArrayBuffer(text) {
  const buf = Buffer.from(text);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function withFetch(handler, run) {
  const originalFetch = global.fetch;
  global.fetch = handler;
  return run().finally(() => {
    global.fetch = originalFetch;
  });
}

test('BL-426: transcribeVoiceNote resolves file_id -> file_path -> audio bytes -> transcript on the happy path', async () => {
  const calls = [];
  await withFetch(async (url, opts) => {
    calls.push(String(url));
    if (String(url).includes('/getFile')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { file_path: 'voice/file_1.oga' } }) };
    }
    if (String(url).includes('/file/bot')) {
      return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer('audio-bytes'), json: async () => { throw new Error('not json'); } };
    }
    if (String(url) === 'https://api.openai.com/v1/audio/transcriptions') {
      assert.equal(opts.headers.authorization, `Bearer ${OPENAI_KEY}`);
      return { ok: true, status: 200, json: async () => ({ text: 'what is the status of BL-400' }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const result = await transcribeVoiceNote(BOT_TOKEN, OPENAI_KEY, 'file-abc');
    assert.deepEqual(result, { kind: 'ok', transcript: 'what is the status of BL-400' });
  });
  assert.ok(calls.some((c) => c.includes('/getFile')));
  assert.ok(calls.some((c) => c.includes('/file/bot')));
  assert.ok(calls.some((c) => c === 'https://api.openai.com/v1/audio/transcriptions'));
});

test('BL-426: transcribeVoiceNote reports unprocessable on OpenAI\'s 4xx (undecodable audio), never a transient failure', async () => {
  await withFetch(async (url) => {
    if (String(url).includes('/getFile')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { file_path: 'voice/file_1.oga' } }) };
    }
    if (String(url).includes('/file/bot')) {
      return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer('audio-bytes'), json: async () => { throw new Error('not json'); } };
    }
    return { ok: false, status: 400, json: async () => ({ error: 'invalid audio' }) };
  }, async () => {
    const result = await transcribeVoiceNote(BOT_TOKEN, OPENAI_KEY, 'file-abc');
    assert.deepEqual(result, { kind: 'unprocessable' });
  });
});

test('BL-426: transcribeVoiceNote reports a transient failure on OpenAI\'s 5xx, never unprocessable', async () => {
  await withFetch(async (url) => {
    if (String(url).includes('/getFile')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { file_path: 'voice/file_1.oga' } }) };
    }
    if (String(url).includes('/file/bot')) {
      return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer('audio-bytes'), json: async () => { throw new Error('not json'); } };
    }
    return { ok: false, status: 503, json: async () => ({ error: 'service unavailable' }) };
  }, async () => {
    const result = await transcribeVoiceNote(BOT_TOKEN, OPENAI_KEY, 'file-abc');
    assert.deepEqual(result, { kind: 'transient-failure' });
  });
});

test('BL-426: transcribeVoiceNote reports unprocessable for an empty downloaded file, never calling OpenAI', async () => {
  await withFetch(async (url) => {
    if (String(url).includes('/getFile')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { file_path: 'voice/empty.oga' } }) };
    }
    if (String(url).includes('/file/bot')) {
      return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(''), json: async () => { throw new Error('not json'); } };
    }
    throw new Error('OpenAI should not be called for an empty file');
  }, async () => {
    const result = await transcribeVoiceNote(BOT_TOKEN, OPENAI_KEY, 'file-abc');
    assert.deepEqual(result, { kind: 'unprocessable' });
  });
});

test('BL-426: transcribeVoiceNote reports a transient failure when Telegram\'s own getFile fails', async () => {
  await withFetch(async (url) => {
    if (String(url).includes('/getFile')) {
      return { ok: false, status: 500, json: async () => ({ ok: false, description: 'boom' }) };
    }
    throw new Error('no further fetch should happen once getFile fails');
  }, async () => {
    const result = await transcribeVoiceNote(BOT_TOKEN, OPENAI_KEY, 'file-abc');
    assert.deepEqual(result, { kind: 'transient-failure' });
  });
});

test('BL-426: transcribeVoiceNote reports a transient failure when the file download itself fails (getFile succeeded)', async () => {
  await withFetch(async (url) => {
    if (String(url).includes('/getFile')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { file_path: 'voice/file_1.oga' } }) };
    }
    if (String(url).includes('/file/bot')) {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    throw new Error('OpenAI should not be called once the download fails');
  }, async () => {
    const result = await transcribeVoiceNote(BOT_TOKEN, OPENAI_KEY, 'file-abc');
    assert.deepEqual(result, { kind: 'transient-failure' });
  });
});

test('BL-426: transcribeVoiceNote reports unprocessable when OpenAI returns 2xx with no transcript text', async () => {
  await withFetch(async (url) => {
    if (String(url).includes('/getFile')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { file_path: 'voice/file_1.oga' } }) };
    }
    if (String(url).includes('/file/bot')) {
      return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer('audio-bytes'), json: async () => { throw new Error('not json'); } };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }, async () => {
    const result = await transcribeVoiceNote(BOT_TOKEN, OPENAI_KEY, 'file-abc');
    assert.deepEqual(result, { kind: 'unprocessable' });
  });
});

test('BL-426: transcribeVoiceNote reports a transient failure on a thrown network error', async () => {
  await withFetch(async (url) => {
    if (String(url).includes('/getFile')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { file_path: 'voice/file_1.oga' } }) };
    }
    if (String(url).includes('/file/bot')) {
      return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer('audio-bytes'), json: async () => { throw new Error('not json'); } };
    }
    throw new Error('network down');
  }, async () => {
    const result = await transcribeVoiceNote(BOT_TOKEN, OPENAI_KEY, 'file-abc');
    assert.deepEqual(result, { kind: 'transient-failure' });
  });
});

test('BL-426: synthesizeVoiceReply returns the synthesized audio bytes on the happy path', async () => {
  await withFetch(async (url, opts) => {
    assert.equal(url, 'https://api.openai.com/v1/audio/speech');
    assert.equal(opts.headers.authorization, `Bearer ${OPENAI_KEY}`);
    return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer('synth-audio') };
  }, async () => {
    const result = await synthesizeVoiceReply(OPENAI_KEY, 'BL-400 is in QA');
    assert.deepEqual(result, { kind: 'ok', audio: Buffer.from('synth-audio') });
  });
});

test('BL-426: synthesizeVoiceReply reports failure on a non-2xx response', async () => {
  await withFetch(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }), async () => {
    const result = await synthesizeVoiceReply(OPENAI_KEY, 'text');
    assert.deepEqual(result, { kind: 'failure' });
  });
});

test('BL-426: synthesizeVoiceReply reports failure on a thrown network error', async () => {
  await withFetch(async () => {
    throw new Error('network down');
  }, async () => {
    const result = await synthesizeVoiceReply(OPENAI_KEY, 'text');
    assert.deepEqual(result, { kind: 'failure' });
  });
});

// ── readRootIntakeFiles / readRepoBaseUrl (BL-465) ────────────────────────

test('readRootIntakeFiles returns an empty list when backlog/ has no root .md files at all', () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.join(root, 'backlog'), { recursive: true });
  assert.deepEqual(readRootIntakeFiles(root), []);
});

test('readRootIntakeFiles degrades to an empty list when backlog/ does not exist, never a crash', () => {
  const root = mkTmpRoot();
  assert.deepEqual(readRootIntakeFiles(root), []);
});

test('readRootIntakeFiles excludes README.md and STEERING.md - never real intake', () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.join(root, 'backlog'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'README.md'), '# readme');
  fs.writeFileSync(path.join(root, 'backlog', 'STEERING.md'), '# steering');
  assert.deepEqual(readRootIntakeFiles(root), []);
});

test('readRootIntakeFiles lists a real root intake file, id from the filename and title from its first non-empty line', () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.join(root, 'backlog'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'INTAKE-operator-question-123.md'), '\n\n# A raw human ask\nmore detail here\n');
  const result = readRootIntakeFiles(root);
  assert.deepEqual(result, [{ id: 'INTAKE-operator-question-123', title: 'A raw human ask', filename: 'INTAKE-operator-question-123.md' }]);
});

test('readRepoBaseUrl resolves an HTTPS github.com origin remote to its base URL', () => {
  const root = mkTmpRoot();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/ldecorps/swarmforgevc.git'], { cwd: root });
  assert.equal(readRepoBaseUrl(root), 'https://github.com/ldecorps/swarmforgevc');
});

test('readRepoBaseUrl resolves an SSH github.com origin remote to its HTTPS base URL', () => {
  const root = mkTmpRoot();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:ldecorps/swarmforgevc.git'], { cwd: root });
  assert.equal(readRepoBaseUrl(root), 'https://github.com/ldecorps/swarmforgevc');
});

test('readRepoBaseUrl degrades to undefined (never throws) when there is no git remote at all', () => {
  const root = mkTmpRoot();
  execFileSync('git', ['init', '-q'], { cwd: root });
  assert.equal(readRepoBaseUrl(root), undefined);
});

test('readRepoBaseUrl degrades to undefined (never throws) when the directory is not even a git repo', () => {
  const root = mkTmpRoot();
  assert.equal(readRepoBaseUrl(root), undefined);
});
