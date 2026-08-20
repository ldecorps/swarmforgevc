'use strict';

// BL-817: step handlers for "fixture tmux servers are reaped however a
// scenario ends, and the live swarm is never touched". Drives the real
// fixtureReaper.js (track/reap/isLiveRepoSwarmforgeSocket) and the real
// tmuxReaperGuard.js scan - never a reimplementation of either.
//
// Scenario 01 spawns a REAL child process (fixtureReaperTmuxOnlyHarness.js)
// that starts a REAL tmux server and registers it with track(), then ends
// the child in one of three real ways (self-reap + normal exit, an
// uncaught exception, or an external SIGTERM) - the same class of real
// process/signal proof BL-458's own fixture-process-leak-02 scenario
// established, extended to the two endings that scenario doesn't cover.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HARNESS = path.join(__dirname, 'lib', 'fixtureReaperTmuxOnlyHarness.js');
const { reap } = require('./lib/fixtureReaper');
const { scanForTmuxReaperViolations } = require('./lib/tmuxReaperGuard');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'fixture tmux servers are reaped however a scenario ends, and the live swarm is never touched';

function mkTmp(prefix) {
  return mkSocketFixtureRoot(prefix);
}

function sessionAlive(sock, session) {
  try {
    execFileSync('tmux', ['-S', sock, 'has-session', '-t', session], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function waitForStdout(child, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${pattern} in child stdout; got: ${buf}`)), timeoutMs);
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      if (pattern.test(buf)) {
        clearTimeout(timer);
        resolve(buf);
      }
    });
  });
}

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough.
const ENDING_MODES = {
  'reaching its terminal Then step': 'terminal',
  'a thrown assertion mid-scenario': 'throw',
  'a mutant failing early': 'throw',
  'the runner receiving SIGTERM': 'sigterm',
};

function knownEndingMode(token) {
  if (!Object.prototype.hasOwnProperty.call(ENDING_MODES, token)) {
    throw new Error(`unknown ending token: ${token}`);
  }
  return ENDING_MODES[token];
}

const YES_NO = { yes: true, no: false };

function knownYesNo(label, token) {
  if (!Object.prototype.hasOwnProperty.call(YES_NO, token)) {
    throw new Error(`unknown ${label} token: ${token}`);
  }
  return YES_NO[token];
}

// scenario 02's socket-location column - the socket's own SUFFIX shape,
// appended to a fixture root that (like every real fixture) lives under
// the OS temp dir. Matches fixtureReaper.js's own three real production
// shapes exactly.
const SOCKET_LOCATION_SUFFIX = {
  'the OS temp directory': (root) => path.join(root, 'plain-fixture.sock'),
  "the repo's .swarmforge/tmux directory": (root) => path.join(root, '.swarmforge', 'tmux', 'abc123.sock'),
  "the repo's .swarmforge/operator directory": (root) => path.join(root, '.swarmforge', 'operator', 'operator-tmux.sock'),
};

function knownSocketLocation(token) {
  if (!Object.prototype.hasOwnProperty.call(SOCKET_LOCATION_SUFFIX, token)) {
    throw new Error(`unknown socket_location token: ${token}`);
  }
  return SOCKET_LOCATION_SUFFIX[token];
}

function registerSteps(registry) {
  // ── Background (scenario 01) ────────────────────────────────────────────
  registry.defineScoped(
    /^a step handler that starts a fixture tmux server on its own socket$/,
    (ctx) => {
      ctx.root = mkTmp('sfvc-bl817-');
      ctx.sock = path.join(ctx.root, 'bl817.sock');
    },
    FEATURE
  );

  // ── Scenario 01 (Outline) ────────────────────────────────────────────────
  registry.defineScoped(
    /^the handler has registered its fixture root with the shared reaper$/,
    () => {
      // The harness spawned by the next step calls track() itself, in the
      // same before-the-server-is-spawned order every adopted step file
      // now follows - nothing to do here but document the ordering.
    },
    FEATURE
  );

  registry.defineScoped(
    /^the scenario ends by "([^"]+)"$/,
    async (ctx, token) => {
      const mode = knownEndingMode(token);
      const child = spawn(process.execPath, [HARNESS, ctx.root, ctx.sock, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
      ctx.child = child;
      await waitForStdout(child, /READY/, 5000);
      const exited = new Promise((resolve) => child.once('exit', resolve));
      if (mode === 'sigterm') {
        // Give the harness a moment to genuinely be idle before the signal,
        // then terminate it exactly like a killed acceptance run.
        await new Promise((resolve) => setTimeout(resolve, 200));
        child.kill('SIGTERM');
      }
      await exited;
    },
    FEATURE
  );

  registry.defineScoped(
    /^a tmux server on the fixture socket surviving is "([^"]+)"$/,
    async (ctx, token) => {
      const expectedSurvives = knownYesNo('survives', token);
      // Poll briefly - the child's own exit handler runs synchronously
      // before the process fully terminates, but this step's own process
      // still observes it asynchronously via the OS.
      const stillAlive = !(await waitFor(() => !sessionAlive(ctx.sock, 'swarmforge-coder'), 3000));
      assert.equal(stillAlive, expectedSurvives, `expected survives=${expectedSurvives}, got alive=${stillAlive}`);
    },
    FEATURE
  );

  // ── Scenario 02 (Outline) ────────────────────────────────────────────────
  registry.defineScoped(
    /^a live tmux server named "swarmforge-coder" on a socket under "([^"]+)"$/,
    (ctx, token) => {
      const buildSock = knownSocketLocation(token);
      // Deliberately NOT mkTmp()/os.tmpdir() (macOS's long /var/folders/...
      // path) - a unix socket's sun_path is capped at ~104 bytes on macOS,
      // and os.tmpdir() plus a nested .swarmforge/operator/operator-tmux.sock
      // suffix alone can exceed it.
      //
      // BL-948 hardening (hardender): this was a direct mkdtempSync('/tmp/...')
      // - short enough, so the gate never flagged it, but created OUTSIDE
      // mkSocketFixtureRoot and therefore untracked, so invariant 2's exit-hook
      // backstop could not remove it. The step reaps the tmux server (below)
      // but never removes the ROOT, and three sfvc-bl817-loc-* directories were
      // found stranded in /tmp on 2026-08-20. Routing it through the helper
      // keeps the same short base and adds the tracking that removes it.
      ctx.root02 = mkSocketFixtureRoot('sfvc-bl817-loc-');
      ctx.sock02 = buildSock(ctx.root02);
      fs.mkdirSync(path.dirname(ctx.sock02), { recursive: true });
      execFileSync('tmux', ['-S', ctx.sock02, 'new-session', '-d', '-s', 'swarmforge-coder']);
      fs.mkdirSync(path.join(ctx.root02, '.swarmforge'), { recursive: true });
      fs.writeFileSync(path.join(ctx.root02, '.swarmforge', 'tmux-socket'), ctx.sock02);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the shared reaper runs$/,
    (ctx) => {
      reap(ctx.root02 || ctx.root03);
    },
    FEATURE
  );

  registry.defineScoped(
    /^that server being killed is "([^"]+)"$/,
    async (ctx, token) => {
      const expectedKilled = knownYesNo('killed', token);
      const killed = await waitFor(() => !sessionAlive(ctx.sock02, 'swarmforge-coder'), 1500);
      assert.equal(killed, expectedKilled, `expected killed=${expectedKilled}, got killed=${killed}`);
      // Cleanup regardless of outcome - a "no" (protected) case leaves a
      // real fixture tmux server alive that this test itself must not leak.
      try {
        execFileSync('tmux', ['-S', ctx.sock02, 'kill-server'], { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
    },
    FEATURE
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────────
  // Reuses "the handler has registered its fixture root with the shared
  // reaper" from scenario 01's registration above (identical step text,
  // one registration, same as any two scenarios sharing a Given step).
  registry.defineScoped(
    /^that server has already exited before the reap$/,
    (ctx) => {
      ctx.root03 = mkTmp('sfvc-bl817-exited-');
      const sock = path.join(ctx.root03, 'already-gone.sock');
      execFileSync('tmux', ['-S', sock, 'new-session', '-d', '-s', 'fixture-already-exited']);
      execFileSync('tmux', ['-S', sock, 'kill-server']);
      fs.mkdirSync(path.join(ctx.root03, '.swarmforge'), { recursive: true });
      fs.writeFileSync(path.join(ctx.root03, '.swarmforge', 'tmux-socket'), sock);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the reap completes without raising$/,
    (ctx) => {
      assert.doesNotThrow(() => reap(ctx.root03));
    },
    FEATURE
  );

  // ── Scenario 04 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^every step handler under specs\/pipeline\/steps that starts a tmux server$/,
    (ctx) => {
      ctx.gateFixtureDir = mkTmp('sfvc-bl817-gate-');
      // Covered: requires fixtureReaper and calls track().
      fs.writeFileSync(
        path.join(ctx.gateFixtureDir, 'coveredSteps.js'),
        "const { track } = require('./lib/fixtureReaper');\ntrack(root);\nexecFileSync('tmux', ['-S', sock, 'new-session', '-d']);\n"
      );
      // Uncovered: the exact original defect shape - starts a tmux server
      // and tears it down ONLY from a terminal-step cleanup(), never
      // registering with the shared reaper.
      fs.writeFileSync(
        path.join(ctx.gateFixtureDir, 'uncoveredTerminalCleanupOnlySteps.js'),
        "execFileSync('tmux', ['-S', sock, 'new-session', '-d']);\nfunction cleanup(ctx) { execFileSync('tmux', ['-S', sock, 'kill-server']); }\n"
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^the step-handler tmux coverage gate runs$/,
    (ctx) => {
      ctx.gateResult = scanForTmuxReaperViolations(ctx.gateFixtureDir);
    },
    FEATURE
  );

  registry.defineScoped(
    /^each is reported as covered or uncovered by name$/,
    (ctx) => {
      const flaggedFiles = ctx.gateResult.map((v) => path.basename(v.file));
      assert.deepEqual(flaggedFiles, ['uncoveredTerminalCleanupOnlySteps.js'], `expected exactly the uncovered file named, got: ${JSON.stringify(flaggedFiles)}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^a handler relying only on a terminal-step cleanup is reported uncovered$/,
    (ctx) => {
      const violation = ctx.gateResult.find((v) => path.basename(v.file) === 'uncoveredTerminalCleanupOnlySteps.js');
      assert.ok(violation, 'expected the terminal-step-cleanup-only handler to be reported uncovered');
    },
    FEATURE
  );
}

module.exports = { registerSteps };
