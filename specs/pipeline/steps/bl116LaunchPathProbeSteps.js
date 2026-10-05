'use strict';

// BL-1946 (BL-116 stamp-off): step handlers for "launches find their tools
// and leave a durable trace". Drives the REAL compiled swarmLauncher.js
// (probeLoginShellPath/getCachedLoginShellPathDirs/augmentPath/launchSwarm)
// against fixtures under a tracked mkdtemp root, with a fake tmux and a
// fake ./swarm script - never a real subprocess/timer, never this
// checkout's own git/backlog/.swarmforge.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
let _swarmLauncher = null;
function swarmLauncher() {
  if (!_swarmLauncher) _swarmLauncher = require(path.join(EXT_DIR, 'out', 'swarm', 'swarmLauncher'));
  return _swarmLauncher;
}
const { installFakeTmux } = require(path.join(EXT_DIR, 'test', 'helpers', 'fakeTmux'));
const { installExecutable } = require(path.join(EXT_DIR, 'test', 'helpers', 'sharedBin'));

const FEATURE = 'launches find their tools and leave a durable trace';

function writeReadyState(targetPath) {
  const stateDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), path.join(targetPath, 'fake.sock'));
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), '1\tcoder\tswarmforge-coder\tCoder\tclaude\n');
}

function writeSwarmScript(targetPath) {
  return installExecutable(path.join(targetPath, 'swarm'), '#!/bin/sh\nexit 0\n');
}

// A fake SwarmLaunchChild (swarmLauncher.ts's own injectable spawn seam)
// that announces readiness (or fails) deterministically, the same shape
// swarmLauncher.test.js's own fakeSwarmChild/fakeUnspawnableChild use.
function fakeSuccessfulChild(targetPath) {
  const stdoutListeners = {};
  return {
    pid: 11111,
    stdout: {
      on(event, listener) {
        stdoutListeners[event] = listener;
        if (event === 'data') {
          writeReadyState(targetPath);
          queueMicrotask(() => listener(Buffer.from('SwarmForge is ready\n')));
        }
      },
    },
    stderr: { on() {} },
    on() {},
  };
}

function fakeFailingChild() {
  return {
    pid: undefined,
    stdout: { on() {} },
    stderr: { on() {} },
    on(event, listener) {
      if (event === 'error') {
        queueMicrotask(() => listener(new Error('spawn ENOENT')));
      }
    },
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the user's login shell reports directories missing from process\.env\.PATH$/, (ctx) => {
    const { resetLoginShellPathCacheForTests } = swarmLauncher();
    resetLoginShellPathCacheForTests();
    ctx.bl116 = { probedDirs: ['/opt/fixture-tools/bin'], runCalls: 0 };
    ctx.bl116.runFn = async () => {
      ctx.bl116.runCalls += 1;
      return { code: 0, stdout: '/opt/fixture-tools/bin\n' };
    };
  });

  scoped(/^the extension resolves the launch PATH$/, async (ctx) => {
    const { getCachedLoginShellPathDirs } = swarmLauncher();
    // Called twice - "at most once per activation" means the second call
    // must reuse the first's cached result rather than probing again.
    ctx.bl116.firstResult = await getCachedLoginShellPathDirs('/bin/fixture-shell', 1500, ctx.bl116.runFn);
    ctx.bl116.secondResult = await getCachedLoginShellPathDirs('/bin/fixture-shell', 1500, ctx.bl116.runFn);
  });

  scoped(/^the probed directories are merged in$/, (ctx) => {
    const { augmentPath } = swarmLauncher();
    assert.deepEqual(ctx.bl116.firstResult, ctx.bl116.probedDirs);
    const merged = augmentPath('/usr/bin', ctx.bl116.firstResult);
    assert.ok(merged.split(':').includes('/opt/fixture-tools/bin'), `expected the probed dir merged into: ${merged}`);
  });

  scoped(/^the probe runs at most once per activation \(cached thereafter\)$/, (ctx) => {
    assert.equal(ctx.bl116.runCalls, 1, 'expected the login-shell probe to run exactly once across both resolutions');
    assert.deepEqual(ctx.bl116.secondResult, ctx.bl116.firstResult, 'the second resolution must reuse the cached probe result');
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the login-shell probe fails or times out$/, (ctx) => {
    const { resetLoginShellPathCacheForTests } = swarmLauncher();
    resetLoginShellPathCacheForTests();
    ctx.bl116 = {
      runFn: async () => ({ code: 1, stdout: '' }),
    };
  });

  scoped(/^the current hardcoded directory list is used$/, async (ctx) => {
    const { getCachedLoginShellPathDirs, augmentPath } = swarmLauncher();
    const probed = await getCachedLoginShellPathDirs('/bin/fixture-shell', 1500, ctx.bl116.runFn);
    assert.deepEqual(probed, [], 'a failed probe must contribute no directories');
    ctx.bl116.withNoProbe = augmentPath('/usr/bin', probed);
    ctx.bl116.baseline = augmentPath('/usr/bin', []);
    assert.equal(ctx.bl116.withNoProbe, ctx.bl116.baseline, 'a failed probe must fall back to exactly the hardcoded-list behavior');
  });

  scoped(/^launching still works as it does today on macOS$/, (ctx) => {
    // "Still works as today" is exactly the fallback-equals-baseline
    // assertion above: a failed probe changes nothing about what
    // augmentPath (and therefore launchSwarm's own PATH) produces.
    assert.ok(ctx.bl116.withNoProbe.length > 0);
  });

  // ── Scenario 03 (Outline) ────────────────────────────────────────────
  scoped(/^a launch attempt that (succeeds|fails)$/, (ctx, outcome) => {
    const root = trackedTmpRoot('sfvc-bl116-launchlog-');
    writeSwarmScript(root);
    const tmux = installFakeTmux([{ exitCode: 0, stdout: '' }]);
    ctx.bl116 = { root, outcome, tmux };
  });

  scoped(/^the attempt finishes$/, async (ctx) => {
    const { launchSwarm } = swarmLauncher();
    try {
      ctx.bl116.result = await launchSwarm(
        ctx.bl116.root,
        undefined,
        5000,
        undefined,
        ctx.bl116.outcome === 'succeeds' ? () => fakeSuccessfulChild(ctx.bl116.root) : () => fakeFailingChild()
      );
    } finally {
      ctx.bl116.tmux.restore();
    }
  });

  scoped(
    /^\.swarmforge\/last-launch\.log contains the \.\/swarm stdout and stderr and the final LaunchResult$/,
    (ctx) => {
      const logPath = path.join(ctx.bl116.root, '.swarmforge', 'last-launch.log');
      assert.ok(fs.existsSync(logPath), `expected a launch log at ${logPath}`);
      const text = fs.readFileSync(logPath, 'utf8');
      assert.match(text, /--- stdout ---/);
      assert.match(text, /--- stderr ---/);
      assert.equal(/success: true/.test(text), ctx.bl116.outcome === 'succeeds', `expected success to match outcome=${ctx.bl116.outcome}, got:\n${text}`);
      assert.match(text, new RegExp(`message: ${ctx.bl116.result.message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }
  );
}

module.exports = { registerSteps };
