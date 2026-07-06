const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  recordTrackedJob,
  removeTrackedJob,
  readTrackedJobs,
  spawnTrackedJob,
  reapAllTrackedJobs,
  reapStaleTrackedJobs,
} = require('../out/swarm/childJobRegistry');

function mkTmpSwarmforgeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'child-job-registry-'));
}

test('recordTrackedJob persists an entry that readTrackedJobs returns', () => {
  const dir = mkTmpSwarmforgeDir();
  recordTrackedJob(dir, {
    pgid: 4242,
    worktree: 'hardener',
    kind: 'stryker',
    started_at: '2026-07-06T10:00:00.000Z',
    owner_host_pid: 99,
  });

  const entries = readTrackedJobs(dir);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].pgid, 4242);
  assert.equal(entries[0].worktree, 'hardener');
});

test('recordTrackedJob replaces an existing entry for the same pgid rather than duplicating it', () => {
  const dir = mkTmpSwarmforgeDir();
  recordTrackedJob(dir, { pgid: 4242, worktree: 'a', kind: 'stryker', started_at: 't1', owner_host_pid: 1 });

  recordTrackedJob(dir, { pgid: 4242, worktree: 'b', kind: 'vitest', started_at: 't2', owner_host_pid: 2 });

  const entries = readTrackedJobs(dir);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].worktree, 'b');
  assert.equal(entries[0].kind, 'vitest');
  assert.equal(entries[0].owner_host_pid, 2);
});

test('removeTrackedJob drops only the matching pgid entry', () => {
  const dir = mkTmpSwarmforgeDir();
  recordTrackedJob(dir, { pgid: 1, worktree: 'a', kind: 'x', started_at: 't', owner_host_pid: 1 });
  recordTrackedJob(dir, { pgid: 2, worktree: 'b', kind: 'y', started_at: 't', owner_host_pid: 1 });

  removeTrackedJob(dir, 1);

  const entries = readTrackedJobs(dir);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].pgid, 2);
});

test('readTrackedJobs returns an empty array when the registry file does not exist', () => {
  const dir = mkTmpSwarmforgeDir();
  assert.deepEqual(readTrackedJobs(dir), []);
});

test('readTrackedJobs returns an empty array for a corrupt registry file rather than throwing', () => {
  const dir = mkTmpSwarmforgeDir();
  fs.writeFileSync(path.join(dir, 'child-jobs.json'), 'not json{{{');
  assert.deepEqual(readTrackedJobs(dir), []);
});

function fakeChild(pid) {
  const listeners = {};
  return {
    pid,
    on(event, listener) {
      listeners[event] = listener;
    },
    triggerExit() {
      listeners['exit']?.();
    },
  };
}

test('spawnTrackedJob is a no-op on the registry when the spawn failed to produce a pid (e.g. ENOENT)', () => {
  const dir = mkTmpSwarmforgeDir();
  const child = fakeChild(undefined);

  const result = spawnTrackedJob(dir, () => child, { worktree: 'a', kind: 'x', ownerHostPid: 1 });

  assert.equal(result, child);
  assert.deepEqual(readTrackedJobs(dir), []);
});

test('spawn-registry-01: spawnTrackedJob records a registry entry for the spawned group leader', () => {
  const dir = mkTmpSwarmforgeDir();
  const child = fakeChild(5150);

  spawnTrackedJob(dir, () => child, { worktree: 'cleaner', kind: 'node-test', ownerHostPid: 777 });

  const entries = readTrackedJobs(dir);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].pgid, 5150);
  assert.equal(entries[0].worktree, 'cleaner');
  assert.equal(entries[0].kind, 'node-test');
  assert.equal(entries[0].owner_host_pid, 777);
  assert.equal(typeof entries[0].started_at, 'string');
});

test('spawn-registry-01: a clean exit removes the job\'s own registry entry', () => {
  const dir = mkTmpSwarmforgeDir();
  const child = fakeChild(6161);

  spawnTrackedJob(dir, () => child, { worktree: 'cleaner', kind: 'node-test', ownerHostPid: 777 });
  assert.equal(readTrackedJobs(dir).length, 1);

  child.triggerExit();

  assert.deepEqual(readTrackedJobs(dir), []);
});

test('spawn-registry-01: a clean exit removes only its own entry, leaving other tracked jobs', () => {
  const dir = mkTmpSwarmforgeDir();
  const childA = fakeChild(1);
  const childB = fakeChild(2);

  spawnTrackedJob(dir, () => childA, { worktree: 'a', kind: 'x', ownerHostPid: 1 });
  spawnTrackedJob(dir, () => childB, { worktree: 'b', kind: 'y', ownerHostPid: 1 });

  childA.triggerExit();

  const entries = readTrackedJobs(dir);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].pgid, 2);
});

