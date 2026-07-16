'use strict';

// BL-458: step handlers for "acceptance-test fixtures always reap the
// process trees they spawn, and orphans self-heal". Scenario 01 drives the
// REAL pure decision function (fixture_reaper_lib.bb's reapable?) via
// fixture_reapable_decision_acceptance_runner.bb - the same Babashka-runner
// pattern sandbox_sweep_decision_acceptance_runner.bb (BL-413) already
// established - never a hand-rolled reimplementation of the decision in JS.
// Scenario 02 spawns a REAL subprocess (fixtureReaperAbnormalExitHarness.js)
// that launches a real front-desk supervisor+bridge+bot+tmux tree and is
// then SIGTERM'd before it ever reaps itself, proving the shared
// fixtureReaper.js's signal handler is what actually cleans up. Scenario 03
// drives a real fixture_reaper_sweep_lib.bb sweep! subprocess (via
// operator_runtime.bb --tick-once, mirroring
// bl413StaleSandboxSweepSteps.js's own real-subprocess convention) against a
// private fixture root - never the real /tmp or a live swarm.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DECISION_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'fixture_reapable_decision_acceptance_runner.bb');
const OPERATOR_RUNTIME = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_runtime.bb');
const ABNORMAL_EXIT_HARNESS = path.join(__dirname, 'lib', 'fixtureReaperAbnormalExitHarness.js');

// "its age past the stale threshold is" is bl413StaleSandboxSweepSteps.js's
// own step text too (registered earlier in specs/pipeline/steps/index.js's
// DOMAINS array, so it would win first-match unscoped - a real collision,
// unrelated behavior, both files just happen to set a same-named ctx field).
// Registered via defineScoped, pinned to this exact Feature: title, so it is
// only ever preferred when THIS feature is running (bl425RoleSteeringTopicsSteps.js's
// own identical note is the precedent for this fix).
const FEATURE_NAME = 'acceptance-test fixtures always reap the process trees they spawn, and orphans self-heal';

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_BOOLEANS = { yes: true, no: false };

function knownBoolean(label, value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_BOOLEANS, value)) {
    throw new Error(`fixture-process-leak: unrecognized <${label}> example value "${value}"`);
  }
  return KNOWN_BOOLEANS[value];
}

