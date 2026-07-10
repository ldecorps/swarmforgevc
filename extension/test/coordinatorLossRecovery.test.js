const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  recoverOrStopOnCoordinatorLoss,
  readCoordinatorLossState,
  coordinatorLossStatePath,
} = require('../out/swarm/coordinatorLossRecovery');

// BL-245 (Baton fleet epic, BL-242 child): bounded coordinator-loss
// respawn, then quiesce-and-teardown on exhaustion. Reuses
// bounceDrain.ts's decideDrainAction (quiesce) and an injected
// stopSwarmCompletely (teardown) unchanged - no new drain/teardown logic
// here, only the bounded-respawn orchestration and the durable sentinel.
// Pane kill/respawn and tmux teardown are ALWAYS faked; backoff/quiesce
// polling always runs on an injected fake sleep, never a real timer.

function mkTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-coordinator-loss-'));
}

function fakeSleep(calls) {
  return async (ms) => {
    calls.push(ms);
  };
}

function allIdleRoleStatuses() {
  return [
    { role: 'specifier', hasInProcessWork: false, idle: true },
    { role: 'coder', hasInProcessWork: false, idle: true },
  ];
}

function baseDeps(targetPath, overrides = {}) {
  const sleepCalls = [];
  return {
    targetPath,
    maxRespawnAttempts: 3,
    respawnCoordinator: () => false,
    backoffMs: (attempt) => attempt * 100,
    sleep: fakeSleep(sleepCalls),
    sleepCalls,
    drainRoleStatuses: allIdleRoleStatuses,
    drainTimeoutSeconds: 30,
    drainPollMs: 10,
    getNowMs: () => 0,
    stopSwarmCompletely: () => ({ success: true, message: 'stopped', phases: [], sessionsAttempted: [], sessionsStopped: 0, daemonStopped: true, supervisorStopped: true, durationMs: 0 }),
    ...overrides,
  };
}

// ── respawn-recovers-01 ──────────────────────────────────────────────────

test('a respawn that succeeds on the first attempt recovers, no teardown, no sleep', async () => {
  const targetPath = mkTarget();
  const stopCalls = [];
  const deps = baseDeps(targetPath, {
    respawnCoordinator: () => true,
    stopSwarmCompletely: (...args) => {
      stopCalls.push(args);
      return { success: true };
    },
  });

  const outcome = await recoverOrStopOnCoordinatorLoss(deps);

  assert.deepEqual(outcome, { outcome: 'recovered', attempts: 1 });
  assert.equal(stopCalls.length, 0, 'a recovered coordinator must never trigger teardown');
  assert.deepEqual(deps.sleepCalls, []);
});

test('a respawn that succeeds on the second attempt recovers after exactly one backoff sleep', async () => {
  const targetPath = mkTarget();
  let calls = 0;
  const deps = baseDeps(targetPath, {
    respawnCoordinator: () => {
      calls += 1;
      return calls === 2;
    },
  });

  const outcome = await recoverOrStopOnCoordinatorLoss(deps);

  assert.deepEqual(outcome, { outcome: 'recovered', attempts: 2 });
  assert.deepEqual(deps.sleepCalls, [100], 'exactly one backoff sleep between attempt 1 and attempt 2');
});

test('recovery writes no coordinator-loss sentinel - a normal-status swarm has none', async () => {
  const targetPath = mkTarget();
  const deps = baseDeps(targetPath, { respawnCoordinator: () => true });

  await recoverOrStopOnCoordinatorLoss(deps);

  assert.equal(fs.existsSync(coordinatorLossStatePath(targetPath)), false);
});

// ── exhausted-respawn-stops-02 ───────────────────────────────────────────

test('respawn is BOUNDED: attempted exactly maxRespawnAttempts times, never more, when every attempt fails', async () => {
  const targetPath = mkTarget();
  let calls = 0;
  const deps = baseDeps(targetPath, {
    maxRespawnAttempts: 3,
    respawnCoordinator: () => {
      calls += 1;
      return false;
    },
  });

  await recoverOrStopOnCoordinatorLoss(deps);

  assert.equal(calls, 3);
});

