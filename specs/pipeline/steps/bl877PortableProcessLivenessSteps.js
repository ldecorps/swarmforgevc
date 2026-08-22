'use strict';

// BL-877: step handlers for "Process liveness is detected on a host without
// /proc". Drives REAL operator_runtime.bb --tick-once subprocesses against
// private, disposable fixture directories - never the real /tmp (the
// engineering "LIVE shared runtime path" rule) - mirroring
// bl413StaleSandboxSweepSteps.js's own scenario-03 convention. A real child
// process is spawned and its cwd/open-fd rooting is genuinely exercised
// through whichever real facility this host has (lsof on this project's own
// macOS dev/CI host); scenario 04's "GNU" row additionally builds a
// synthetic /proc tree of real symlinks pointing at that SAME live child, so
// the procfs scanning branch is exercised end to end even though this host
// has no real /proc - see proc_fd_scan_lib.bb's SWARMFORGE_PROC_DIR.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OPERATOR_RUNTIME = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_runtime.bb');

const FEATURE_NAME = 'Process liveness is detected on a host without /proc';

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_ROOTING = { 'its working directory': 'cwd', 'an open file descriptor': 'fd' };
const KNOWN_USERLAND = { BSD: 'lsof', GNU: 'procfs' };

function knownRooting(value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_ROOTING, value)) {
    throw new Error(`portable-process-liveness: unrecognized <rooting> example value "${value}"`);
  }
  return KNOWN_ROOTING[value];
}

function knownUserland(value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_USERLAND, value)) {
    throw new Error(`portable-process-liveness: unrecognized <userland> example value "${value}"`);
  }
  return KNOWN_USERLAND[value];
}

