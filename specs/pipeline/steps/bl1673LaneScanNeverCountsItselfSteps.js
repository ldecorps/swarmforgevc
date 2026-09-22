'use strict';

// BL-1673: step handlers for "The lane scan never counts the process doing
// the scanning". Drives the REAL lane_process_lib.bb and the REAL
// handoffd.bb role-lane-running? through real bb subprocesses (both -e and
// file-based invocation shapes) - no reimplementation of the process-table
// scan or the self-exclusion logic. Scenario 03 runs the REAL
// extension/test/laneProcessLib.test.js file through vitest - the actual
// regression case, not a JS restatement of it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { afterEach } = require('node:test');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const LANE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'lane_process_lib.bb');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');

const FEATURE = 'BL-1673 The lane scan never counts the process doing the scanning';

let trackedChildren = [];

afterEach(() => {
  while (trackedChildren.length) {
    const child = trackedChildren.pop();
    if (child.pid) {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // already dead - fine
      }
    }
  }
});

// Root creation goes through fixtureReaper's trackedTmpRoot() (BL-1636's
// own standing unregistered-mkdtemp guard) - a bare fs.mkdtempSync here
// would leak the root on a thrown assertion or a killed run.
function mkRoot(prefix) {
  return trackedTmpRoot(prefix);
}

function laneRunningFormFor(worktree) {
  return `(load-file "${LANE_LIB}")\n(println (lane-process-lib/lane-running? "${worktree}"))`;
}

// argv naming the worktree literally, via -e's own form text.
function runLaneRunningViaE(worktree, extraArgs = []) {
  const args = ['-e', laneRunningFormFor(worktree)];
  if (extraArgs.length) {
    args.push('--', ...extraArgs);
  }
  return execFileSync('bb', args, { encoding: 'utf8' }).trim();
}

// argv naming nothing about the worktree - the form lives in a file.
function runLaneRunningViaFile(worktree) {
  const scriptFile = path.join(mkRoot('bl1673-script-'), 'probe.bb');
  fs.writeFileSync(scriptFile, laneRunningFormFor(worktree));
  return execFileSync('bb', [scriptFile], { encoding: 'utf8' }).trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  scoped(/^a fresh empty worktree directory under mkdtemp$/, (ctx) => {
    ctx.worktree = mkRoot('bl1673-worktree-');
  });

  // ── Scenario 01 ───────────────────────────────────────────────────────────
  scoped(/^lane-running\? is asked about the worktree by a bb process whose own argv (.+)$/, (ctx, argvShape) => {
    if (argvShape === 'names the worktree and carries no lane-pattern token') {
      ctx.printedOut = runLaneRunningViaE(ctx.worktree);
    } else if (argvShape === 'names the worktree and carries a .stryker-tmp/ path token') {
      ctx.printedOut = runLaneRunningViaE(ctx.worktree, ['/x/.stryker-tmp/sandbox-abc']);
    } else if (argvShape === 'names nothing while a run_acceptance.sh child runs with its cwd under the worktree') {
      const child = spawn('bash', ['-c', 'exec -a run_acceptance.sh sleep 30'], { cwd: ctx.worktree, stdio: 'ignore' });
      trackedChildren.push(child);
      execFileSync('sleep', ['0.3']);
      ctx.printedOut = runLaneRunningViaFile(ctx.worktree);
    } else {
      throw new Error(`unrecognized <argv> shape: ${argvShape}`);
    }
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────────
  scoped(
    /^handoffd's role-lane-running\? is probed for the worktree through a bb process whose argv carries a \.stryker-tmp\/ path token$/,
    (ctx) => {
      const script = `(load-file "${HANDOFFD}")\n(println (handoffd/role-lane-running? {:worktree-path "${ctx.worktree}"}))`;
      const scriptFile = path.join(mkRoot('bl1673-daemon-script-'), 'probe.bb');
      fs.writeFileSync(scriptFile, script);
      const root = mkRoot('bl1673-daemon-root-');
      // The daemon root argument (unrelated to ctx.worktree) plus a
      // trailing token simulating a Stryker sandbox's load-file path -
      // both on this probe's own argv, same shape as scenario 01's case 2.
      ctx.printedOut = execFileSync('bb', [scriptFile, root, '/x/.stryker-tmp/sandbox-abc'], {
        encoding: 'utf8',
        env: { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1' },
      }).trim();
    }
  );

  // ── Shared Then (both scenario 01 and 02 print true/false) ──────────────────
  scoped(/^it prints (true|false)$/, (ctx, verdict) => {
    assert.equal(ctx.printedOut, verdict, `expected the probe to print ${verdict}, got ${ctx.printedOut}`);
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────────
  scoped(/^the laneProcessLib unit test file runs$/, (ctx) => {
    // --reporter=verbose: the default reporter only prints an individual
    // test's own name for a "slow" one, collapsing fast passes into the
    // file-level summary count - unreliable for a by-name census pin.
    ctx.unitRun = spawnSync('npx', ['vitest', 'run', '--reporter=verbose', 'test/laneProcessLib.test.js'], {
      cwd: EXTENSION_DIR,
      encoding: 'utf8',
    });
  });

  scoped(/^it reports every test passed$/, (ctx) => {
    assert.equal(
      ctx.unitRun.status,
      0,
      `expected test/laneProcessLib.test.js to pass, exit ${ctx.unitRun.status}:\n${ctx.unitRun.stdout}\n${ctx.unitRun.stderr}`
    );
  });

  scoped(/^its passing tests include the scan never counts its own process$/, (ctx) => {
    const output = `${ctx.unitRun.stdout}${ctx.unitRun.stderr}`;
    assert.match(
      output,
      /^\s*✓.*the scan never counts its own process/m,
      `expected a passing "the scan never counts its own process" line in the unit run's output, got:\n${output}`
    );
  });
}

module.exports = { registerSteps };
