'use strict';

// BL-886: step handlers for "BL-886 stamp: property-lane vitest
// crash-orphan reaping across supervisor, janitor, and fixture runner".
// Review-stamp of human-landed commits 602c7d014 (handoffd_supervisor.bb)
// and 1ecbe049f (orphan_janitor_lib.bb / orphan_janitor_sweep_lib.bb /
// propertyLaneFixtureRunner.js).
//
// Scenarios 01-03 (supervisor) drive REAL spawned processes through the
// actual `bb handoffd_supervisor.bb --check-once` CLI via
// lib/bl886SupervisorFixture.js - it self-executes (-main) on load, so it
// cannot be load-file'd for a JSON bridge the way the janitor library can.
// Scenarios 04-05 (janitor) drive the REAL orphan-janitor-sweep-lib/sweep!
// wiring via bl886_vitest_orphan_reaper_acceptance_runner.bb's JSON bridge,
// same pattern as bl849/bl879. Scenarios 06-07 (fixture runner) drive the
// REAL propertyLaneFixtureRunner.js module in a real child process - same
// spawn+poll-stdout convention bl458AcceptanceFixtureProcessLeakSteps.js
// already established for abnormal-exit coverage.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const supervisorFixture = require('./lib/bl886SupervisorFixture');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const JANITOR_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl886_vitest_orphan_reaper_acceptance_runner.bb');
const FIXTURE_RUNNER_MODULE = path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'propertyLaneFixtureRunner.js');
const FIXTURE_RUNNER_TEST_DIR = path.join(REPO_ROOT, 'extension', 'test');

const FEATURE_NAME =
  'BL-886 stamp: property-lane vitest crash-orphan reaping across supervisor, janitor, and fixture runner';

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

// ── janitor-side JSON bridge (scenarios 04/05) ──────────────────────────
function runJanitor(subcommand, payload, env) {
  const out = execFileSync('bb', [JANITOR_RUNNER, subcommand, JSON.stringify(payload || {})], {
    encoding: 'utf8',
    env: env || process.env,
  });
  return JSON.parse(out);
}

const KNOWN_PARENT_STATES_JANITOR = { gone: 'gone', alive: 'alive' };
const KNOWN_AGES = { younger: 1000, older: 999999999 };
const KNOWN_OUTCOMES_JANITOR = { 'is reaped': true, survives: false };

const CMDLINE_SHAPES = {
  'npm exec vitest run --config vitest.properties.config.mjs':
    'npm exec vitest run --config vitest.properties.config.mjs',
  'npx vitest run --config vitest.properties.config.mjs': 'npx vitest run --config vitest.properties.config.mjs',
  'node (vitest 3) worker': 'node (vitest 3) worker',
};

