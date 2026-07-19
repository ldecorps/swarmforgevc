'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..', '..');
const CONSOLE = path.join(REPO, 'swarmforge', 'scripts', 'operator_telegram.bb');
const ALLOWED_ID = 12345;

const READONLY_RESPONSES = new Map([
  ['/tunnel', 'the tunnel URL and its state'],
  ['/help', 'the list of supported commands']
]);

const DISABLING_CONDITIONS = new Set([
  'SWARMFORGE_SKIP_TELEGRAM is set in the env',
  'no operator bot token is configured'
]);

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl516-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'status.json'),
    JSON.stringify({
      state: 'idle',
      provider_state: 'available',
      agents_running: 7,
      pending_events: 2,
      updated_at: '2026-07-19T20:00:00Z',
      tunnel: { state: 'running', url: 'https://vscode.dev/tunnel/swarmforge/abc' }
    })
  );
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'coder\tworking\nQA\tidle\n');
  return root;
}

function readJson(file, fallback = undefined) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

function outboxFile(ctx) {
  return path.join(ctx.root, '.swarmforge', 'operator', 'telegram-test-outbox.jsonl');
}

function statusFile(ctx) {
  return path.join(ctx.root, '.swarmforge', 'operator', 'telegram-console.status.json');
}

function pidFile(ctx) {
  return path.join(ctx.root, '.swarmforge', 'operator', 'telegram-console.pid');
}

function stateFile(ctx) {
  return path.join(ctx.root, '.swarmforge', 'operator', 'telegram-console.state.json');
}

function runConsole(ctx, args, extraEnv = {}) {
  return execFileSync('bb', [CONSOLE, ...args, ctx.root], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv }
  }).trim();
}

function update(text, fromId = ALLOWED_ID) {
  return {
    message: {
      chat: { id: 987 },
      from: { id: fromId },
      text
    }
  };
}

function runPoll(ctx, text, fromId = ALLOWED_ID, extraEnv = {}) {
  fs.rmSync(outboxFile(ctx), { force: true });
  const env = {
    OPERATOR_TELEGRAM_BOT_TOKEN: 'TOKEN',
    OPERATOR_TELEGRAM_ALLOWED_USER_ID: String(ALLOWED_ID),
    OPERATOR_TELEGRAM_FAKE_UPDATE: JSON.stringify(update(text, fromId)),
    OPERATOR_TELEGRAM_SEND_OUTBOX: outboxFile(ctx),
    ...extraEnv
  };
  ctx.lastPollResult = runConsole(ctx, ['poll-once'], env);
  const lines = fs.existsSync(outboxFile(ctx)) ? fs.readFileSync(outboxFile(ctx), 'utf8').trim().split(/\n+/).filter(Boolean) : [];
  ctx.lastReplies = lines.map((line) => JSON.parse(line));
  ctx.lastReply = ctx.lastReplies.at(-1);
}

function assertTextIncludes(text, needle, label) {
  if (!String(text || '').includes(needle)) {
    throw new Error(`${label}: expected ${JSON.stringify(text)} to include ${JSON.stringify(needle)}`);
  }
}

