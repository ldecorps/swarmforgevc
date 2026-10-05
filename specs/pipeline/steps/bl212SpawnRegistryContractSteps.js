'use strict';

// BL-1946 (BL-212 stamp-off): step handler for "the launchSwarm registry
// test is deterministic and spawns no real process". Drives the REAL
// compiled launchSwarm/readTrackedJobs with an injected fake spawnFn - the
// same contract swarmLauncher.test.js's own spawn-registry-01 test
// verifies - never a real detached process, never a real timer.

const assert = require('node:assert/strict');
const path = require('node:path');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
let _swarmLauncher = null;
function swarmLauncher() {
  if (!_swarmLauncher) _swarmLauncher = require(path.join(EXT_DIR, 'out', 'swarm', 'swarmLauncher'));
  return _swarmLauncher;
}
let _childJobRegistry = null;
function childJobRegistry() {
  if (!_childJobRegistry) _childJobRegistry = require(path.join(EXT_DIR, 'out', 'swarm', 'childJobRegistry'));
  return _childJobRegistry;
}
const { installFakeTmux } = require(path.join(EXT_DIR, 'test', 'helpers', 'fakeTmux'));
const { installExecutable } = require(path.join(EXT_DIR, 'test', 'helpers', 'sharedBin'));

const FEATURE = 'the launchSwarm registry test is deterministic and spawns no real process';

function writeReadyState(targetPath) {
  const fs = require('node:fs');
  const stateDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), path.join(targetPath, 'fake.sock'));
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), '1\tcoder\tswarmforge-coder\tCoder\tclaude\n');
}

// A fake SwarmSpawnFn (never a real detached child, never a real timer):
// announces readiness on the next microtask and exposes emitExit for the
// registry's own remove-on-exit mechanism.
function fakeSwarmChild(pid, onReady) {
  const listeners = {};
  return {
    pid,
    stdout: {
      on(event, listener) {
        if (event === 'data') {
          queueMicrotask(() => {
            onReady();
            listener(Buffer.from('SwarmForge is ready\n'));
          });
        }
      },
    },
    stderr: { on() {} },
    on(event, listener) {
      listeners[event] = listener;
    },
    emitExit() {
      listeners.exit?.();
    },
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the de-flaked test and the existing spawnTrackedJob unit tests$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl212-');
    installExecutable(path.join(root, 'swarm'), '#!/bin/sh\nexit 0\n'); // only existsSync needs this - never actually run
    ctx.bl212 = { root, tmux: installFakeTmux([{ exitCode: 0, stdout: '' }]) };
  });

  scoped(/^the suite runs$/, async (ctx) => {
    const { launchSwarm } = swarmLauncher();
    const { readTrackedJobs } = childJobRegistry();
    const child = fakeSwarmChild(54321, () => writeReadyState(ctx.bl212.root));
    try {
      const result = await launchSwarm(ctx.bl212.root, undefined, 120_000, undefined, () => child);
      ctx.bl212.launchResult = result;
      ctx.bl212.entriesWhileRunning = readTrackedJobs(path.join(ctx.bl212.root, '.swarmforge'));
      child.emitExit();
      ctx.bl212.entriesAfterExit = readTrackedJobs(path.join(ctx.bl212.root, '.swarmforge'));
    } finally {
      ctx.bl212.tmux.restore();
    }
  });

  scoped(
    /^the "launchSwarm records a swarm-launch job keyed on the process group" contract remains verified$/,
    (ctx) => {
      assert.equal(ctx.bl212.launchResult.success, true);
      assert.equal(ctx.bl212.entriesWhileRunning.length, 1);
      assert.equal(ctx.bl212.entriesWhileRunning[0].kind, 'swarm-launch');
      assert.equal(ctx.bl212.entriesWhileRunning[0].worktree, ctx.bl212.root);
      assert.equal(ctx.bl212.entriesWhileRunning[0].pgid, 54321);
      assert.deepEqual(ctx.bl212.entriesAfterExit, [], 'the entry must be removed once the process group exits');
    }
  );
}

module.exports = { registerSteps };
