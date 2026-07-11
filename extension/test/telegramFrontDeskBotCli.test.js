const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseNextSseRecord } = require('../out/tools/telegram-front-desk-bot');

// ── parseNextSseRecord (pure) ────────────────────────────────────────────

test('parseNextSseRecord parses a named event + data line, returning the remaining buffer', () => {
  const buffer = 'event: telegram-reply\ndata: {"threadId":"SUP-1","text":"hi"}\n\nrest of buffer';
  const result = parseNextSseRecord(buffer);
  assert.equal(result.event, 'telegram-reply');
  assert.equal(result.data, '{"threadId":"SUP-1","text":"hi"}');
  assert.equal(result.rest, 'rest of buffer');
});

test('parseNextSseRecord parses an UNNAMED data-only record (the BridgeState snapshot shape) with event undefined', () => {
  const result = parseNextSseRecord('data: {"pipeline":[]}\n\n');
  assert.equal(result.event, undefined);
  assert.equal(result.data, '{"pipeline":[]}');
});

test('parseNextSseRecord returns null when no complete record (no blank-line terminator) is buffered yet', () => {
  assert.equal(parseNextSseRecord('event: telegram-reply\ndata: {"threadId"'), null);
});

test('parseNextSseRecord can be called repeatedly to drain multiple buffered records', () => {
  const buffer = 'data: {"a":1}\n\ndata: {"a":2}\n\n';
  const first = parseNextSseRecord(buffer);
  assert.equal(first.data, '{"a":1}');
  const second = parseNextSseRecord(first.rest);
  assert.equal(second.data, '{"a":2}');
  assert.equal(parseNextSseRecord(second.rest), null);
});

// ── subprocess: main() wiring (no real network - fails before any request) ──

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'telegram-front-desk-bot.js');

function runCli(args, env) {
  try {
    const out = execFileSync('node', [CLI_PATH, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 5000 });
    return { exitCode: 0, stdout: out };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout, stderr: err.stderr };
  }
}

test('no args: exits non-zero and prints usage to stderr', () => {
  const result = runCli([], {});
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /Usage: telegram-front-desk-bot\.js/);
});

test('a missing TELEGRAM_BOT_TOKEN exits non-zero with a clear message, never a raw network error', () => {
  const result = runCli(['http://127.0.0.1:1', '/tmp/nonexistent-target'], { TELEGRAM_BOT_TOKEN: '' });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /TELEGRAM_BOT_TOKEN is not set/);
});

test('a missing BRIDGE_CONTROL_TOKEN exits non-zero with a clear message', () => {
  const result = runCli(['http://127.0.0.1:1', '/tmp/nonexistent-target'], {
    TELEGRAM_BOT_TOKEN: 'fake',
    TELEGRAM_CHAT_ID: 'fake',
    TELEGRAM_PRINCIPAL_USER_ID: '111',
    BRIDGE_TOKEN: 'fake',
    BRIDGE_CONTROL_TOKEN: '',
  });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /BRIDGE_CONTROL_TOKEN is not set/);
});