function registerSteps(registry) {
  registry.define(/^the operator Telegram poller is running with a valid bot token and my user id allowlisted$/, (ctx) => {
    ctx.root = mkFixture();
    ctx.ensureRunsFile = path.join(ctx.root, '.swarmforge', 'operator', 'ensure-runs.txt');
  });

  registry.define(/^I send "([^"]+)"$/, (ctx, command) => {
    runPoll(ctx, command);
  });

  registry.define(/^I receive a summary with overall health, the active roles, the tunnel URL, and the status\.json freshness$/, (ctx) => {
    const text = ctx.lastReply && ctx.lastReply.text;
    assertTextIncludes(text, 'state: idle', 'status summary health');
    assertTextIncludes(text, 'coder=working', 'status summary roles');
    assertTextIncludes(text, 'https://vscode.dev/tunnel/swarmforge/abc', 'status summary tunnel');
    assertTextIncludes(text, '2026-07-19T20:00:00Z', 'status summary freshness');
  });

  registry.define(/^a message arrives from a user id that is not on the allowlist$/, (ctx) => {
    ctx.fromId = 999;
  });

  registry.define(/^the poller processes it$/, (ctx) => {
    runPoll(ctx, '/status', ctx.fromId || ALLOWED_ID);
  });

  registry.define(/^no swarm data is returned to that sender and the ignored sender is logged$/, (ctx) => {
    if (ctx.lastReplies.length !== 0) {
      throw new Error(`expected no reply for non-allowlisted sender, got ${JSON.stringify(ctx.lastReplies)}`);
    }
    const log = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'operator', 'telegram-console.log'), 'utf8');
    assertTextIncludes(log, 'ignored-non-allowlisted', 'ignored sender log');
  });

  registry.define(/^the poller replies asking me to confirm and does not run ensure yet$/, (ctx) => {
    assertTextIncludes(ctx.lastReply && ctx.lastReply.text, 'confirm', 'ensure confirmation prompt');
    if (fs.existsSync(ctx.ensureRunsFile)) {
      throw new Error('expected /ensure prompt not to run ensure');
    }
  });

  registry.define(/^I sent "\/ensure" and was asked to confirm$/, (ctx) => {
    runPoll(ctx, '/ensure');
  });

  registry.define(/^I confirm$/, (ctx) => {
    runPoll(ctx, 'confirm', ALLOWED_ID, {
      OPERATOR_TELEGRAM_FAKE_ENSURE_RESULT: JSON.stringify({ exit: 0, tail: 'ensure ok' }),
      OPERATOR_TELEGRAM_ENSURE_COUNT_FILE: ctx.ensureRunsFile
    });
  });

  registry.define(/^\.\/swarm ensure runs exactly once and I receive its exit code and a short output tail$/, (ctx) => {
    const runs = fs.existsSync(ctx.ensureRunsFile) ? fs.readFileSync(ctx.ensureRunsFile, 'utf8').trim().split(/\n+/).filter(Boolean).length : 0;
    if (runs !== 1) {
      throw new Error(`expected one ensure run, got ${runs}`);
    }
    assertTextIncludes(ctx.lastReply && ctx.lastReply.text, 'exit 0', 'ensure result exit');
    assertTextIncludes(ctx.lastReply && ctx.lastReply.text, 'ensure ok', 'ensure result tail');
  });

  registry.define(/^an ensure is already running$/, (ctx) => {
    fs.writeFileSync(stateFile(ctx), JSON.stringify({ 'ensure-running?': true }));
  });

  registry.define(/^it is rejected with a busy notice and no second ensure is started$/, (ctx) => {
    assertTextIncludes(ctx.lastReply && ctx.lastReply.text, 'already running', 'ensure busy reply');
    if (fs.existsSync(ctx.ensureRunsFile)) {
      throw new Error('expected busy /ensure not to run ensure');
    }
  });

  registry.define(/^I receive (the tunnel URL and its state|the list of supported commands) and no control action runs$/, (ctx, response) => {
    const command = [...READONLY_RESPONSES.entries()].find(([, value]) => value === response)?.[0];
    if (!command) {
      throw new Error(`unknown read-only response example: ${response}`);
    }
    const text = ctx.lastReply && ctx.lastReply.text;
    if (command === '/tunnel') {
      assertTextIncludes(text, 'running', 'tunnel state');
      assertTextIncludes(text, 'https://vscode.dev/tunnel/swarmforge/abc', 'tunnel URL');
    } else {
      assertTextIncludes(text, '/status', 'help status');
      assertTextIncludes(text, '/ensure', 'help ensure');
    }
    if (fs.existsSync(ctx.ensureRunsFile)) {
      throw new Error(`${command} must not run ensure`);
    }
  });

  registry.define(/^(SWARMFORGE_SKIP_TELEGRAM is set in the env|no operator bot token is configured)$/, (ctx, condition) => {
    if (!DISABLING_CONDITIONS.has(condition)) {
      throw new Error(`unknown disabling condition: ${condition}`);
    }
    ctx.disablingCondition = condition;
  });

  registry.define(/^the daemon ticks$/, (ctx) => {
    const env = ctx.disablingCondition === 'SWARMFORGE_SKIP_TELEGRAM is set in the env'
      ? { SWARMFORGE_SKIP_TELEGRAM: '1', OPERATOR_TELEGRAM_BOT_TOKEN: 'TOKEN', OPERATOR_TELEGRAM_ALLOWED_USER_ID: String(ALLOWED_ID) }
      : { OPERATOR_TELEGRAM_ALLOWED_USER_ID: String(ALLOWED_ID) };
    runConsole(ctx, ['ensure'], env);
  });

  registry.define(/^no poller is started and the daemon is otherwise unaffected$/, (ctx) => {
    if (fs.existsSync(pidFile(ctx))) {
      throw new Error('expected no telegram console pid file');
    }
  });

  registry.define(/^status\.json shows the telegram console state as disabled$/, (ctx) => {
    const status = readJson(statusFile(ctx));
    if (status.state !== 'disabled') {
      throw new Error(`expected disabled telegram console status, got ${JSON.stringify(status)}`);
    }
  });

  registry.define(/^the poller subprocess has died$/, (ctx) => {
    fs.writeFileSync(pidFile(ctx), '999999999\n');
  });

  registry.define(/^the next tick runs ensure-telegram!$/, (ctx) => {
    runConsole(ctx, ['ensure'], {
      OPERATOR_TELEGRAM_BOT_TOKEN: 'TOKEN',
      OPERATOR_TELEGRAM_ALLOWED_USER_ID: String(ALLOWED_ID),
      OPERATOR_TELEGRAM_FAKE_POLL: '1'
    });
  });

  registry.define(/^the poller is relaunched headlessly with no manual step required$/, (ctx) => {
    if (!fs.existsSync(pidFile(ctx))) {
      throw new Error('expected telegram console pid after ensure');
    }
    runConsole(ctx, ['stop']);
  });

  registry.define(/^Telegram returns a 401 for the operator bot token$/, (ctx) => {
    ctx.authLost = true;
  });

  registry.define(/^the poller detects it$/, (ctx) => {
    runConsole(ctx, ['poll-once'], {
      OPERATOR_TELEGRAM_BOT_TOKEN: 'TOKEN',
      OPERATOR_TELEGRAM_ALLOWED_USER_ID: String(ALLOWED_ID),
      OPERATOR_TELEGRAM_FAKE_AUTH_LOST: '1'
    });
  });

  registry.define(/^status\.json shows the telegram console state as auth_lost and the poller backs off rather than crash-looping$/, (ctx) => {
    const status = readJson(statusFile(ctx));
    if (status.state !== 'auth_lost' || !status.backoff_until_ms) {
      throw new Error(`expected auth_lost with backoff, got ${JSON.stringify(status)}`);
    }
    if (fs.existsSync(pidFile(ctx))) {
      throw new Error('expected auth loss poll-once not to start a crash-looping poller');
    }
  });
}

module.exports = { registerSteps };
