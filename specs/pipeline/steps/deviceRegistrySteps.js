'use strict';

// BL-241: step handlers for the remote-access security-hardening feature.
// Drives the REAL bridge server (out/bridge/bridgeServer.js) and its device
// registry (out/bridge/deviceRegistry.js) with tmux faked via
// installFakeTmux - mirrors bridgeServer.test.js's own pattern, since the
// hardened auth layer lives there.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
const { installFakeTmux } = require(path.join(EXT_DIR, 'test', 'helpers', 'fakeTmux'));

const TOKEN = 'aps-device-registry-token';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-device-registry-'));
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

function gatedTmuxRules() {
  return [
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: 'Proceed with the migration? (y/n)' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
  ];
}

async function getPipeline(port, token) {
  return fetch(`http://127.0.0.1:${port}/pipeline`, { headers: { authorization: `Bearer ${token}` } });
}

async function postGateAnswer(port, headers) {
  return fetch(`http://127.0.0.1:${port}/gate-answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ role: 'coder', answer: 'y' }),
  });
}

function registerSteps(registry) {
  registry.define(
    /^the remote bridge with token-based auth and one or more authorized devices$/,
    async (ctx) => {
      ctx.targetPath = mkTmp();
      writeSessionsTsv(ctx.targetPath, ['coder']);
      writeTmuxSocket(ctx.targetPath, '/tmp/aps-device-registry.sock');
      ctx.fakeTmux = installFakeTmux(gatedTmuxRules());
      ctx.bridge = await startBridge(ctx.targetPath, path.join(ctx.targetPath, 'runs.jsonl'), TOKEN, {});
    }
  );

  // ── token-rotation-01 ────────────────────────────────────────────────
  registry.define(/^a remote client authenticated with a token$/, (ctx) => {
    ctx.oldToken = ctx.bridge.token;
  });

  registry.define(/^the token is rotated$/, (ctx) => {
    const bootstrapDeviceId = ctx.bridge.getRegistry().devices[0].id;
    ctx.rotated = ctx.bridge.rotateToken(bootstrapDeviceId);
    if (!ctx.rotated) {
      throw new Error('expected the bootstrap device to exist and rotate');
    }
  });

  registry.define(/^the old token no longer authenticates and the new token does$/, async (ctx) => {
    const withOld = await getPipeline(ctx.bridge.port, ctx.oldToken);
    if (withOld.status !== 401) {
      throw new Error(`expected the old token to be rejected, got status ${withOld.status}`);
    }
    const withNew = await getPipeline(ctx.bridge.port, ctx.rotated.token);
    if (withNew.status !== 200) {
      throw new Error(`expected the new token to authenticate, got status ${withNew.status}`);
    }
    ctx.bridge.stop();
    ctx.fakeTmux.restore();
  });

  // ── device-revocation-02 ─────────────────────────────────────────────
  registry.define(/^multiple authorized devices$/, (ctx) => {
    ctx.alice = ctx.bridge.registerDevice('alice-phone', 'read');
    ctx.bob = ctx.bridge.registerDevice('bob-phone', 'read');
  });

  registry.define(/^one device is revoked$/, (ctx) => {
    ctx.bridge.revokeDevice(ctx.alice.id);
  });

  registry.define(/^it can no longer connect and the other devices are unaffected$/, async (ctx) => {
    const aliceRes = await getPipeline(ctx.bridge.port, ctx.alice.token);
    if (aliceRes.status !== 401) {
      throw new Error(`expected the revoked device to be rejected, got status ${aliceRes.status}`);
    }
    const bobRes = await getPipeline(ctx.bridge.port, ctx.bob.token);
    if (bobRes.status !== 200) {
      throw new Error(`expected the non-revoked device to be unaffected, got status ${bobRes.status}`);
    }
    ctx.bridge.stop();
    ctx.fakeTmux.restore();
  });

  // ── read-only-cannot-control-03 ──────────────────────────────────────
  registry.define(/^a remote client scoped to read-only$/, (ctx) => {
    ctx.device = ctx.bridge.registerDevice('viewer', 'read');
  });

  registry.define(/^it attempts a control action such as answering a gate$/, async (ctx) => {
    ctx.response = await postGateAnswer(ctx.bridge.port, {
      authorization: `Bearer ${ctx.device.token}`,
      'x-control-token': ctx.device.token,
    });
  });

  registry.define(/^the action is refused$/, (ctx) => {
    if (ctx.response.status === 200) {
      throw new Error('expected a read-only-scoped client to be refused a control action');
    }
    if (ctx.fakeTmux.calls().some((args) => args.includes('send-keys'))) {
      throw new Error('a refused control action must never reach tmux');
    }
    ctx.bridge.stop();
    ctx.fakeTmux.restore();
  });

  // ── control-requires-step-up-04 ──────────────────────────────────────
  registry.define(/^a remote client authorized for control$/, (ctx) => {
    ctx.device = ctx.bridge.registerDevice('laptop', 'control');
  });

  registry.define(/^it performs a control action$/, async (ctx) => {
    // First, prove the base token ALONE (what read-only viewing needs) is
    // not enough for control - the step-up header is what makes the
    // difference, not a different token value.
    ctx.bearerOnlyResponse = await postGateAnswer(ctx.bridge.port, { authorization: `Bearer ${ctx.device.token}` });
    ctx.response = await postGateAnswer(ctx.bridge.port, {
      authorization: `Bearer ${ctx.device.token}`,
      'x-control-token': ctx.device.controlToken,
    });
  });

  registry.define(/^it must pass a stronger auth step than read-only viewing requires$/, (ctx) => {
    if (ctx.bearerOnlyResponse.status === 200) {
      throw new Error('expected the bearer token ALONE (sufficient for read) to be insufficient for control');
    }
    if (ctx.response.status !== 200) {
      throw new Error(`expected the control action to succeed once the step-up header is also presented, got ${ctx.response.status}`);
    }
    ctx.bridge.stop();
    ctx.fakeTmux.restore();
  });
}

module.exports = { registerSteps };
