'use strict';

// BL-965: step handlers for "heal wrapper temp-file cleanup on kill".
// Composes the REAL wrapper through tool_miss_heal_lib.bb's
// build-healing-wrapper-command (a small bb subprocess - never a JS
// re-statement of the wrapper text) and runs it under bash with TMPDIR
// pointed at a fixture dir, exactly the BL-960 harness seam.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HEAL_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'tool_miss_heal_lib.bb');

const FEATURE = 'BL-965 heal wrapper temp-file cleanup on kill';

const KNOWN_SIGNALS = new Set(['SIGTERM', 'SIGINT', 'SIGHUP']);

function knownSignal(token) {
  if (!KNOWN_SIGNALS.has(token)) throw new Error(`unknown <signal> token: ${token}`);
  return token;
}

let trackedRoots = [];
let trackedProcs = [];

afterEach(() => {
  while (trackedProcs.length) {
    try {
      trackedProcs.pop().kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function composeWrapper(command, worktree) {
  const expr = `
(require '[babashka.fs :as fs])
(load-file ${JSON.stringify(HEAL_LIB)})
(print (tool-miss-heal-lib/build-healing-wrapper-command ${JSON.stringify(command)} ${JSON.stringify(worktree)}))
`;
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' });
}

function sfhFiles(dir) {
  return fs.readdirSync(dir).filter((n) => n.startsWith('sfh.'));
}

async function waitFor(pred, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pred();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture TMPDIR and a composed heal wrapper for a long-running command$/, (ctx) => {
    ctx.root = mkSocketFixtureRoot('bl965-');
    trackedRoots.push(ctx.root);
    ctx.tmpDir = path.join(ctx.root, 'tmp');
    fs.mkdirSync(ctx.tmpDir, { recursive: true });
    ctx.worktree = ctx.root;
    // Long-running: emits a start marker, then sleeps far past any test
    // deadline - the kill scenarios interrupt it mid-capture.
    ctx.longCommand = `echo started; sleep 600`;
    ctx.wrapper = composeWrapper(ctx.longCommand, ctx.worktree);
  });

  scoped(
    /^the wrapped command is running and its capture file exists in the fixture TMPDIR$/,
    async (ctx) => {
      // detached: its own process group, so the kill below can signal the
      // GROUP - the routine kill shape (Bash-tool timeout, respawn-pane -k)
      // signals the group, and bash defers traps while a foreground child
      // is still alive, so a bash-only signal would merely queue the trap
      // behind the 600s sleep.
      ctx.child = spawn('bash', ['-c', ctx.wrapper], {
        env: { ...process.env, TMPDIR: ctx.tmpDir },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      trackedProcs.push(ctx.child);
      const appeared = await waitFor(() => sfhFiles(ctx.tmpDir).length === 1, 15000);
      assert.ok(appeared, `expected exactly one sfh.* capture file mid-run, got: ${JSON.stringify(sfhFiles(ctx.tmpDir))}`);
    }
  );

  scoped(/^the wrapper process receives (\S+)$/, async (ctx, token) => {
    const signal = knownSignal(token);
    // Signal the whole process GROUP (see the detached spawn above).
    process.kill(-ctx.child.pid, signal);
    const exited = await waitFor(() => ctx.child.exitCode !== null || ctx.child.signalCode !== null, 15000);
    assert.ok(exited, 'expected the signalled wrapper to terminate');
  });

  scoped(/^the fixture TMPDIR contains no sfh\.\* file afterward$/, async (ctx) => {
    const clean = await waitFor(() => sfhFiles(ctx.tmpDir).length === 0, 10000);
    assert.ok(clean, `expected zero sfh.* residue, got: ${JSON.stringify(sfhFiles(ctx.tmpDir))}`);
  });

  scoped(/^the wrapped command runs to completion$/, (ctx) => {
    const command = `printf 'line one\\n'; printf 'and err\\n' >&2; printf 'no trailing newline'`;
    const wrapper = composeWrapper(command, ctx.worktree);
    ctx.wrapped = spawnSync('bash', ['-c', wrapper], {
      env: { ...process.env, TMPDIR: ctx.tmpDir },
      encoding: 'utf8',
    });
    // The unwrapped comparison point, streams merged the way the wrapper
    // merges them (BL-960's own byte-fidelity contract).
    ctx.unwrapped = spawnSync('bash', ['-c', `{ ${command}\n} 2>&1`], { encoding: 'utf8' });
  });

  scoped(/^the wrapper's exit code and combined output are byte-identical to the unwrapped command's$/, (ctx) => {
    assert.equal(ctx.wrapped.status, ctx.unwrapped.status);
    assert.equal(ctx.wrapped.stdout, ctx.unwrapped.stdout, 'combined output must stay byte-identical');
  });
}

module.exports = { registerSteps };
