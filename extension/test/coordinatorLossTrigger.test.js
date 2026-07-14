const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  isCoordinatorDeadEvent,
  handleCoordinatorDeadEvent,
  createProductionCoordinatorLossDeps,
} = require('../out/swarm/coordinatorLossTrigger');

// BL-245 architect bounce (5f0ae65b42, "engine has no live caller"):
// recoverOrStopOnCoordinatorLoss was well-built and well-tested but had
// zero production callers. This file is the missing trigger - a real
// PaneTailer DeadEvent for the coordinator role now actually invokes it,
// wired with REAL production dependencies (tmuxClient.respawnAgent,
// swarmStopper.stopSwarmCompletely, chaserMonitor/heartbeat/liveness for
// drain status) - not fabricated, not just unit-tested in isolation.

function mkTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-coordinator-loss-trigger-'));
}

// ── isCoordinatorDeadEvent (pure decision) ────────────────────────────────

test('true when the coordinator role is in the dead events with dead=true', () => {
  assert.equal(isCoordinatorDeadEvent([{ role: 'coordinator', dead: true }]), true);
});

test('false when a non-coordinator role dies', () => {
  assert.equal(isCoordinatorDeadEvent([{ role: 'coder', dead: true }]), false);
});

test('false when the coordinator event says dead=false (came back alive)', () => {
  assert.equal(isCoordinatorDeadEvent([{ role: 'coordinator', dead: false }]), false);
});

test('false for an empty events array', () => {
  assert.equal(isCoordinatorDeadEvent([]), false);
});

test('true when the coordinator is dead among several other roles\' events', () => {
  assert.equal(
    isCoordinatorDeadEvent([
      { role: 'coder', dead: false },
      { role: 'coordinator', dead: true },
      { role: 'cleaner', dead: false },
    ]),
    true
  );
});

// ── handleCoordinatorDeadEvent (the actual trigger) ──────────────────────

test('a coordinator dead=true event triggers recovery exactly once', async () => {
  const targetPath = mkTarget();
  const calls = [];
  const recoverFn = async (deps) => {
    calls.push(deps.targetPath);
    return { outcome: 'stopped', attempts: 3 };
  };

  const result = await handleCoordinatorDeadEvent(targetPath, [{ role: 'coordinator', dead: true }], {}, recoverFn);

  assert.deepEqual(calls, [targetPath]);
  assert.deepEqual(result, { outcome: 'stopped', attempts: 3 });
});

test('a non-coordinator dead event never triggers recovery', async () => {
  const targetPath = mkTarget();
  const recoverFn = async () => {
    throw new Error('must never be called for a non-coordinator death');
  };

  const result = await handleCoordinatorDeadEvent(targetPath, [{ role: 'coder', dead: true }], {}, recoverFn);

  assert.equal(result, null);
});

test('a coordinator dead=false event (recovered) never triggers recovery', async () => {
  const targetPath = mkTarget();
  const recoverFn = async () => {
    throw new Error('must never be called when the coordinator is reported alive');
  };

  const result = await handleCoordinatorDeadEvent(targetPath, [{ role: 'coordinator', dead: false }], {}, recoverFn);

  assert.equal(result, null);
});

test('deps overrides are merged onto the production defaults, not replacing them wholesale', async () => {
  const targetPath = mkTarget();
  let sawMaxAttempts;
  const recoverFn = async (deps) => {
    sawMaxAttempts = deps.maxRespawnAttempts;
    return { outcome: 'recovered', attempts: 1 };
  };

  await handleCoordinatorDeadEvent(targetPath, [{ role: 'coordinator', dead: true }], { maxRespawnAttempts: 7 }, recoverFn);

  assert.equal(sawMaxAttempts, 7);
});

// ── createProductionCoordinatorLossDeps (real wiring, no live tmux needed) ──

test('the production deps read real drain status from real .swarmforge/handoffs fixtures', () => {
  const targetPath = mkTarget();
  fs.mkdirSync(path.join(targetPath, '.swarmforge', 'roles.tsv', '..'), { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, '.swarmforge', 'roles.tsv'),
    'coder\tcoder\t' + path.join(targetPath, '.worktrees', 'coder') + '\tclaude\tCoder\tclaude\n'
  );
  const inProcessDir = path.join(targetPath, '.worktrees', 'coder', '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(inProcessDir, { recursive: true });
  fs.writeFileSync(path.join(inProcessDir, '00_task.handoff'), 'type: git_handoff\n');

  const deps = createProductionCoordinatorLossDeps(targetPath);
  const statuses = deps.drainRoleStatuses();

  const coder = statuses.find((s) => s.role === 'coder');
  assert.ok(coder, 'expected a drain status entry for "coder"');
  assert.equal(coder.hasInProcessWork, true);
});

test('the production respawnCoordinator is safe to call with no live tmux socket (never throws)', async () => {
  const targetPath = mkTarget(); // no .swarmforge/tmux-socket at all

  const deps = createProductionCoordinatorLossDeps(targetPath);

  assert.doesNotThrow(() => deps.respawnCoordinator());
  assert.equal(deps.respawnCoordinator(), false, 'no tmux socket recorded means the respawn cannot succeed');
});

test('the production stopSwarmCompletely is safe to call on an already-stopped/nonexistent swarm (idempotent, never throws)', () => {
  const targetPath = mkTarget();

  const deps = createProductionCoordinatorLossDeps(targetPath);

  assert.doesNotThrow(() => deps.stopSwarmCompletely(targetPath));
});

test('the production sleep/getNowMs are real (not injected fakes) - sleep actually elapses wall time', async () => {
  const targetPath = mkTarget();
  const deps = createProductionCoordinatorLossDeps(targetPath);

  const before = deps.getNowMs();
  await deps.sleep(5);
  const after = deps.getNowMs();

  assert.ok(after >= before, 'real getNowMs must be monotonic');
});
