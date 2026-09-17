'use strict';

// BL-420: the SHARED temp-dir helper every extension test allocates its
// os.tmpdir() mkdtemp root through, so cleanup happens exactly once, in one
// place, on both the pass and throw paths - not ~147 hand-rolled variants.
// mkTmpDir only creates and records; sweepPendingTmpDirs (called from a
// Vitest afterEach registered by tmpDirSetup.js, wired into
// vitest.config.mjs's test.setupFiles) does the actual removal. Split this
// way so a unit test can drive the sweep directly without needing a real
// Vitest afterEach cycle to observe it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pending = [];
let pendingShared = [];

// BL-1623: a pid still in the process table is not necessarily a running
// peer. SIGKILL a process whose parent has not reaped it yet and it becomes
// a ZOMBIE: the process is dead, but its entry lingers so `kill(pid, 0)`
// still succeeds. macOS and Linux both report 'Z' here (the only two target
// platforms); anything else, including a failed `ps`, is read as alive so
// the sweep errs toward keeping a root it is unsure about. The single copy
// of this probe - propertyLaneFixtureRunner.js's sweepStaleFixtures reuses
// it from here rather than carrying its own (BL-984's original copy).
function isZombiePid(pid) {
  const probe = spawnSync('ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' });
  return probe.status === 0 && /^\s*Z/.test(probe.stdout || '');
}

function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch (err) {
    // EPERM: the pid exists but belongs to another user - alive.
    return err.code === 'EPERM';
  }
  return !isZombiePid(pid);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// BL-1287's fixture-tunnel rule and BL-984's sweepStaleFixtures, applied to
// TEMP ROOTS: a blind `readdirSync(os.tmpdir())` sweep that removes every
// entry sharing a prefix destroys a live peer's fixtures the instant two
// runs of the same file are ever alive at once on the host (BL-1385/BL-1390's
// shape - a concurrent lane, a guard re-run, a solo re-run). A caller that
// builds its roots as `${prefix}${process.pid}-...` and sweeps through this
// helper instead removes a root only when the pid its own name records is
// gone (or is this process's own, before it has written one) - a live
// peer's roots are never touched, and a run that died without trapping
// anything still has its roots cleared by the next run's sweep. `dir`
// defaults to the real os.tmpdir() but is injectable so this helper's own
// tests never touch it.
function sweepStaleTmpDirs({ prefix, dir = os.tmpdir(), isPidAlive = defaultIsPidAlive } = {}) {
  const ownedName = new RegExp(`^${escapeRegExp(prefix)}(\\d+)-`);
  const removed = [];
  for (const name of fs.readdirSync(dir)) {
    const match = ownedName.exec(name);
    if (!match) {
      continue;
    }
    const ownerPid = Number(match[1]);
    if (ownerPid === process.pid || !isPidAlive(ownerPid)) {
      const fullPath = path.join(dir, name);
      fs.rmSync(fullPath, { recursive: true, force: true });
      removed.push(fullPath);
    }
  }
  return removed;
}

// Creates a real mkdtemp dir under os.tmpdir() with the given prefix
// (preserves every existing naming convention - sfvc-/relay-/negotiate-/etc -
// callers pass their own prefix unchanged) and records it for the next
// PER-TEST sweep (tmpDirSetup.js's afterEach). Never removes anything
// itself - a test that wants EARLY removal (before its own teardown) still
// calls fs.rmSync directly; sweepPendingTmpDirs tolerates an already-gone
// path either way.
function mkTmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  pending.push(dir);
  return dir;
}

// The beforeAll sibling of mkTmpDir: a dir built ONCE and reused (read-only
// or copy-from) across every test in a file - registered for a per-FILE
// afterAll sweep instead, so it survives until every test in the file has
// run rather than being destroyed after the first one. Use this, never
// mkTmpDir, for a dir created inside beforeAll and referenced from multiple
// tests (the PREPARED_ROOT convention negotiateOnboardingContractCli.test.js
// and relayOnboardingNegotiationTelegramCli.test.js both use).
function mkSharedTmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  pendingShared.push(dir);
  return dir;
}

// The PROCESS-lifetime sibling of the two above, for a dir that must outlive
// both sweeps this module offers. mkTmpDir's afterEach and mkSharedTmpDir's
// afterAll are both too short for a cache seeded once and reused across FILES:
// with `isolate: false` the unit lane runs its files in one process, so an
// afterAll sweep re-pays the seeding cost in the next file that asks
// (BL-1039's shared git-repo template is the case this exists for - it seeds a
// repository with real git spawns and hands out fs.cpSync copies).
//
// It is still never leaked: removal is registered on process exit rather than
// on a test hook, so nothing outlives the run. Kept HERE, in the module that
// owns temp-dir policy, so callers need no raw mkdtemp of their own and
// rawMkdtempGuard's exempt list stays exactly the three documented paths.
function mkProcessTmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.once('exit', () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort at exit - a leaked temp dir is not a test failure */
    }
  });
  return dir;
}

// Removes every path handed out via mkTmpDir since the last sweep and
// returns them (mainly for the helper's own tests to assert against).
// force:true tolerates a path already removed (by the test itself, or a
// prior sweep) rather than throwing mid-teardown.
function sweepPendingTmpDirs() {
  const dirs = pending;
  pending = [];
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return dirs;
}

// The afterAll sweep for mkSharedTmpDir's own registry - same tolerant
// removal, separate list, so a per-test afterEach can never race it away
// early.
function sweepSharedTmpDirs() {
  const dirs = pendingShared;
  pendingShared = [];
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return dirs;
}

module.exports = {
  mkTmpDir,
  mkSharedTmpDir,
  mkProcessTmpDir,
  sweepPendingTmpDirs,
  sweepSharedTmpDirs,
  sweepStaleTmpDirs,
  defaultIsPidAlive,
};
