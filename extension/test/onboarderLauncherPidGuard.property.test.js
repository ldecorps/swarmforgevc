const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-684 invariant 2 (property authorship rests with the coder, first pass -
// BL-654): "The rename can never produce two live supervisors nor a stale
// heartbeat read as live: with a pre-rename supervisor still holding its
// old-named pid file, the new launcher declines to start... and never
// adopts, kills or migrates that process." This drives the REAL
// launch_onboarder.sh against a real filesystem fixture for every generated
// old-pid-file content - never a mocked pid-alive check, since the whole
// point of the invariant is what the launcher does when handed a REAL
// process table to consult.
//
// Generator reach: the domain deliberately excludes numeric strings whose
// value is 0 and all-digit strings 8+ digits long. Both are real, but
// UNRELATED to this rename - bash's own `kill -0 0` signals the caller's
// entire process group (a pre-existing quirk shared by every kill-0-based
// guard already in this codebase, e.g. signal_pid_file), and pid_t
// overflows on very long digit strings (`kill` itself rejects them as "not
// a process or job ID") - neither depends on which name the pid file has,
// so fuzzing them would test bash's kill(1), not this ticket's invariant.
// What the generator MUST reach, and does: a genuinely LIVE pid (a real
// spawned process), a genuinely DEAD pid (a real process that already
// exited), and arbitrary non-numeric garbage (whitespace, unicode, empty,
// near-numeric-looking text) - the three states the invariant's own
// Scenario 3/5 examples name.
const REPO_ROOT = path.join(__dirname, '..', '..');
const LAUNCHER_SRC = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'launch_onboarder.sh');
const SUPERVISOR_SRC = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'onboarder_supervisor.bb');
const LIB_SRCS = ['front_desk_supervisor_lib.bb', 'swarm_identity_lib.bb', 'fleet_telegram_creds_lib.bb'].map((f) =>
  path.join(REPO_ROOT, 'swarmforge', 'scripts', f)
);

function makeFixture() {
  const dir = mkTmpDir('bl684-launcher-prop-');
  const scriptsDir = path.join(dir, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'extension', 'out', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.swarmforge', 'operator'), { recursive: true });
  fs.copyFileSync(LAUNCHER_SRC, path.join(scriptsDir, 'launch_onboarder.sh'));
  fs.chmodSync(path.join(scriptsDir, 'launch_onboarder.sh'), 0o755);
  fs.copyFileSync(SUPERVISOR_SRC, path.join(scriptsDir, 'onboarder_supervisor.bb'));
  for (const lib of LIB_SRCS) {
    fs.copyFileSync(lib, path.join(scriptsDir, path.basename(lib)));
  }
  // Empty but present - the launcher only checks -f; an empty script exits
  // immediately once spawned by the real supervisor, keeping "proceeds"
  // runs fast.
  fs.writeFileSync(path.join(dir, 'extension', 'out', 'tools', 'onboarder-reconcile.js'), '');
  return dir;
}

function oldPidFile(dir) {
  return path.join(dir, '.swarmforge', 'operator', 'onboarding-facilitator-supervisor.pid');
}
function newPidFile(dir) {
  return path.join(dir, '.swarmforge', 'operator', 'onboarder-supervisor.pid');
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The invariant's own decision predicate, independently derived from the
// Given/Then text (Scenario 3/5) - never copied from launch_onboarder.sh's
// source, or this would test nothing.
function oracleConsidersOldPidLive(content) {
  return /^[0-9]+$/.test(content) && content !== '0' && isAlive(Number(content));
}

function spawnDeadPid() {
  const child = spawnSync('sh', ['-c', 'exit 0']);
  // A just-exited child's pid is guaranteed reaped/unused by spawnSync's
  // own synchronous wait - safe to reuse as a "definitely not alive" pid.
  return child.pid;
}

function cleanupFixture(dir, liveChild) {
  const stopFile = path.join(dir, '.swarmforge', 'operator', 'onboarder-supervisor.stop');
  fs.writeFileSync(stopFile, '');
  if (fs.existsSync(newPidFile(dir))) {
    const pid = Number(fs.readFileSync(newPidFile(dir), 'utf8').trim());
    if (Number.isInteger(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
  if (liveChild) {
    try {
      liveChild.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

const nonZeroSmallNumeric = fc
  .integer({ min: 1, max: 999999 })
  .map((n) => String(n))
  .filter((s) => !isAlive(Number(s)));

const oldPidFileContentArb = fc.oneof(
  { weight: 3, arbitrary: fc.constant('__LIVE__') },
  { weight: 2, arbitrary: fc.constant('__DEAD__') },
  { weight: 2, arbitrary: nonZeroSmallNumeric },
  {
    weight: 3,
    arbitrary: fc
      .string({ maxLength: 24 })
      .filter((s) => !(/^[0-9]+$/.test(s) && (s === '0' || s.length >= 8)))
  }
);

test('property: launch_onboarder.sh declines to start iff the old-named pid file holds a genuinely live numeric pid', () => {
  fc.assert(
    fc.property(oldPidFileContentArb, (spec) => {
      const dir = makeFixture();
      let liveChild;
      try {
        let content = spec;
        let expectedLive;
        if (spec === '__LIVE__') {
          liveChild = spawn('sleep', ['5']);
          content = String(liveChild.pid);
          expectedLive = true;
        } else if (spec === '__DEAD__') {
          content = String(spawnDeadPid());
          expectedLive = false;
        } else {
          expectedLive = oracleConsidersOldPidLive(content);
        }
        fs.writeFileSync(oldPidFile(dir), content);

        const result = spawnSync('bash', [path.join(dir, 'swarmforge', 'scripts', 'launch_onboarder.sh'), dir], {
          encoding: 'utf8',
          timeout: 15000,
        });

        if (expectedLive) {
          assert.equal(result.status, 0, `expected exit 0 (decline), got ${result.status}: ${result.stderr}`);
          assert.match(result.stderr, /pre-rename supervisor is already running/);
          assert.equal(fs.existsSync(newPidFile(dir)), false, 'must never start a second (new-named) supervisor');
        } else {
          assert.doesNotMatch(
            result.stderr,
            /pre-rename supervisor is already running/,
            `must not decline for a non-live old pid file content ${JSON.stringify(content)}: ${result.stderr}`
          );
        }
      } finally {
        cleanupFixture(dir, liveChild);
      }
    }),
    { numRuns: 15 }
  );
});
