const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../out/tools/telegram-cursor-bridge');
const live = require('../out/tools/telegramCursorBridgeLive');
const sessionMod = require('../out/bridge/cursorBridgeAgentSession');

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'telegram-cursor-bridge.js');
const ENV_KEYS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'TELEGRAM_PRINCIPAL_USER_ID',
  'CURSOR_BRIDGE_BOOT_PROMPT',
];

function mkTmp() {
  return mkTmpDir('sfvc-telegram-cursor-bridge-');
}

async function runCli(repoRoot, overrides = {}) {
  const previousArgv = process.argv;
  const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const args = repoRoot === undefined ? [] : [repoRoot];
  process.argv = ['node', CLI_PATH, ...args];
  for (const key of ENV_KEYS) {
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }

  let exitCode = 0;
  let thrown;
  try {
    await main();
  } catch (error) {
    thrown = error;
    exitCode = 1;
  } finally {
    process.argv = previousArgv;
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
  return { exitCode, thrown };
}

test('telegram-cursor-bridge main rejects missing Telegram env', async () => {
  const prev = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    TELEGRAM_PRINCIPAL_USER_ID: process.env.TELEGRAM_PRINCIPAL_USER_ID,
  };
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_PRINCIPAL_USER_ID;
  try {
    await assert.rejects(() => main(), /TELEGRAM_BOT_TOKEN/);
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('telegram-cursor-bridge main rejects a missing TELEGRAM_CHAT_ID', async () => {
  const result = await runCli(mkTmp(), {
    TELEGRAM_BOT_TOKEN: 'tok',
    TELEGRAM_PRINCIPAL_USER_ID: '42',
  });
  assert.match(String(result.thrown?.message ?? ''), /TELEGRAM_CHAT_ID/);
});

test('telegram-cursor-bridge main rejects a missing TELEGRAM_PRINCIPAL_USER_ID', async () => {
  const result = await runCli(mkTmp(), {
    TELEGRAM_BOT_TOKEN: 'tok',
    TELEGRAM_CHAT_ID: '-100',
  });
  assert.match(String(result.thrown?.message ?? ''), /TELEGRAM_PRINCIPAL_USER_ID/);
});

test('telegram-cursor-bridge main wires env and argv repo root into runCursorBridgeApp', async () => {
  const repoRoot = mkTmp();
  const previousRun = live.runCursorBridgeApp;
  const previousCreate = sessionMod.createLiveCursorBridgeAgentSession;
  let capturedConfig;
  let capturedSession;
  live.runCursorBridgeApp = async (config, session) => {
    capturedConfig = config;
    capturedSession = session;
  };
  sessionMod.createLiveCursorBridgeAgentSession = (root) => ({ repoRoot: root, kind: 'mock-session' });
  try {
    const result = await runCli(repoRoot, {
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_CHAT_ID: '-100',
      TELEGRAM_PRINCIPAL_USER_ID: '42',
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(capturedConfig, {
      repoRoot: path.resolve(repoRoot),
      botToken: 'bot-token',
      chatId: '-100',
      principalUserId: '42',
      bootPrompt: undefined,
    });
    assert.equal(capturedSession.repoRoot, path.resolve(repoRoot));
    assert.equal(capturedSession.kind, 'mock-session');
  } finally {
    live.runCursorBridgeApp = previousRun;
    sessionMod.createLiveCursorBridgeAgentSession = previousCreate;
  }
});

test('telegram-cursor-bridge main falls back to cwd when repo root argv is omitted', async () => {
  const previousRun = live.runCursorBridgeApp;
  let capturedConfig;
  live.runCursorBridgeApp = async (config) => {
    capturedConfig = config;
  };
  try {
    const result = await runCli(undefined, {
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_CHAT_ID: '-100',
      TELEGRAM_PRINCIPAL_USER_ID: '42',
    });
    assert.equal(result.exitCode, 0);
    assert.equal(capturedConfig.repoRoot, path.resolve(process.cwd()));
  } finally {
    live.runCursorBridgeApp = previousRun;
  }
});

test('telegram-cursor-bridge main passes a trimmed boot prompt when configured', async () => {
  const repoRoot = mkTmp();
  const previousRun = live.runCursorBridgeApp;
  let capturedConfig;
  live.runCursorBridgeApp = async (config) => {
    capturedConfig = config;
  };
  try {
    const result = await runCli(repoRoot, {
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_CHAT_ID: '-100',
      TELEGRAM_PRINCIPAL_USER_ID: '42',
      CURSOR_BRIDGE_BOOT_PROMPT: '  wake up  ',
    });
    assert.equal(result.exitCode, 0);
    assert.equal(capturedConfig.bootPrompt, 'wake up');
  } finally {
    live.runCursorBridgeApp = previousRun;
  }
});

test('telegram-cursor-bridge main omits boot prompt when env is unset or whitespace-only', async () => {
  const repoRoot = mkTmp();
  const previousRun = live.runCursorBridgeApp;
  live.runCursorBridgeApp = async (config) => {
    assert.equal(config.bootPrompt, undefined);
  };
  try {
    for (const bootPrompt of [undefined, '   ']) {
      const overrides = {
        TELEGRAM_BOT_TOKEN: 'bot-token',
        TELEGRAM_CHAT_ID: '-100',
        TELEGRAM_PRINCIPAL_USER_ID: '42',
      };
      if (bootPrompt !== undefined) overrides.CURSOR_BRIDGE_BOOT_PROMPT = bootPrompt;
      const result = await runCli(repoRoot, overrides);
      assert.equal(result.exitCode, 0);
    }
  } finally {
    live.runCursorBridgeApp = previousRun;
  }
});

function runCliSubprocess(args, env) {
  try {
    execFileSync('node', [CLI_PATH, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0 };
  } catch (err) {
    return { exitCode: err.status, stderr: String(err.stderr ?? '') };
  }
}

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled telegram-cursor-bridge CLI runs standalone as a subprocess and rejects missing Telegram env', () => {
  const result = runCliSubprocess([mkTmp()], {
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    TELEGRAM_PRINCIPAL_USER_ID: '',
  });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /TELEGRAM_BOT_TOKEN/);
});
