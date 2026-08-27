'use strict';

// BL-377: step handlers for "The tmux test double answers in-process
// instead of spawning a process". Drives the REAL compiled helper
// (extension/test/helpers/fakeTmux.js) directly - it is deliberately a
// test-only module (not compiled to extension/out/), so this file requires
// it from its real source location, same as the unit tests do.
const path = require('node:path');
const cp = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { installInProcessTmux, installFakeTmux } = require(path.join(EXT_DIR, 'test', 'helpers', 'fakeTmux'));

function registerSteps(registry) {
  // ── in-process-tmux-double-01/02/05 (shared Given) ───────────────────
  // Registered AFTER the -03 variant below so the longer, more specific
  // step text ("...reporting a live session") is tried first - the IR-DRY
  // hazard the ticket's own notes call out: the short form here is a
  // strict prefix of the long one.
  registry.define(/^a test installs the in-process tmux double$/, (ctx) => {
    // Captured BEFORE the double installs its own interceptor - this IS
    // the function a real spawn would go through, and the exact function
    // restore() must put back (scenario 05).
    ctx.trueOriginalSpawnSync = cp.spawnSync;
    // Wrapped BENEATH the double (installed first, so installInProcessTmux
    // captures THIS as its own "call through for a non-tmux command"
    // fallback) - counts every call that reaches all the way down to the
    // real spawnSync, so "no child process is spawned" is held by
    // counting, never by inferring from elapsed time.
    ctx.realSpawnCallCount = 0;
    cp.spawnSync = (...args) => {
      ctx.realSpawnCallCount += 1;
      return ctx.trueOriginalSpawnSync(...args);
    };
    ctx.countingWrapper = cp.spawnSync;
    ctx.fake = installInProcessTmux([{ subcommand: 'list-sessions', exitCode: 0, stdout: 'one-session\n' }]);
  });

  // ── in-process-tmux-double-03 ─────────────────────────────────────────
  registry.define(/^a test installs the in-process tmux double reporting a live session$/, (ctx) => {
    ctx.fake = installInProcessTmux([{ subcommand: 'has-session', exitCode: 0 }]);
  });

  // ── in-process-tmux-double-01/02 (shared When) ────────────────────────
  registry.define(/^code under test invokes tmux$/, (ctx) => {
    ctx.result = cp.spawnSync('tmux', ['list-sessions']);
  });

  // ── in-process-tmux-double-01 ──────────────────────────────────────────
  registry.define(/^the double returns the configured exit code and output$/, (ctx) => {
    if (ctx.result.status !== 0 || ctx.result.stdout !== 'one-session\n') {
      throw new Error(`expected the configured exit code/output, got ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^no child process is spawned$/, (ctx) => {
    try {
      // The double's own interceptor answers a 'tmux' command itself and
      // never calls through to whatever is layered beneath it - so the
      // counting wrapper installed under it (Given step above) must show
      // zero calls.
      if (ctx.realSpawnCallCount !== 0) {
        throw new Error(`expected zero real spawnSync calls, got ${ctx.realSpawnCallCount}`);
      }
    } finally {
      // Scenario 01 has no explicit "uninstalled" step of its own - clean
      // up both layers (Given step's counting wrapper included) so this
      // scenario never leaks patched state into whatever runs after it.
      ctx.fake.restore();
      cp.spawnSync = ctx.trueOriginalSpawnSync;
    }
  });

  // ── in-process-tmux-double-02 ──────────────────────────────────────────
  registry.define(/^the recorded call log shows the exact argv, as the spawned fake recorded it$/, (ctx) => {
    try {
      const calls = ctx.fake.calls();
      if (calls.length !== 1 || calls[0].length !== 1 || calls[0][0] !== 'list-sessions') {
        throw new Error(`expected the call log to record the exact argv ['list-sessions'], got ${JSON.stringify(calls)}`);
      }
    } finally {
      // Scenario 02 has no explicit "uninstalled" step of its own either -
      // see the identical cleanup note on scenario 01's Then above.
      ctx.fake.restore();
      cp.spawnSync = ctx.trueOriginalSpawnSync;
    }
  });

  // ── in-process-tmux-double-03 ──────────────────────────────────────────
  registry.define(/^the rules are replaced so the session reads as dead$/, (ctx) => {
    const before = cp.spawnSync('tmux', ['has-session', '-t', 'sess']);
    if (before.status !== 0) {
      throw new Error('expected the session to read as alive before the rules were replaced');
    }
    ctx.fake.setRules([{ subcommand: 'has-session', exitCode: 1 }]);
  });

  registry.define(/^the next tmux call reports the session as dead$/, (ctx) => {
    try {
      const after = cp.spawnSync('tmux', ['has-session', '-t', 'sess']);
      if (after.status !== 1) {
        throw new Error(`expected the session to now read as dead, got exit code ${after.status}`);
      }
    } finally {
      // Scenario 03 has no explicit "uninstalled" step of its own - clean
      // up here so this scenario never leaks a patched spawnSync into
      // whatever acceptance scenario runs after it in this same process.
      ctx.fake.restore();
    }
  });

  // ── in-process-tmux-double-04 ──────────────────────────────────────────
  registry.define(/^a test whose code under test spawns a script that resolves tmux from PATH itself$/, (ctx) => {
    // A minimal stand-in for swarmLauncher.ts's own real `./swarm` child:
    // a script that itself calls `tmux` by shelling out, resolving it from
    // ITS OWN process's PATH - unreachable by an in-process double running
    // in THIS process.
    ctx.scriptRunner = () => {
      const { execFileSync } = require('node:child_process');
      return execFileSync(process.execPath, ['-e', "require('child_process').execFileSync('tmux', ['list-sessions'], {stdio:'inherit'})"], {
        encoding: 'utf8',
      });
    };
  });

  registry.define(/^that test installs the PATH-executable tmux fake$/, (ctx) => {
    ctx.pathFake = installFakeTmux([{ subcommand: 'list-sessions', exitCode: 0, stdout: 'from-the-real-subprocess\n' }]);
  });

  registry.define(/^the spawned script finds the fake on PATH and the test passes unchanged$/, (ctx) => {
    try {
      const output = ctx.scriptRunner();
      if (!output.includes('from-the-real-subprocess')) {
        throw new Error(`expected the spawned script's own child process to resolve the PATH-executable fake, got: ${output}`);
      }
    } finally {
      ctx.pathFake.restore();
    }
  });

  // ── in-process-tmux-double-05 ──────────────────────────────────────────
  registry.define(/^the test finishes and the double is uninstalled$/, (ctx) => {
    ctx.fake.restore();
  });

  registry.define(/^the seam it replaced is restored exactly as it was found$/, (ctx) => {
    // restore() must put cp.spawnSync back to exactly what it was AT
    // INSTALL TIME - the counting wrapper from the Given step above, since
    // that is what installInProcessTmux actually saw and must reinstate
    // (never the true original two layers down, which restore() was never
    // asked to reach past).
    if (cp.spawnSync !== ctx.countingWrapper) {
      throw new Error('expected child_process.spawnSync to be restored to exactly what it was when installInProcessTmux was called');
    }
    // Clean up the Given step's own counting layer now that the check
    // above has run, so this scenario leaves the shared child_process
    // module exactly as it found it too.
    cp.spawnSync = ctx.trueOriginalSpawnSync;
  });
}

module.exports = { registerSteps };
