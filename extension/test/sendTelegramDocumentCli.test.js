const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseArgs, sendTelegramDocumentCore } = require('../out/tools/send-telegram-document');

const CLI = path.join(__dirname, '..', 'out', 'tools', 'send-telegram-document.js');
const TOPIC_MAP_PATH = (root) => path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json');

function mkTmp() {
  return mkTmpDir('sfvc-send-telegram-document-');
}

function mkFixtureRoot(bindConciergeTopic) {
  const root = mkTmp();
  if (bindConciergeTopic) {
    fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
    fs.writeFileSync(TOPIC_MAP_PATH(root), JSON.stringify({ '777': 'OPERATOR' }));
  }
  return root;
}

function writeFixtureFile(root, name, contents) {
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

// Real argv/env boundary, same allowlist-env posture as
// notifyDeadLettersCli.test.js's own runCliSubprocess - never
// {...process.env, ...overrides}.
//
// A bounded `timeout` here is load-bearing, not decoration: execFileSync
// blocks the event loop synchronously, so a mutant that skips the
// TELEGRAM_NOTIFY_FORCE_RESULT short-circuit (sendAnnouncement's `if
// (forced)`) makes this subprocess fall through to sendDocument's real
// defaultPostVoice, which does an un-timed-out `fetch` to the real
// Telegram API - vitest's own per-test timeout can never fire against a
// synchronous child_process call, so with no timeout here that single
// mutant hangs the whole mutation run until an external reaper (or a
// registered detach job's expiry) kills it (BL-1509 hardening,
// 2026-09-15: exactly this mutant stalled a `--mutate
// out/tools/send-telegram-document.js` run for 12+ minutes at 0%).
function runCliSubprocess(args, overrides = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...overrides };
  try {
    const output = execFileSync('node', [CLI, ...args], { encoding: 'utf8', env, timeout: 5000 });
    return { exitCode: 0, result: JSON.parse(output) };
  } catch (err) {
    return { exitCode: err.status, result: JSON.parse(err.stdout) };
  }
}

// Runs the REAL main() in-process against a real fixture root/env, so
// in-process coverage and mutation tooling can see the branches a
// subprocess-only smoke test cannot (engineering article's CLI
// main()-thin-wrapper rule; mirrors notifyDeadLettersCli.test.js's own
// identical seam).
const CLI_ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_NOTIFY_FORCE_RESULT'];
async function runCli(argv, overrides = {}) {
  const originalArgv = process.argv;
  const previousEnv = Object.fromEntries(CLI_ENV_KEYS.map((k) => [k, process.env[k]]));
  const writes = [];
  const errWrites = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalErrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    errWrites.push(chunk);
    return true;
  };
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    for (const key of CLI_ENV_KEYS) {
      if (overrides[key] === undefined) delete process.env[key];
      else process.env[key] = overrides[key];
    }
    process.argv = ['node', CLI, ...argv];
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalErrWrite;
    process.argv = originalArgv;
    for (const key of CLI_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
  const exitCode = process.exitCode;
  process.exitCode = previousExitCode;
  const stderr = errWrites.join('');
  return { exitCode, stderr, result: stderr ? undefined : JSON.parse(writes.join('')) };
}

const FORCE_SUCCESS = JSON.stringify({ success: true });
const DELIVER_ENV = { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: FORCE_SUCCESS };

test('BL-1509 file-posted-as-telegram-document-03: names the Concierge topic - the file is sent and the CLI exits 0', async () => {
  const root = mkFixtureRoot(true);
  const file = writeFixtureFile(root, 'report.md', '# report');
  const { exitCode, result } = await runCli([root, file], DELIVER_ENV);
  assert.equal(exitCode, undefined);
  assert.equal(result.success, true);
});

test('BL-1509 file-posted-as-telegram-document-03: has no Concierge topic yet - the CLI exits non-zero naming operator-topic-not-yet-created', async () => {
  const root = mkFixtureRoot(false);
  const file = writeFixtureFile(root, 'report.md', '# report');
  const { exitCode, result } = await runCli([root, file], DELIVER_ENV);
  assert.equal(exitCode, 1);
  assert.equal(result.success, false);
  assert.equal(result.reason, 'operator-topic-not-yet-created');
});

test('missing Telegram config exits non-zero naming missing-telegram-config', async () => {
  const root = mkFixtureRoot(true);
  const file = writeFixtureFile(root, 'report.md', '# report');
  const { exitCode, result } = await runCli([root, file], {});
  assert.equal(exitCode, 1);
  assert.equal(result.reason, 'missing-telegram-config');
});

test('a failed send exits non-zero carrying the (redacted) send error, never the token', async () => {
  const root = mkFixtureRoot(true);
  const file = writeFixtureFile(root, 'report.md', '# report');
  const failEnv = {
    TELEGRAM_BOT_TOKEN: 'fake-token',
    TELEGRAM_CHAT_ID: 'fake-chat',
    TELEGRAM_NOTIFY_FORCE_RESULT: JSON.stringify({ success: false, error: 'simulated failure' }),
  };
  const { exitCode, result } = await runCli([root, file], failEnv);
  assert.equal(exitCode, 1);
  assert.equal(result.reason, 'simulated failure');
});