// NOT detached/unref'd: this test process stays this child's real parent
// for its whole life. A detached+unref'd child that a SIBLING process
// (the bb reaper) SIGKILLs becomes a zombie until ITS real parent reaps it
// - `kill(pid, 0)` still finds a zombie's pid entry, so an isAlive() check
// against a disowned child cannot tell "genuinely still running" from
// "killed but not yet reaped", and reads as a false "still alive".
function spawnLiveChild(cwd) {
  const child = spawn('sleep', ['30'], { cwd, stdio: 'ignore' });
  return child.pid;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killAll(pids) {
  for (const pid of pids || []) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

// Builds a synthetic /proc/<pid> tree of REAL symlinks pointing at `pid`'s
// actual cwd/open-file, so procfs-lib's own real scanning code (fs/list-dir,
// fs/real-path) runs unmodified against it - never a second reimplementation
// of what counts as "rooted in" for the test.
function buildFakeProcEntry(pid, { cwdTarget, fdTarget }) {
  const fakeProc = fs.mkdtempSync(path.join(os.tmpdir(), 'bl877-fakeproc-'));
  const pidDir = path.join(fakeProc, String(pid));
  fs.mkdirSync(path.join(pidDir, 'fd'), { recursive: true });
  fs.symlinkSync(cwdTarget, path.join(pidDir, 'cwd'));
  if (fdTarget) {
    fs.symlinkSync(fdTarget, path.join(pidDir, 'fd', '3'));
  }
  return fakeProc;
}

function rootLiveProcessIn(ctx, targetDir, mode) {
  if (ctx.forceUserland === 'procfs') {
    const holdingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl877-holder-'));
    const pid = spawnLiveChild(holdingDir);
    ctx.children.push(pid);
    let fakeProc;
    if (mode === 'fd') {
      const openFile = path.join(targetDir, 'held.log');
      fs.writeFileSync(openFile, 'placeholder');
      fakeProc = buildFakeProcEntry(pid, { cwdTarget: holdingDir, fdTarget: openFile });
    } else {
      fakeProc = buildFakeProcEntry(pid, { cwdTarget: targetDir });
    }
    ctx.env.SWARMFORGE_PROC_DIR = fakeProc;
    ctx.fakeProcDirs.push(fakeProc, holdingDir);
    return;
  }
  if (mode === 'fd') {
    const holdingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl877-holder-'));
    const openFile = path.join(targetDir, 'held.log');
    fs.writeFileSync(openFile, 'placeholder');
    // cwd sits elsewhere (holdingDir); tail -f keeps openFile's fd held -
    // the architect-bounce "open fd, cwd elsewhere" shape BL-413's own
    // sibling test already covers directly for the procfs branch. Not
    // detached/unref'd - see spawnLiveChild's own comment on why.
    const child = spawn('tail', ['-f', openFile], { cwd: holdingDir, stdio: 'ignore' });
    ctx.children.push(child.pid);
  } else {
    ctx.children.push(spawnLiveChild(targetDir));
  }
}

function runTick(ctx, extraEnv) {
  execFileSync('bb', [OPERATOR_RUNTIME, ctx.projectRoot, '--tick-once'], {
    encoding: 'utf8',
    env: { ...ctx.env, ...extraEnv },
  });
}

function runSandboxSweep(ctx) {
  runTick(ctx, {
    OPERATOR_SKIP_LAUNCH: '1',
    SWARMFORGE_SANDBOX_SWEEP_ROOT: ctx.sandboxRoot,
    SWARMFORGE_SANDBOX_STALE_HOURS: '1',
    SWARMFORGE_FIXTURE_REAP_ROOT: path.join(ctx.projectRoot, '.no-fixture-reap'),
    SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS: '',
  });
}

function runFixtureReaperSweep(ctx) {
  runTick(ctx, {
    OPERATOR_SKIP_LAUNCH: '1',
    SWARMFORGE_SANDBOX_SWEEP_ROOT: path.join(ctx.projectRoot, '.no-sandbox-sweep'),
    SWARMFORGE_FIXTURE_REAP_ROOT: ctx.fixtureReapRoot,
    SWARMFORGE_FIXTURE_REAP_STALE_HOURS: '1',
    SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS: '',
  });
}

function cleanupFixtures(ctx) {
  killAll(ctx.children);
  for (const dir of [ctx.projectRoot, ctx.sandboxRoot, ctx.fixtureReapRoot, ...ctx.fakeProcDirs]) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the sweeps are pointed at a private fixture root, never the real \/tmp$/,
    (ctx) => {
      ctx.projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl877-project-'));
      ctx.sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl877-sandbox-'));
      ctx.fixtureReapRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl877-fixture-'));
      ctx.children = [];
      ctx.fakeProcDirs = [];
      ctx.env = { ...process.env };
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^every candidate directory in it is older than the staleness threshold$/,
    () => {
      // Marker only - staleness is applied per-directory when each is
      // created below, via an mtime older than the 1-hour threshold the
      // sweeps are pointed at.
    },
    FEATURE_NAME
  );

  // ── portable-process-liveness-01/04/05 shared Givens ────────────────────
  registry.defineScoped(
    /^a stale sandbox directory$/,
    (ctx) => {
      ctx.entryPath = path.join(ctx.sandboxRoot, 'sfvc-stale');
      fs.mkdirSync(ctx.entryPath);
      const old = new Date(Date.now() - 3 * 3600 * 1000);
      fs.utimesSync(ctx.entryPath, old, old);
    },
    FEATURE_NAME
  );

  // ── portable-process-liveness-03 ─────────────────────────────────────
  registry.defineScoped(
    /^a stale fixture root$/,
    (ctx) => {
      ctx.entryPath = path.join(ctx.fixtureReapRoot, 'aps-stale');
      fs.mkdirSync(ctx.entryPath);
      const old = new Date(Date.now() - 3 * 3600 * 1000);
      fs.utimesSync(ctx.entryPath, old, old);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a live process rooted in it by (.+)$/,
    (ctx, rooting) => rootLiveProcessIn(ctx, ctx.entryPath, knownRooting(rooting)),
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a live process rooted in it$/,
    (ctx) => rootLiveProcessIn(ctx, ctx.entryPath, 'cwd'),
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no live process rooted in it$/,
    () => {
      // Nothing to spawn - the entry stays genuinely unrooted.
    },
    FEATURE_NAME
  );

  // ── portable-process-liveness-04 ─────────────────────────────────────
  registry.defineScoped(
    /^a host running the (.+) userland$/,
    (ctx, userland) => {
      ctx.forceUserland = knownUserland(userland);
    },
    FEATURE_NAME
  );

  // ── portable-process-liveness-05 ─────────────────────────────────────
  registry.defineScoped(
    /^a host on which no liveness facility can be reached$/,
    (ctx) => {
      // /proc is already absent on this project's own macOS dev/CI host -
      // only lsof needs forcing unavailable to reproduce "neither facility
      // reachable" (proc_fd_scan_lib.bb's SWARMFORGE_LSOF_BIN override).
      ctx.env.SWARMFORGE_LSOF_BIN = '/nonexistent/path/to/lsof-bl877-acceptance';
    },
    FEATURE_NAME
  );

  // ── When ──────────────────────────────────────────────────────────────
  registry.defineScoped(/^the sandbox sweep runs$/, (ctx) => runSandboxSweep(ctx), FEATURE_NAME);
  registry.defineScoped(/^the fixture reaper sweep runs$/, (ctx) => runFixtureReaperSweep(ctx), FEATURE_NAME);

  // ── Then ──────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the sandbox directory still exists$/,
    (ctx) => {
      try {
        if (!fs.existsSync(ctx.entryPath)) {
          throw new Error(`expected ${ctx.entryPath} to still exist (a live process is rooted in it)`);
        }
      } finally {
        cleanupFixtures(ctx);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the sandbox directory is removed$/,
    (ctx) => {
      try {
        if (fs.existsSync(ctx.entryPath)) {
          throw new Error(`expected ${ctx.entryPath} to have been removed (nothing live is rooted in it)`);
        }
      } finally {
        cleanupFixtures(ctx);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the process is no longer running$/,
    async (ctx) => {
      // execFileSync (runTick, above) is synchronous - this test's own
      // Node event loop has not ticked since the reaper's SIGKILL was
      // sent, so libuv has not yet processed this real child's SIGCHLD and
      // reaped its zombie entry. kill(pid, 0) still finds a zombie (its
      // pid slot is not freed until reaped), reading as a false "still
      // alive" otherwise - yielding lets Node's own reaping catch up.
      await new Promise((resolve) => setImmediate(resolve));
      const stillAlive = ctx.children.filter(isAlive);
      // Safety net, not the assertion itself: if the reaper failed to kill
      // it, this test must not leak a runaway `sleep 30` regardless.
      killAll(stillAlive);
      if (stillAlive.length > 0) {
        throw new Error(`expected the process rooted in the reaped fixture root to have been killed, pid(s) still alive: ${stillAlive.join(', ')}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the fixture root is removed$/,
    (ctx) => {
      try {
        if (fs.existsSync(ctx.entryPath)) {
          throw new Error(`expected ${ctx.entryPath} to have been removed`);
        }
      } finally {
        cleanupFixtures(ctx);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the sweep records that liveness could not be determined$/,
    (ctx) => {
      const logFile = path.join(ctx.projectRoot, '.swarmforge', 'operator', 'runtime.log');
      const content = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
      if (!content.includes('liveness could not be determined this pass')) {
        throw new Error(`expected runtime.log to record that liveness could not be determined, got:\n${content}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
