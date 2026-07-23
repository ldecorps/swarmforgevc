'use strict';

// BL-265 slice 1: step handlers for the GET /gates read-route feature.
// Drives the REAL bridge server (out/bridge/bridgeServer.js) with tmux
// faked via installFakeTmux - mirrors gateAnswerSteps.js's own pattern
// exactly (that ticket's write route lives in the same file this one's
// read route does).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
const { installFakeTmux } = require(path.join(EXT_DIR, 'test', 'helpers', 'fakeTmux'));

const TOKEN = 'aps-gates-list-token';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-gates-list-'));
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

// One role reads as gated (a captured question), the other reads as idle -
// distinguished by session name in the capture-pane -t target, so
// "a non-gated role is absent from the list" is a REAL fixture distinction,
// not both roles trivially gated the same way.
function mixedGateTmuxRules() {
  return [
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'capture-pane', argsInclude: 'swarmforge-coder', exitCode: 0, stdout: 'Proceed with the migration? (y/n)' },
    { subcommand: 'capture-pane', argsInclude: 'swarmforge-cleaner', exitCode: 0, stdout: '[auto] idle' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
  ];
}

function allIdleTmuxRules() {
  return [
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: '[auto] idle' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
  ];
}

async function getGates(port, headers) {
  return fetch(`http://127.0.0.1:${port}/gates`, { headers });
}

async function requestGateList(ctx) {
  ctx.bridge = await startBridge(ctx.targetPath, path.join(ctx.targetPath, 'runs.jsonl'), TOKEN, {});
  // BL-265 gates-read-scope-suffices-04: the device MUST be registered on
  // this exact bridge instance - registering on a separate, earlier bridge
  // (then requesting against this one) would test nothing, since each
  // bridge instance owns its own device registry.
  if (ctx.useReadScopedDevice) {
    const viewer = ctx.bridge.registerDevice('phone', 'read');
    ctx.authHeaders = { authorization: `Bearer ${viewer.token}` };
  }
  ctx.response = await getGates(ctx.bridge.port, ctx.authHeaders || {});
  ctx.responseBody = ctx.response.status === 200 ? await ctx.response.json() : null;
  ctx.bridge.stop();
  if (ctx.fakeTmux) {
    ctx.fakeTmux.restore();
    ctx.fakeTmux = null;
  }
}

function registerSteps(registry) {
  registry.define(/^a running swarm and the bridge started via its opt-in command$/, (ctx) => {
    ctx.targetPath = mkTmp();
  });

  // ── gates-list-pending-01 ─────────────────────────────────────────────
  registry.define(/^one or more roles are blocked on a captured to-human gate$/, (ctx) => {
    writeSessionsTsv(ctx.targetPath, ['coder', 'cleaner']);
    writeTmuxSocket(ctx.targetPath, '/tmp/aps-gates-list.sock');
    ctx.fakeTmux = installFakeTmux(mixedGateTmuxRules());
  });

  registry.define(/^a client with a valid read token$/, (ctx) => {
    ctx.authHeaders = { authorization: `Bearer ${TOKEN}` };
  });

  registry.define(/^it requests the pending-gate list$/, async (ctx) => {
    await requestGateList(ctx);
  });

  registry.define(/^the response names each currently-gated role with its question snippet$/, (ctx) => {
    const coderEntry = ctx.responseBody.find((g) => g.role === 'coder');
    if (!coderEntry) {
      throw new Error(`expected the gated role "coder" to appear in the list; got: ${JSON.stringify(ctx.responseBody)}`);
    }
    if (!/Proceed with the migration/.test(coderEntry.snippet || '')) {
      throw new Error(`expected coder's entry to carry its question snippet; got: ${JSON.stringify(coderEntry)}`);
    }
  });

  registry.define(/^a role that is not gated is absent from the list$/, (ctx) => {
    if (ctx.responseBody.some((g) => g.role === 'cleaner')) {
      throw new Error(`expected the non-gated role "cleaner" to be absent from the list; got: ${JSON.stringify(ctx.responseBody)}`);
    }
  });

  // ── gates-empty-when-none-02 ──────────────────────────────────────────
  registry.define(/^no role is blocked on a captured to-human gate$/, (ctx) => {
    writeSessionsTsv(ctx.targetPath, ['coder']);
    writeTmuxSocket(ctx.targetPath, '/tmp/aps-gates-list-empty.sock');
    ctx.fakeTmux = installFakeTmux(allIdleTmuxRules());
  });

  registry.define(/^the response is a successful empty list rather than an error$/, (ctx) => {
    if (ctx.response.status !== 200) {
      throw new Error(`expected 200, got ${ctx.response.status}`);
    }
    if (!Array.isArray(ctx.responseBody) || ctx.responseBody.length !== 0) {
      throw new Error(`expected a successful empty list, got: ${JSON.stringify(ctx.responseBody)}`);
    }
  });

  // ── gates-unauthenticated-refused-03 ──────────────────────────────────
  registry.define(/^a client without valid authentication$/, (ctx) => {
    ctx.authHeaders = {};
  });

  registry.define(/^the request is refused$/, (ctx) => {
    if (ctx.response.status !== 401) {
      throw new Error(`expected 401 unauthorized, got: ${ctx.response.status}`);
    }
  });

  // ── gates-read-scope-suffices-04 ──────────────────────────────────────
  // Registration happens inside requestGateList (the shared "When" step
  // below), on the SAME bridge instance the request is made against - this
  // step only records the intent; ctx.authHeaders is set there instead of
  // here, deliberately never carrying an x-control-token.
  registry.define(/^a client authenticated as a read-scoped device$/, (ctx) => {
    ctx.useReadScopedDevice = true;
  });

  registry.define(/^the pending-gate list is returned without requiring the control step-up$/, (ctx) => {
    if (ctx.response.status !== 200) {
      throw new Error(`expected the read-scoped device to list gates without a step-up, got: ${ctx.response.status}`);
    }
    if (!ctx.responseBody.some((g) => g.role === 'coder')) {
      throw new Error(`expected the gated role to still appear for a read-scoped device; got: ${JSON.stringify(ctx.responseBody)}`);
    }
  });
}

module.exports = { registerSteps };
