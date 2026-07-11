const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseCliArgs } = require('../out/tools/telegram-front-desk-bot');

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