function runDecision(scenario) {
  const out = execFileSync('bb', [DECISION_RUNNER, JSON.stringify(scenario)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function freePort() {
  return 25000 + Math.floor(Math.random() * 9000);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
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

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the acceptance-test fixture process reaper$/, (ctx) => {
    ctx.decisionInput = { knownFixturePrefix: false, stale: false, socketRoot: false };
  });

  // ── fixture-process-leak-01 (Scenario Outline) ──────────────────────────
  registry.define(/^a \/tmp entry whose name matches a known test-fixture prefix is "([^"]+)"$/, (ctx, value) => {
    ctx.decisionInput.knownFixturePrefix = knownBoolean('prefix_match', value);
  });

  registry.defineScoped(
    /^its age past the stale threshold is "([^"]+)"$/,
    (ctx, value) => {
      ctx.decisionInput.stale = knownBoolean('is_stale', value);
    },
    FEATURE_NAME
  );

  registry.define(/^it being the live swarm socket root is "([^"]+)"$/, (ctx, value) => {
    ctx.decisionInput.socketRoot = knownBoolean('is_socket_root', value);
  });

  registry.define(/^the reaper evaluates the entry$/, (ctx) => {
    ctx.result = runDecision(ctx.decisionInput);
  });

  registry.define(/^the fixture process tree is killed and its root removed is "([^"]+)"$/, (ctx, value) => {
    const expected = knownBoolean('reaped', value);
    if (ctx.result.reapable !== expected) {
      throw new Error(`expected reapable=${expected} for ${JSON.stringify(ctx.decisionInput)}, got reapable=${ctx.result.reapable}`);
    }
  });

  // ── fixture-process-leak-02 ──────────────────────────────────────────────
  registry.define(
    /^a step file has launched a detached front-desk supervisor, bridge, bot, and tmux server rooted in a fixture directory$/,
    async (ctx) => {
      ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-fixture-reaper-abnormal-exit-'));
      ctx.port = freePort();
      ctx.harness = spawn(process.execPath, [ABNORMAL_EXIT_HARNESS, ctx.root, String(ctx.port)], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      ctx.harness.stdout.on('data', (chunk) => {
        out += chunk.toString();
      });
      let err = '';
      ctx.harness.stderr.on('data', (chunk) => {
        err += chunk.toString();
      });
      const ready = await waitFor(() => out.includes('READY'), 15000);
      if (!ready) {
        throw new Error(`expected the abnormal-exit harness to report READY, got stdout=${out} stderr=${err}`);
      }
      const readyLine = out.split('\n').find((l) => l.startsWith('READY'));
      ctx.fixture = JSON.parse(readyLine.slice('READY '.length));
    }
  );

  registry.define(/^the runner is terminated with SIGTERM before the scenario's inline teardown runs$/, async (ctx) => {
    ctx.harness.kill('SIGTERM');
    // Bounded wait for the harness process itself to actually exit (its own
    // SIGTERM handler runs reap() synchronously before process.exit()) -
    // never an unbounded wait.
    await waitFor(() => !pidAlive(ctx.harness.pid), 5000);
    // A further short settle window for the killed children's own exit +
    // the tmux server's own kill-server teardown to complete.
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  registry.define(/^no supervisor, bridge, or bot process rooted in that fixture survives$/, (ctx) => {
    const { bridgePid, botPid, supervisorPid } = ctx.fixture;
    const survivors = [
      ['bridge', bridgePid],
      ['bot', botPid],
      ['supervisor', supervisorPid],
    ].filter(([, pid]) => pidAlive(pid));
    if (survivors.length > 0) {
      throw new Error(`expected zero survivors, got: ${JSON.stringify(survivors)}`);
    }
  });

  registry.define(/^no tmux server for that fixture's socket survives$/, (ctx) => {
    try {
      execFileSync('tmux', ['-S', ctx.fixture.tmuxSocket, 'list-sessions'], { stdio: 'ignore' });
      throw new Error(`expected no tmux server listening on ${ctx.fixture.tmuxSocket}, but list-sessions succeeded`);
    } catch (err) {
      // A non-zero exit from tmux itself (no server) is the expected,
      // passing outcome - only OUR OWN thrown Error above (a lingering
      // server) should propagate.
      if (err.message && err.message.startsWith('expected no tmux server')) {
        throw err;
      }
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });

  // ── fixture-process-leak-03 ──────────────────────────────────────────────
  registry.define(/^a live process is rooted in the running swarm socket directory \/tmp\/swarmforge-<uid>$/, (ctx) => {
    ctx.reapProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl458-project-'));
    ctx.reapRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl458-reap-root-'));
    ctx.socketRootDir = path.join(ctx.reapRoot, 'swarmforge-9999');
    fs.mkdirSync(ctx.socketRootDir);
    const oldTime = new Date(Date.now() - 48 * 3600 * 1000);
    fs.utimesSync(ctx.socketRootDir, oldTime, oldTime);
    ctx.socketRootChild = spawn('sleep', ['30'], { cwd: ctx.socketRootDir, stdio: 'ignore' });
  });

  registry.define(/^the orphan reaper runs$/, async (ctx) => {
    execFileSync('bb', [OPERATOR_RUNTIME, ctx.reapProjectRoot, '--tick-once'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        OPERATOR_SKIP_LAUNCH: '1',
        SWARMFORGE_FIXTURE_REAP_ROOT: ctx.reapRoot,
        SWARMFORGE_LEGACY_SOCKET_DIR: ctx.socketRootDir,
        SWARMFORGE_FIXTURE_REAP_STALE_HOURS: '1',
        // Isolates BL-413's own sweep, wired into the SAME tick - never
        // touches the real /tmp as a side effect of a scenario that is
        // only about the fixture reaper.
        SWARMFORGE_SANDBOX_SWEEP_ROOT: path.join(ctx.reapProjectRoot, '.no-sandbox-sweep'),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  registry.define(/^that process is left running regardless of its age$/, (ctx) => {
    try {
      if (!pidAlive(ctx.socketRootChild.pid)) {
        throw new Error('expected the process rooted in the live swarm socket directory to survive, but it was killed');
      }
      if (!fs.existsSync(ctx.socketRootDir)) {
        throw new Error('expected the live swarm socket directory itself to survive, but it was removed');
      }
    } finally {
      ctx.socketRootChild.kill('SIGKILL');
      fs.rmSync(ctx.reapProjectRoot, { recursive: true, force: true });
      fs.rmSync(ctx.reapRoot, { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
