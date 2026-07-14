const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseCliArgs, conciergeTickIntervalMs, readRoleTicket, ensureOperatorTopic, main } = require('../out/tools/telegram-front-desk-bot');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-role-ticket-'));
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-operator-topic-'));
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

test('the create call names the topic "Operator"', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeCreateOk(7);
  await ensureOperatorTopic(root, 'fake-token', 'fake-chat', postFn);
  assert.match(calls[0].url, /createForumTopic$/);
  assert.match(calls[0].body, /"name":"Operator"/);
});

test('BL-346 standing-operator-topic-06: a map that already binds the reserved subject never creates a second topic', async () => {
  const root = mkTmpRoot();
  writeTopicMapFixture(root, { '42': 'OPERATOR' });
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
