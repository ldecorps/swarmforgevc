const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('../out/tools/telegram-bridge');

// BL-281: telegram-bridge.js is the thin Node CLI the Babashka Operator
// runtime shells out to (Babashka cannot import a CommonJS/TS module
// directly) - parseArgs is the pure/tested dispatch logic (engineering "CLI
// main() must be a thin wrapper over pure helpers"); the subprocess tests
// below cover main()'s own wiring without ever making a real Telegram call
// (no network dependency in the test suite - a missing/placeholder token
// fails before any request is sent).

// ── parseArgs (pure) ──────────────────────────────────────────────────────

test('parseArgs: create-topic requires a name', () => {
  assert.deepEqual(parseArgs(['create-topic', 'billing question']), { subcommand: 'create-topic', name: 'billing question' });
  assert.equal(parseArgs(['create-topic']), null);
});

test('parseArgs: send requires text, and reads optional --thread/--reply-to flags', () => {
  assert.deepEqual(parseArgs(['send', 'hello']), { subcommand: 'send', text: 'hello', threadId: undefined, replyTo: undefined });
  assert.deepEqual(parseArgs(['send', 'hello', '--thread', '7']), { subcommand: 'send', text: 'hello', threadId: 7, replyTo: undefined });
  assert.deepEqual(parseArgs(['send', 'hello', '--reply-to', '42']), { subcommand: 'send', text: 'hello', threadId: undefined, replyTo: 42 });
  assert.deepEqual(parseArgs(['send', 'hello', '--thread', '7', '--reply-to', '42']), {
    subcommand: 'send',
    text: 'hello',
    threadId: 7,
    replyTo: 42,
  });
  assert.equal(parseArgs(['send']), null);
});

test('parseArgs: get-updates requires an offset, defaults timeout to 25s', () => {
  assert.deepEqual(parseArgs(['get-updates', '6']), { subcommand: 'get-updates', offset: 6, timeoutSeconds: 25 });
  assert.deepEqual(parseArgs(['get-updates', '6', '--timeout', '10']), { subcommand: 'get-updates', offset: 6, timeoutSeconds: 10 });
  assert.equal(parseArgs(['get-updates']), null);
});

test('parseArgs: an unrecognized subcommand returns null', () => {
  assert.equal(parseArgs(['bogus']), null);
  assert.equal(parseArgs([]), null);
});

// ── subprocess: main() wiring (no real network - fails before any request) ──

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'telegram-bridge.js');

function runCli(args, env) {
  try {
    const out = execFileSync('node', [CLI_PATH, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
    return { exitCode: 0, stdout: out };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout, stderr: err.stderr };
  }
}

test('no args: exits non-zero and prints usage to stderr', () => {
  const result = runCli([], {});
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /Usage: telegram-bridge\.js/);
});

test('a missing TELEGRAM_BOT_TOKEN exits non-zero with a clear message, never a raw network error', () => {
  const result = runCli(['get-updates', '0'], { TELEGRAM_BOT_TOKEN: '' });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /TELEGRAM_BOT_TOKEN is not set/);
});

test('a missing TELEGRAM_CHAT_ID for create-topic exits non-zero with a clear message', () => {
  const result = runCli(['create-topic', 'billing question'], { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: '' });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /TELEGRAM_CHAT_ID is not set/);
});
