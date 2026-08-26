'use strict';

// BL-219: step handlers for the deterministic "cannot be spawned" launch
// failure feature. Drives the real, testable extension/out/swarm/
// swarmLauncher.js module through its own injectable spawnFn seam - the
// same mechanism extension/test/swarmLauncher.test.js's unit test now uses
// instead of chmod 0o000, which root and WSL/mounted filesystems can
// silently ignore. Never a live tmux server or a real spawned process.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchSwarm } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'swarm', 'swarmLauncher.js'));

function ensureTargetPath(ctx) {
  if (!ctx.targetPath) {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-launch-spawn-fail-'));
  }
  return ctx.targetPath;
}

// A fake spawned child that deterministically fires the same 'error' event
// a real ENOENT/EACCES spawn failure would - regardless of user or
// filesystem, unlike chmod 0o000. Mirrors swarmLauncher.test.js's own
// fakeUnspawnableChild.
function fakeUnspawnableChild() {
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

function writeSwarmScript(targetPath) {
  // Only launchSwarm's fs.existsSync(swarmScript) check needs this file to
  // exist - the injected spawnFn below never actually executes it.
  fs.writeFileSync(path.join(targetPath, 'swarm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}

async function runLaunchSwarmWithUnspawnableChild(ctx) {
  const targetPath = ensureTargetPath(ctx);
  ctx.result = await launchSwarm(targetPath, undefined, 120_000, undefined, () => fakeUnspawnableChild());
}

function registerSteps(registry) {
  registry.define(/^a swarm start script that cannot be spawned$/, (ctx) => {
    writeSwarmScript(ensureTargetPath(ctx));
  });

  registry.define(/^the failure is induced via a non-existent path or an injected spawn error$/, (ctx) => {
    writeSwarmScript(ensureTargetPath(ctx));
  });

  registry.define(/^launchSwarm runs$/, runLaunchSwarmWithUnspawnableChild);

  // The forcing mechanism above (an injected spawn 'error', not a
  // permission bit) never depends on the running user or the filesystem's
  // mode-bit enforcement in the first place, so "running as root" needs no
  // special-cased setup here to still observe the same failure.
  registry.define(/^the suite runs as root or on a filesystem that ignores mode bits$/, runLaunchSwarmWithUnspawnableChild);

  registry.define(/^it resolves failure with a "([^"]+)" message$/, (ctx, expectedSubstring) => {
    if (!ctx.result || ctx.result.success !== false) {
      throw new Error(`expected launchSwarm to resolve failure, got: ${JSON.stringify(ctx.result)}`);
    }
    if (!ctx.result.message.includes(expectedSubstring)) {
      throw new Error(`expected result.message to include "${expectedSubstring}", got: "${ctx.result.message}"`);
    }
  });

  registry.define(/^launchSwarm still observes the spawn failure$/, (ctx) => {
    if (!ctx.result || ctx.result.success !== false) {
      throw new Error(`expected launchSwarm to still observe the spawn failure, got: ${JSON.stringify(ctx.result)}`);
    }
  });
}

module.exports = { registerSteps };
