/**
 * BL-121: canary injector — sends periodic synthetic handoffs through the
 * real delivery pipeline to detect transport-level breakage independent of
 * process liveness.
 *
 * A successful canary round-trip (sent → delivered → completed) updates
 * canary-status.json. A missed canary (not completed within budget) signals
 * transport broken, even if the daemon process heartbeats healthy.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  sendCanary,
  trackCanaryCompletion,
  recordCanaryRoundTrip,
  readCanaryStatusFile,
  writeCanaryStatusFile,
  computeCanaryInjectionSchedule,
  reconcileCanary,
  runCanaryCycle,
} = require('../out/swarm/canaryInjector');

const NOW = new Date('2026-07-05T22:00:00Z').getTime();

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-canary-'));
}

// ── sendCanary ─────────────────────────────────────────────────────────────

test('sendCanary creates a canary handoff draft with task prefix and timestamp', () => {
  const target = mkTmp();
  const taskName = sendCanary(target, NOW);

  assert(taskName.startsWith('canary-'));
  assert(taskName.includes('20260705T220000Z'));
});

test('sendCanary uses a deterministic format that includes the timestamp', () => {
  const target = mkTmp();
  const taskName1 = sendCanary(target, NOW);
  const taskName2 = sendCanary(target, NOW + 1000); // 1 second later

  assert.notEqual(taskName1, taskName2);
  assert(taskName2.includes('20260705T220001Z')); // Second incremented
});

test('sendCanary writes a real handoff file into the pending canary queue', () => {
  const target = mkTmp();
  const taskName = sendCanary(target, NOW);

  const pendingDir = path.join(target, '.swarmforge', 'daemon', 'canary-queue', 'pending');
  const files = fs.readdirSync(pendingDir);
  assert.equal(files.length, 1);
  assert(files[0].endsWith('.handoff'));

  const content = fs.readFileSync(path.join(pendingDir, files[0]), 'utf-8');
  assert(content.includes(`task: ${taskName}`));
});

test('the canary queue lives under the daemon namespace, never under any role handoff inbox', () => {
  const target = mkTmp();
  sendCanary(target, NOW);

  // Structural isolation (BL-121 canary-isolation-04): canary-queue is a
  // sibling of canary-status.json under .swarmforge/daemon/, not under
  // .swarmforge/handoffs/ where ready_for_next.sh and role dispatch read
  // from. A canary can therefore never be delivered to a pipeline role.
  assert(!fs.existsSync(path.join(target, '.swarmforge', 'handoffs')));
  assert(fs.existsSync(path.join(target, '.swarmforge', 'daemon', 'canary-queue', 'pending')));
});

// ── trackCanaryCompletion ──────────────────────────────────────────────────

test('trackCanaryCompletion finds a completed canary handoff by task name', () => {
  const target = mkTmp();
  const coordinatorCompleted = path.join(target, '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(coordinatorCompleted, { recursive: true });

  // Write a completed canary handoff
  const handoffPath = path.join(coordinatorCompleted, '00_x_canary.handoff');
  fs.writeFileSync(handoffPath, 'task: canary-20260705T220000Z\n\nbody');

  const result = trackCanaryCompletion(target, 'canary-20260705T220000Z', coordinatorCompleted);
  assert(result !== null);
  assert.equal(result.found, true);
});

test('trackCanaryCompletion returns null when canary has not completed yet', () => {
  const target = mkTmp();
  const coordinatorCompleted = path.join(target, '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(coordinatorCompleted, { recursive: true });

  const result = trackCanaryCompletion(target, 'canary-20260705T220000Z', coordinatorCompleted);
  assert(result === null);
});

// ── recordCanaryRoundTrip ──────────────────────────────────────────────────

test('recordCanaryRoundTrip updates the canary status file with the round-trip time', () => {
  const target = mkTmp();
  const daemonDir = path.join(target, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });

  const sentAtMs = NOW - 30_000; // 30 seconds ago
  recordCanaryRoundTrip(target, sentAtMs, NOW);

  const statusPath = path.join(daemonDir, 'canary-status.json');
  assert(fs.existsSync(statusPath));
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
  assert.equal(status.lastRoundTripMs, NOW);
});

// ── readCanaryStatusFile / writeCanaryStatusFile ────────────────────────────

test('readCanaryStatusFile returns null when no canary status file exists', () => {
  const target = mkTmp();
  const status = readCanaryStatusFile(target);
  assert.equal(status, null);
});

test('readCanaryStatusFile reads and parses the canary status file', () => {
  const target = mkTmp();
  const daemonDir = path.join(target, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(path.join(daemonDir, 'canary-status.json'), JSON.stringify({ lastRoundTripMs: NOW }));

  const status = readCanaryStatusFile(target);
  assert.equal(status.lastRoundTripMs, NOW);
});

test('writeCanaryStatusFile creates the daemon directory if needed', () => {
  const target = mkTmp();
  writeCanaryStatusFile(target, { lastRoundTripMs: NOW });

  const statusPath = path.join(target, '.swarmforge', 'daemon', 'canary-status.json');
  assert(fs.existsSync(statusPath));
});

// ── computeCanaryInjectionSchedule ─────────────────────────────────────────

test('computeCanaryInjectionSchedule returns null when no prior injection exists', () => {
  const target = mkTmp();
  const budget = 300; // 5 minutes
  const result = computeCanaryInjectionSchedule(target, NOW, budget);

  assert.equal(result.shouldInject, true);
  assert.equal(result.nextCheckMs, NOW + 60_000); // 1 min default check interval
});

test('computeCanaryInjectionSchedule skips injection if last canary is still fresh', () => {
  const target = mkTmp();
  const daemonDir = path.join(target, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });

  // Last canary completed 30 seconds ago
  const lastRoundTripMs = NOW - 30_000;
  writeCanaryStatusFile(target, { lastRoundTripMs });

  const budget = 300; // 5 minute budget, canary within budget
  const result = computeCanaryInjectionSchedule(target, NOW, budget);

  assert.equal(result.shouldInject, false);
});

test('computeCanaryInjectionSchedule injects when last canary is stale but not missed', () => {
  const target = mkTmp();
  const daemonDir = path.join(target, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });

  // Last canary completed 250 seconds ago, 50 seconds before budget expires
  const lastRoundTripMs = NOW - 250_000;
  writeCanaryStatusFile(target, { lastRoundTripMs });

  const budget = 300; // 5 minute budget
  const result = computeCanaryInjectionSchedule(target, NOW, budget);

  assert.equal(result.shouldInject, true);
});

test('computeCanaryInjectionSchedule schedules the next check to occur before the canary budget expires', () => {
  const target = mkTmp();
  const daemonDir = path.join(target, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });

  const lastRoundTripMs = NOW - 100_000;
  writeCanaryStatusFile(target, { lastRoundTripMs });

  const budget = 300; // 5 minutes
  const result = computeCanaryInjectionSchedule(target, NOW, budget);

  // Next check should be before canary goes stale (budget expires)
  const timeUntilBudgetMs = (budget * 1000) - (NOW - lastRoundTripMs);
  assert(result.nextCheckMs <= lastRoundTripMs + budget * 1000);
});

// ── reconcileCanary ────────────────────────────────────────────────────────

function pendingDirFor(target) {
  return path.join(target, '.swarmforge', 'daemon', 'canary-queue', 'pending');
}

test('reconcileCanary is a no-op when there are no pending canaries', () => {
  const target = mkTmp();
  const completedDir = path.join(target, '.swarmforge', 'handoffs', 'inbox', 'completed');

  const result = reconcileCanary(target, completedDir);

  assert.deepEqual(result.reconciledTaskNames, []);
  assert.equal(readCanaryStatusFile(target), null);
});

test('reconcileCanary records the round trip and clears a pending canary once it completes', () => {
  const target = mkTmp();
  const completedDir = path.join(target, '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(completedDir, { recursive: true });

  const sentAtMs = NOW - 5_000;
  const taskName = sendCanary(target, sentAtMs);

  // The real transport delivered and completed the canary.
  fs.writeFileSync(path.join(completedDir, '00_x_canary.handoff'), `task: ${taskName}\n\nbody`);

  const result = reconcileCanary(target, completedDir);

  assert.deepEqual(result.reconciledTaskNames, [taskName]);
  const status = readCanaryStatusFile(target);
  assert(status !== null);
  assert.equal(fs.readdirSync(pendingDirFor(target)).length, 0);
});

test('reconcileCanary leaves a pending canary in place when it has not completed yet', () => {
  const target = mkTmp();
  const completedDir = path.join(target, '.swarmforge', 'handoffs', 'inbox', 'completed');

  const taskName = sendCanary(target, NOW - 5_000);

  const result = reconcileCanary(target, completedDir);

  assert.deepEqual(result.reconciledTaskNames, []);
  assert.equal(readCanaryStatusFile(target), null);
  const remaining = fs.readdirSync(pendingDirFor(target));
  assert.equal(remaining.length, 1);
  assert(remaining[0].includes(taskName));
});

// ── runCanaryCycle ─────────────────────────────────────────────────────────

test('runCanaryCycle injects a canary on the first call when no prior canary exists', () => {
  const target = mkTmp();
  const completedDir = path.join(target, '.swarmforge', 'handoffs', 'inbox', 'completed');
  const budget = 300;

  const result = runCanaryCycle(target, completedDir, NOW, budget);

  assert.equal(result.injected, true);
  assert(result.taskName !== null);
  assert.deepEqual(result.reconciled, []);
  assert.equal(fs.readdirSync(pendingDirFor(target)).length, 1);
});

test('runCanaryCycle reconciles a completed canary and records its round trip', () => {
  const target = mkTmp();
  const completedDir = path.join(target, '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(completedDir, { recursive: true });

  const taskName = sendCanary(target, NOW - 5_000);
  fs.writeFileSync(path.join(completedDir, '00_x_canary.handoff'), `task: ${taskName}\n\nbody`);

  const budget = 300;
  const result = runCanaryCycle(target, completedDir, NOW, budget);

  assert.deepEqual(result.reconciled, [taskName]);
  const status = readCanaryStatusFile(target);
  assert(status !== null);
});

test('runCanaryCycle does not inject a new canary while the last one is still fresh', () => {
  const target = mkTmp();
  const completedDir = path.join(target, '.swarmforge', 'handoffs', 'inbox', 'completed');
  const budget = 300;

  writeCanaryStatusFile(target, { lastRoundTripMs: NOW - 30_000 }); // well within budget

  const result = runCanaryCycle(target, completedDir, NOW, budget);

  assert.equal(result.injected, false);
  assert.equal(result.taskName, null);
});