test('backoff is applied between failed attempts, using the injected backoffMs, never past the last attempt', async () => {
  const targetPath = mkTarget();
  const deps = baseDeps(targetPath, { maxRespawnAttempts: 3 });

  await recoverOrStopOnCoordinatorLoss(deps);

  // Backoff sleeps happen BETWEEN attempts (1->2, 2->3), not after the
  // final exhausted attempt - 2 sleeps for 3 attempts, not 3.
  assert.deepEqual(deps.sleepCalls.filter((ms) => ms === 100 || ms === 200), [100, 200]);
});

test('exhausting every respawn attempt tears the swarm down (stopSwarmCompletely is invoked)', async () => {
  const targetPath = mkTarget();
  const stopCalls = [];
  const deps = baseDeps(targetPath, {
    stopSwarmCompletely: (tp) => {
      stopCalls.push(tp);
      return { success: true };
    },
  });

  const outcome = await recoverOrStopOnCoordinatorLoss(deps);

  assert.equal(outcome.outcome, 'stopped');
  assert.deepEqual(stopCalls, [targetPath]);
});

// ── graceful-stop-quiesces-03 ─────────────────────────────────────────────

test('teardown never runs before every role has drained (quiesce, don\'t cut)', async () => {
  const targetPath = mkTarget();
  const order = [];
  let statusCalls = 0;
  const deps = baseDeps(targetPath, {
    drainRoleStatuses: () => {
      statusCalls += 1;
      order.push(`drain-check-${statusCalls}`);
      // Busy for the first two checks, drained on the third.
      return statusCalls < 3
        ? [{ role: 'coder', hasInProcessWork: true, idle: false }]
        : [{ role: 'coder', hasInProcessWork: false, idle: true }];
    },
    getNowMs: () => 0, // never times out on its own - only the drain condition ends the wait
    stopSwarmCompletely: () => {
      order.push('teardown');
      return { success: true };
    },
  });

  await recoverOrStopOnCoordinatorLoss(deps);

  assert.deepEqual(order, ['drain-check-1', 'drain-check-2', 'drain-check-3', 'teardown']);
});

test('a quiesce that never drains still tears down once its own timeout elapses (never waits forever)', async () => {
  const targetPath = mkTarget();
  let nowMs = 0;
  const stopCalls = [];
  const deps = baseDeps(targetPath, {
    drainRoleStatuses: () => [{ role: 'coder', hasInProcessWork: true, idle: false }], // never drains
    drainTimeoutSeconds: 1,
    drainPollMs: 500,
    getNowMs: () => nowMs,
    sleep: async (ms) => {
      deps.sleepCalls.push(ms);
      nowMs += ms;
    },
    stopSwarmCompletely: () => {
      stopCalls.push(true);
      return { success: true };
    },
  });
  deps.sleep = async (ms) => {
    deps.sleepCalls.push(ms);
    nowMs += ms;
  };

  await recoverOrStopOnCoordinatorLoss(deps);

  assert.equal(stopCalls.length, 1, 'teardown must still run after the drain timeout, not wait forever');
});

test('the sentinel is written durably with phase "stopped" after a completed graceful stop', async () => {
  const targetPath = mkTarget();
  const deps = baseDeps(targetPath, { getNowMs: () => 1_752_000_000_000 });

  await recoverOrStopOnCoordinatorLoss(deps);

  const state = readCoordinatorLossState(targetPath);
  assert.equal(state.phase, 'stopped');
  assert.equal(typeof state.startedAt, 'string');
});

test('the sentinel moves through a "quiescing" phase before "stopped" (freezes intake during drain)', async () => {
  const targetPath = mkTarget();
  const observedPhases = [];
  const deps = baseDeps(targetPath, {
    drainRoleStatuses: () => {
      observedPhases.push(readCoordinatorLossState(targetPath)?.phase);
      return allIdleRoleStatuses();
    },
  });

  await recoverOrStopOnCoordinatorLoss(deps);

  assert.ok(observedPhases.includes('quiescing'), 'expected the sentinel to read "quiescing" while draining, before teardown');
});

// ── fleet-terminal-stopped-04 ─────────────────────────────────────────────

test('readCoordinatorLossState returns null when no stop has ever happened', () => {
  const targetPath = mkTarget();

  assert.equal(readCoordinatorLossState(targetPath), null);
});