test('deactivate-reap-02: reapAllTrackedJobs SIGTERMs every tracked group and empties the registry', () => {
  const dir = mkTmpSwarmforgeDir();
  recordTrackedJob(dir, { pgid: 10, worktree: 'a', kind: 'x', started_at: 't', owner_host_pid: 1 });
  recordTrackedJob(dir, { pgid: 20, worktree: 'b', kind: 'y', started_at: 't', owner_host_pid: 1 });

  const killed = [];
  reapAllTrackedJobs(dir, (pgid, signal) => killed.push([pgid, signal]), 5000, () => {});

  assert.deepEqual(killed, [[10, 'SIGTERM'], [20, 'SIGTERM']]);
  assert.deepEqual(readTrackedJobs(dir), []);
});

test('deactivate-reap-02: escalates to SIGKILL after the grace window for each tracked group', () => {
  const dir = mkTmpSwarmforgeDir();
  recordTrackedJob(dir, { pgid: 30, worktree: 'a', kind: 'x', started_at: 't', owner_host_pid: 1 });

  const killed = [];
  let scheduled;
  reapAllTrackedJobs(
    dir,
    (pgid, signal) => killed.push([pgid, signal]),
    5000,
    (fn) => { scheduled = fn; }
  );
  assert.deepEqual(killed, [[30, 'SIGTERM']]);

  scheduled();

  assert.deepEqual(killed, [[30, 'SIGTERM'], [30, 'SIGKILL']]);
});

test('deactivate-reap-02: a group already gone (kill throws) does not stop the rest from being reaped', () => {
  const dir = mkTmpSwarmforgeDir();
  recordTrackedJob(dir, { pgid: 40, worktree: 'a', kind: 'x', started_at: 't', owner_host_pid: 1 });
  recordTrackedJob(dir, { pgid: 50, worktree: 'b', kind: 'y', started_at: 't', owner_host_pid: 1 });

  const killed = [];
  reapAllTrackedJobs(
    dir,
    (pgid, signal) => {
      if (pgid === 40) throw new Error('ESRCH');
      killed.push([pgid, signal]);
    },
    5000,
    () => {}
  );

  assert.deepEqual(killed, [[50, 'SIGTERM']]);
  assert.deepEqual(readTrackedJobs(dir), []);
});

test('startup-reaper-03: an entry whose owner host pid is dead is terminated and dropped', () => {
  const dir = mkTmpSwarmforgeDir();
  recordTrackedJob(dir, { pgid: 60, worktree: 'a', kind: 'stryker', started_at: 't', owner_host_pid: 999 });

  const killed = [];
  reapStaleTrackedJobs(dir, (pid) => pid !== 999, (pgid, signal) => killed.push([pgid, signal]));

  assert.deepEqual(killed, [[60, 'SIGTERM']]);
  assert.deepEqual(readTrackedJobs(dir), []);
});

test('startup-reaper-03: an entry whose owner host pid is still alive is left untouched', () => {
  const dir = mkTmpSwarmforgeDir();
  recordTrackedJob(dir, { pgid: 70, worktree: 'a', kind: 'stryker', started_at: 't', owner_host_pid: 111 });

  const killed = [];
  reapStaleTrackedJobs(dir, (pid) => pid === 111, (pgid, signal) => killed.push([pgid, signal]));

  assert.deepEqual(killed, []);
  const entries = readTrackedJobs(dir);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].pgid, 70);
});

test('startup-reaper-03: a stale entry whose kill throws (already gone) is still dropped from the registry', () => {
  const dir = mkTmpSwarmforgeDir();
  recordTrackedJob(dir, { pgid: 65, worktree: 'a', kind: 'stryker', started_at: 't', owner_host_pid: 999 });

  reapStaleTrackedJobs(dir, () => false, () => { throw new Error('ESRCH'); });

  assert.deepEqual(readTrackedJobs(dir), []);
});

test('startup-reaper-03: mixed stale and live entries only reap the stale one', () => {
  const dir = mkTmpSwarmforgeDir();
  recordTrackedJob(dir, { pgid: 80, worktree: 'a', kind: 'stryker', started_at: 't', owner_host_pid: 1 });
  recordTrackedJob(dir, { pgid: 90, worktree: 'b', kind: 'test', started_at: 't', owner_host_pid: 2 });

  const killed = [];
  reapStaleTrackedJobs(dir, (pid) => pid === 2, (pgid, signal) => killed.push([pgid, signal]));

  assert.deepEqual(killed, [[80, 'SIGTERM']]);
  const entries = readTrackedJobs(dir);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].pgid, 90);
});