test('--caption is accepted alongside the two positional args', async () => {
  const root = mkFixtureRoot(true);
  const file = writeFixtureFile(root, 'report.md', '# report');
  const { result } = await runCli([root, file, '--caption', 'BL-1509 e2e'], DELIVER_ENV);
  assert.equal(result.success, true);
});

test('parseArgs rejects missing positional args and a dangling --caption', () => {
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['/root']), null);
  assert.equal(parseArgs(['/root', 'file.md', '--caption']), null);
  assert.deepEqual(parseArgs(['/root', 'file.md']), { projectRoot: '/root', file: 'file.md' });
  assert.deepEqual(parseArgs(['/root', 'file.md', '--caption', 'hi']), { projectRoot: '/root', file: 'file.md', caption: 'hi' });
});

// extractCaptionFlag is not exported - these drive it only through parseArgs,
// but pick argv shapes chosen to discriminate its internal slicing (BL-1509
// hardening, 2026-09-15): every existing fixture put --caption at the very
// end, so extractCaptionFlag's own bounds (captionIndex<0 vs <=0, which
// slice half is dropped, +2 vs -2) were all interchangeable - the trailing
// two elements were the same either way.
test('--caption at argv[0] is still recognised (captionIndex boundary at zero)', () => {
  assert.deepEqual(parseArgs(['--caption', 'C', 'P0', 'P1']), { projectRoot: 'P0', file: 'P1', caption: 'C' });
});

test('--caption in the middle of argv, with a positional arg on each side, still yields the two positionals in order', () => {
  assert.deepEqual(parseArgs(['P0', '--caption', 'C', 'P1', 'P2']), { projectRoot: 'P0', file: 'P1', caption: 'C' });
});

test('sendTelegramDocumentCore reads the file and posts it under its own basename', async () => {
  const root = mkFixtureRoot(true);
  const file = writeFixtureFile(root, 'evidence.txt', 'hello world');
  const previousEnv = { TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID, TELEGRAM_NOTIFY_FORCE_RESULT: process.env.TELEGRAM_NOTIFY_FORCE_RESULT };
  try {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    process.env.TELEGRAM_CHAT_ID = 'fake-chat';
    process.env.TELEGRAM_NOTIFY_FORCE_RESULT = FORCE_SUCCESS;
    const outcome = await sendTelegramDocumentCore(root, file, undefined);
    assert.deepEqual(outcome, { success: true });
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// Discriminates sendAnnouncement's `if (forced)` from an always-true
// mutant (BL-1509 hardening, 2026-09-15): every other test sets
// TELEGRAM_NOTIFY_FORCE_RESULT, so the original and a mutant that ignores
// it are indistinguishable there (both take the short-circuit). Leaving it
// unset drives the REAL (non-forced) branch - stubbing global.fetch keeps
// this off the network instead of hitting the hang this same pass found
// (see runCliSubprocess's own note above).
test('with TELEGRAM_NOTIFY_FORCE_RESULT unset, sendTelegramDocumentCore takes the real (non-forced) send path', async () => {
  const root = mkFixtureRoot(true);
  const file = writeFixtureFile(root, 'report.md', '# report');
  const previousEnv = { TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID, TELEGRAM_NOTIFY_FORCE_RESULT: process.env.TELEGRAM_NOTIFY_FORCE_RESULT };
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) });
  try {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    process.env.TELEGRAM_CHAT_ID = 'fake-chat';
    delete process.env.TELEGRAM_NOTIFY_FORCE_RESULT;
    const outcome = await sendTelegramDocumentCore(root, file, undefined);
    assert.deepEqual(outcome, { success: true });
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// Discriminates the `!token || !chatId` guard from an `&&` mutant (BL-1509
// hardening, 2026-09-15): the existing "missing Telegram config" test
// leaves BOTH env vars unset, where || and && agree - only exactly one
// present tells them apart.
test('missing-telegram-config fires when only ONE of token/chat id is set', async () => {
  const root = mkFixtureRoot(true);
  const file = writeFixtureFile(root, 'report.md', '# report');
  const { exitCode, result } = await runCli([root, file], { TELEGRAM_BOT_TOKEN: 'fake-token' });
  assert.equal(exitCode, 1);
  assert.equal(result.reason, 'missing-telegram-config');
});

// Discriminates the USAGE string from an empty-string mutant (BL-1509
// hardening, 2026-09-15): nothing previously asserted on its content -
// only that parseArgs returned null.
test('invalid args print the USAGE string to stderr and exit non-zero', async () => {
  const { exitCode, stderr } = await runCli([]);
  assert.equal(exitCode, 1);
  assert.match(stderr, /Usage: send-telegram-document\.js <project-root> <file> \[--caption <text>\]/);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = mkFixtureRoot(true);
  const file = writeFixtureFile(root, 'report.md', '# report');
  const { exitCode, result } = runCliSubprocess([root, file], DELIVER_ENV);
  assert.equal(exitCode, 0);
  assert.equal(result.success, true);
});
