'use strict';

// BL-240: step handlers for the remote gate-answer write path feature.
// Drives the REAL bridge server (out/bridge/bridgeServer.js) with tmux
// faked via installFakeTmux - mirrors bridgeServer.test.js's own pattern
// exactly, since this ticket's write route lives there.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
const { installFakeTmux } = require(path.join(EXT_DIR, 'test', 'helpers', 'fakeTmux'));

const TOKEN = 'aps-gate-answer-token';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-gate-answer-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeSessionsTsv(targetPath, roles) {
  mkdirp(path.join(targetPath, '.swarmforge'));
  const tsv = roles.map((role, i) => [i + 1, role, `swarmforge-${role}`, role, 'claude'].join('\t')).join('\n');
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'sessions.tsv'), tsv + '\n');
}

function writeTmuxSocket(targetPath, socketPath) {
  mkdirp(path.join(targetPath, '.swarmforge'));
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'tmux-socket'), socketPath);
}

const GATE_PANE_TEXT = 'Proceed with the migration? (y/n)';

function gatedTmuxRules() {
  return [
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: GATE_PANE_TEXT },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
  ];
}

async function postGateAnswer(port, headers, body) {
  return fetch(`http://127.0.0.1:${port}/gate-answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function registerSteps(registry) {
  registry.define(/^an agent blocked on a captured to-human gate in the message store$/, (ctx) => {
    ctx.targetPath = mkTmp();
    writeSessionsTsv(ctx.targetPath, ['coder']);
    writeTmuxSocket(ctx.targetPath, '/tmp/aps-gate-answer.sock');
    ctx.fakeTmux = installFakeTmux(gatedTmuxRules());
  });

  // ── answer-unblocks-01 ─────────────────────────────────────────────────
  registry.define(/^an authenticated remote client$/, (ctx) => {
    ctx.authHeaders = { authorization: `Bearer ${TOKEN}` };
  });

  registry.define(/^it submits an answer to that captured gate$/, async (ctx) => {
    ctx.bridge = await startBridge(ctx.targetPath, path.join(ctx.targetPath, 'runs.jsonl'), TOKEN, {});
    ctx.response = await postGateAnswer(ctx.bridge.port, ctx.authHeaders, { role: 'coder', answer: 'y' });
    ctx.responseBody = await ctx.response.json();
    ctx.bridge.stop();
  });

  registry.define(/^the gate is answered via the same helper-script call the extension uses locally$/, (ctx) => {
    if (!ctx.responseBody.success) {
      throw new Error(`expected the gate answer to succeed, got: ${JSON.stringify(ctx.responseBody)}`);
    }
    const sendCalls = ctx.fakeTmux.calls().filter((args) => args.includes('send-keys'));
    if (sendCalls.length === 0) {
      throw new Error('expected the same tmux send-keys call the local operator input path uses');
    }
  });

  registry.define(/^the blocked item proceeds$/, (ctx) => {
    if (ctx.response.status !== 200) {
      throw new Error(`expected a 200 response confirming the item proceeds, got: ${ctx.response.status}`);
    }
  });

  // ── scope-gates-only-02 ────────────────────────────────────────────────
  registry.define(/^it attempts an action other than answering a captured gate$/, async (ctx) => {
    ctx.bridge = await startBridge(ctx.targetPath, path.join(ctx.targetPath, 'runs.jsonl'), TOKEN, {});
    ctx.response = await postGateAnswer(ctx.bridge.port, ctx.authHeaders, { action: 'shell', command: 'rm -rf /' });
    ctx.bridge.stop();
  });

  registry.define(/^the action is refused with no arbitrary keystrokes or shell executed$/, (ctx) => {
    if (ctx.response.status === 200) {
      throw new Error('expected a non-gate-answer action to be refused, got 200');
    }
    if (ctx.fakeTmux.calls().some((args) => args.includes('send-keys'))) {
      throw new Error('a non-gate-answer action must never reach tmux send-keys');
    }
  });

  // ── unauthenticated-refused-03 ───────────────────────────────────────────
  registry.define(/^a remote client without valid authentication$/, (ctx) => {
    ctx.authHeaders = {};
  });

  registry.define(/^the attempt is refused$/, (ctx) => {
    if (ctx.response.status !== 401) {
      throw new Error(`expected 401 unauthorized, got: ${ctx.response.status}`);
    }
    if (ctx.fakeTmux.calls().length > 0) {
      throw new Error('auth must be checked before any tmux interaction');
    }
  });

  // ── answer-targets-specific-gate-04 ──────────────────────────────────────
  registry.define(/^two roles each blocked on a distinct captured gate$/, (ctx) => {
    ctx.targetPath = mkTmp();
    writeSessionsTsv(ctx.targetPath, ['coder', 'cleaner']);
    writeTmuxSocket(ctx.targetPath, '/tmp/aps-gate-answer-two.sock');
    ctx.fakeTmux = installFakeTmux(gatedTmuxRules());
    ctx.authHeaders = { authorization: `Bearer ${TOKEN}` };
  });

  registry.define(/^the remote client answers one of them$/, async (ctx) => {
    ctx.bridge = await startBridge(ctx.targetPath, path.join(ctx.targetPath, 'runs.jsonl'), TOKEN, {});
    ctx.response = await postGateAnswer(ctx.bridge.port, ctx.authHeaders, { role: 'coder', answer: 'y' });
    ctx.responseBody = await ctx.response.json();
    ctx.bridge.stop();
  });

  registry.define(/^only that gate is answered and the other remains blocked$/, (ctx) => {
    if (!ctx.responseBody.success) {
      throw new Error(`expected the targeted role's gate to be answered, got: ${JSON.stringify(ctx.responseBody)}`);
    }
    const sendCalls = ctx.fakeTmux.calls().filter((args) => args.includes('send-keys'));
    const targets = sendCalls.map((args) => args[args.indexOf('-t') + 1]);
    if (targets.some((t) => t && !t.startsWith('swarmforge-coder'))) {
      throw new Error(`expected every send-keys call to target only "coder", got targets: ${JSON.stringify(targets)}`);
    }
  });
}

module.exports = { registerSteps };