// ── fixture-runner child scripts (scenarios 06/07) ──────────────────────
// scenario 06: runManyAsPropertyLaneFixtures' write loop (multiple sources
// tracked + written) runs BEFORE its own try/finally - passing a non-string
// second source makes fs.writeFileSync throw there, so the function never
// reaches its finally at all. The first file is left tracked and on disk;
// only the module's exit-family signal handler can still remove it. This
// is a genuinely non-vacuous window (verified by hand at authoring time:
// commenting out installAbnormalExitHandlersOnce's process.on(...) calls
// leaves the file on disk after this same test - restored before commit),
// unlike signalling the process while it is blocked inside a real vitest
// spawnSync: Node defers ALL queued signal callbacks until a blocking
// spawnSync call returns, so a signal sent mid-run can never preempt that
// call's own (synchronous, same-frame) finally block - confirmed
// empirically against this Node runtime before choosing this design.
function sigtermChildSource() {
  return [
    "'use strict';",
    'const fs = require("node:fs");',
    'const [, , runnerPath, prefix, readyFile, testDir] = process.argv;',
    'const { runManyAsPropertyLaneFixtures } = require(runnerPath);',
    'try {',
    '  runManyAsPropertyLaneFixtures(["module.exports = 1;\\n", 42], { basenamePrefix: prefix, timeout: 5000 });',
    '  fs.writeFileSync(readyFile, JSON.stringify({ ok: false, reason: "expected-throw-did-not-happen" }));',
    '  process.exit(2);',
    '} catch (e) {',
    '  if (e.code !== "ERR_INVALID_ARG_TYPE") {',
    '    fs.writeFileSync(readyFile, JSON.stringify({ ok: false, reason: "unexpected-error:" + (e && e.message) }));',
    '    process.exit(3);',
    '  }',
    '}',
    'const leftover = fs.readdirSync(testDir).filter((f) => f.startsWith(prefix));',
    'fs.writeFileSync(readyFile, JSON.stringify({ ok: true, leftover }));',
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n');
}

async function runSigtermFixture() {
  const prefix = `bl886sigterm${process.pid}${Date.now()}`;
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl886-sigterm-child-'));
  const readyFile = path.join(scratchDir, 'ready.json');
  const childScript = path.join(scratchDir, 'child.js');
  fs.writeFileSync(childScript, sigtermChildSource());
  const child = spawn(process.execPath, [childScript, FIXTURE_RUNNER_MODULE, prefix, readyFile, FIXTURE_RUNNER_TEST_DIR], {
    stdio: 'ignore',
  });
  const gotReady = await waitFor(() => fs.existsSync(readyFile), 10000);
  if (!gotReady) {
    child.kill('SIGKILL');
    fs.rmSync(scratchDir, { recursive: true, force: true });
    throw new Error('bl886 scenario 06: child never became ready');
  }
  const readyState = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
  if (!readyState.ok) {
    child.kill('SIGKILL');
    fs.rmSync(scratchDir, { recursive: true, force: true });
    throw new Error(`bl886 scenario 06 setup failed: ${readyState.reason}`);
  }
  child.kill('SIGTERM');
  // Poll the filesystem directly for the leftover file(s) to disappear -
  // independent of whether THIS (parent) process's own event loop ever
  // notices the child's exit.
  let remaining = readyState.leftover;
  await waitFor(() => {
    remaining = readyState.leftover.filter((f) => fs.existsSync(path.join(FIXTURE_RUNNER_TEST_DIR, f)));
    return remaining.length === 0;
  }, 5000);
  child.kill('SIGKILL');
  fs.rmSync(scratchDir, { recursive: true, force: true });
  return { remaining };
}

// scenario 07: two throwing calls (source=42, same early-throw as above)
// still call trackFixturePath before the write fails, which is what
// installs the exit-family handlers - a fast, deterministic way to prove
// the install-once guard without needing two real vitest runs.
function listenerGuardChildSource() {
  return [
    "'use strict';",
    'const fs = require("node:fs");',
    'const [, , runnerPath, resultFile] = process.argv;',
    'const { runAsPropertyLaneFixture } = require(runnerPath);',
    'let caught = 0;',
    'for (let i = 0; i < 2; i++) {',
    '  try {',
    '    runAsPropertyLaneFixture(42, {});',
    '  } catch (e) {',
    '    if (e.code === "ERR_INVALID_ARG_TYPE") caught++;',
    '  }',
    '}',
    'let maxListenersWarning = null;',
    'process.on("warning", (w) => {',
    '  if (w.name === "MaxListenersExceededWarning") maxListenersWarning = w.message;',
    '});',
    'const result = {',
    '  callsCaught: caught,',
    '  exitListenerCount: process.listenerCount("exit"),',
    '  sigintListenerCount: process.listenerCount("SIGINT"),',
    '  sigtermListenerCount: process.listenerCount("SIGTERM"),',
    '  maxListenersWarning,',
    '};',
    'fs.writeFileSync(resultFile, JSON.stringify(result));',
    '',
  ].join('\n');
}

function runListenerGuardFixture() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl886-listener-guard-'));
  const resultFile = path.join(scratchDir, 'result.json');
  const childScript = path.join(scratchDir, 'child.js');
  fs.writeFileSync(childScript, listenerGuardChildSource());
  const res = require('node:child_process').spawnSync(process.execPath, [childScript, FIXTURE_RUNNER_MODULE, resultFile], {
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    throw new Error(`bl886 scenario 07 child failed (status ${res.status}): ${res.stderr}`);
  }
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  fs.rmSync(scratchDir, { recursive: true, force: true });
  if (result.callsCaught !== 2) {
    throw new Error(`bl886 scenario 07: expected both calls to throw ERR_INVALID_ARG_TYPE, caught ${result.callsCaught}`);
  }
  return result;
}

function registerSteps(registry) {
  // ── vitest-orphan-reaper-stamp-01 (Scenario Outline) ────────────────
  registry.defineScoped(
    /^a process group whose root cmdline is "(.+)" and whose cwd is under a registered worktree$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(CMDLINE_SHAPES, raw)) {
        throw new Error(`bl886: unrecognized <cmdline> example value "${raw}"`);
      }
      ctx.fixture = supervisorFixture.makeFixtureRoot();
      ctx.cmdline = CMDLINE_SHAPES[raw];
      ctx.cwd = path.join(ctx.fixture.coderWt, 'extension');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the group's parent process is gone$/,
    async (ctx) => {
      ctx.proc = await supervisorFixture.spawnOrphanFixture({ cwd: ctx.cwd, cmdline: ctx.cmdline });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the supervisor's orphaned-job sweep runs$/,
    (ctx) => {
      supervisorFixture.checkOnce(ctx.fixture.root, ctx.fixture.binDir);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the group is reaped$/,
    (ctx) => {
      const alive = supervisorFixture.pidAlive(ctx.proc.pid);
      supervisorFixture.killFixture(ctx.proc.pid);
      supervisorFixture.cleanupFixtureRoot(ctx.fixture);
      if (alive) {
        throw new Error(`expected pid ${ctx.proc.pid} (${ctx.cmdline}) to be reaped, but it is still alive`);
      }
    },
    FEATURE_NAME
  );

  // ── vitest-orphan-reaper-stamp-02 ───────────────────────────────────
  registry.defineScoped(
    /^a property-lane vitest group whose parent process is alive$/,
    (ctx) => {
      ctx.fixture = supervisorFixture.makeFixtureRoot();
      ctx.cwd = path.join(ctx.fixture.coderWt, 'extension');
      ctx.cmdline = CMDLINE_SHAPES['npm exec vitest run --config vitest.properties.config.mjs'];
      ctx.proc = supervisorFixture.spawnOwnedFixture({ cwd: ctx.cwd, cmdline: ctx.cmdline });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the group has been running longer than every stale threshold$/,
    () => {
      // reap-orphaned-job-processes! has no duration/age concept anywhere in
      // its filter chain (unlike the janitor's stale? gate) - orphanhood is
      // structurally its only trigger, so there is no threshold to actually
      // wait out here. "the group survives" below is the real proof; a
      // multi-hour real wait would not exercise any code path this
      // function does not already ignore.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the group survives$/,
    (ctx) => {
      const alive = supervisorFixture.pidAlive(ctx.proc.pid);
      supervisorFixture.killFixture(ctx.proc.pid);
      supervisorFixture.cleanupFixtureRoot(ctx.fixture);
      if (!alive) {
        throw new Error(`expected pid ${ctx.proc.pid} (${ctx.cmdline}) to survive the sweep, but it was reaped`);
      }
    },
    FEATURE_NAME
  );

  // ── vitest-orphan-reaper-stamp-03 ───────────────────────────────────
  registry.defineScoped(
    /^a parent-orphaned vitest group whose cmdline and cwd are both outside the host root and every registered worktree$/,
    async (ctx) => {
      ctx.fixture = supervisorFixture.makeFixtureRoot();
      // Deliberately NOT under fixture.root or fixture.coderWt - an
      // unrelated tmp dir, and a cmdline shape with no embedded path at
      // all, so job-in-scope?'s cmd-substring leg and cwd-prefix leg both
      // fail by construction.
      ctx.cwd = supervisorFixture.mkTmp('bl886-out-of-scope-');
      ctx.cmdline = CMDLINE_SHAPES['npx vitest run --config vitest.properties.config.mjs'];
      ctx.proc = await supervisorFixture.spawnOrphanFixture({ cwd: ctx.cwd, cmdline: ctx.cmdline });
    },
    FEATURE_NAME
  );

  // ── vitest-orphan-reaper-stamp-04 (Scenario Outline) ────────────────
  registry.defineScoped(
    /^a project-scoped hung vitest tree whose parent is (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_PARENT_STATES_JANITOR, raw)) {
        throw new Error(`bl886: unrecognized <parent-state> example value "${raw}"`);
      }
      ctx.parentState = KNOWN_PARENT_STATES_JANITOR[raw];
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^its age relative to the vitest stale threshold is (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_AGES, raw)) {
        throw new Error(`bl886: unrecognized <age> example value "${raw}"`);
      }
      ctx.ageMs = KNOWN_AGES[raw];
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the janitor sweep runs$/,
    (ctx) => {
      const env = ctx.envOverrideHours
        ? { ...process.env, SWARMFORGE_ORPHAN_JANITOR_VITEST_STALE_HOURS: String(ctx.envOverrideHours) }
        : undefined;
      ctx.sweepResult = runJanitor('sweep-one-vitest', { ageMs: ctx.ageMs, parentState: ctx.parentState }, env);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the tree (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_OUTCOMES_JANITOR, raw)) {
        throw new Error(`bl886: unrecognized <outcome> example value "${raw}"`);
      }
      const expectedReaped = KNOWN_OUTCOMES_JANITOR[raw];
      if (ctx.sweepResult.reaped !== expectedReaped) {
        throw new Error(`expected reaped=${expectedReaped} for "${raw}", got: ${JSON.stringify(ctx.sweepResult)}`);
      }
    },
    FEATURE_NAME
  );

  // ── vitest-orphan-reaper-stamp-05 ───────────────────────────────────
  registry.defineScoped(
    /^SWARMFORGE_ORPHAN_JANITOR_VITEST_STALE_HOURS is set to a custom value$/,
    (ctx) => {
      // Deliberately much lower than the 2.0h default so a "reaped" result
      // can only be explained by the override actually being read at sweep
      // time, never by the default threshold happening to also be exceeded.
      ctx.envOverrideHours = 0.0002777; // ~1 second
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a live-parented project-scoped hung vitest tree older than that custom threshold$/,
    (ctx) => {
      ctx.parentState = 'alive';
      ctx.ageMs = 2000; // 2s: older than the ~1s custom threshold, far younger than the 2h default
    },
    FEATURE_NAME
  );

  // ── vitest-orphan-reaper-stamp-06 ───────────────────────────────────
  registry.defineScoped(
    /^a property-lane fixture run that has generated fixture test files$/,
    () => {
      // Nothing to arrange - "the process receives SIGTERM..." below both
      // triggers the write and captures the leftover state.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the process receives SIGTERM before the run's finally block executes$/,
    async (ctx) => {
      ctx.result = await runSigtermFixture();
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no generated fixture file remains on disk$/,
    (ctx) => {
      if (ctx.result.remaining.length > 0) {
        throw new Error(`expected no generated fixture files to remain, found: ${JSON.stringify(ctx.result.remaining)}`);
      }
    },
    FEATURE_NAME
  );

  // ── vitest-orphan-reaper-stamp-07 ───────────────────────────────────
  registry.defineScoped(
    /^runAsPropertyLaneFixture completes twice within one process$/,
    (ctx) => {
      ctx.listenerResult = runListenerGuardFixture();
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the process exits$/,
    () => {
      // ctx.listenerResult already reflects the child process's exit-time
      // listener state, captured before it wrote its result file.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the cleanup handler fires exactly once$/,
    (ctx) => {
      if (ctx.listenerResult.exitListenerCount !== 1) {
        throw new Error(`expected exactly 1 'exit' listener (fires once per process exit), found ${ctx.listenerResult.exitListenerCount}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no listener accumulation warning is emitted$/,
    (ctx) => {
      if (ctx.listenerResult.maxListenersWarning) {
        throw new Error(`unexpected MaxListenersExceededWarning: ${ctx.listenerResult.maxListenersWarning}`);
      }
      if (ctx.listenerResult.sigintListenerCount !== 1 || ctx.listenerResult.sigtermListenerCount !== 1) {
        throw new Error(
          `expected exactly 1 SIGINT and 1 SIGTERM listener, found SIGINT=${ctx.listenerResult.sigintListenerCount} SIGTERM=${ctx.listenerResult.sigtermListenerCount}`
        );
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
