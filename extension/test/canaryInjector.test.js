/**
 * BL-121: Canary injector unit tests — synthetic handoffs that prove delivery
 * is working by making a full round-trip through the pipeline.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  generateCanaryTaskName,
  readCanaryStatus,
  writeCanaryStatus,
  readTrackedCanaries,
  isCanaryWithinBudget,
  tryInjectCanary,
  detectCompletedCanaries,
  canaryOutboxFilename,
  generateCanaryHandoffDraft,
} = require('../out/swarm/canaryInjector');

const NOW = new Date('2026-07-05T22:00:00Z').getTime();

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-canary-'));
}

// ── generateCanaryTaskName ────────────────────────────────────────────────

test('generateCanaryTaskName creates a stable, unique name from a timestamp', () => {
  const name1 = generateCanaryTaskName(NOW);
  const name2 = generateCanaryTaskName(NOW + 1000);

  assert.match(name1, /^canary-\d{8}T\d{6}Z$/);
  assert.notEqual(name1, name2);
});

test('generateCanaryTaskName embeds the ISO timestamp compacted for filename safety', () => {
  const utc = new Date('2026-07-05T22:15:30.123Z');
  const name = generateCanaryTaskName(utc.getTime());
  assert.match(name, /^canary-20260705T221530Z$/);
});

// ── readCanaryStatus / writeCanaryStatus ──────────────────────────────────

test('readCanaryStatus returns null when the status file does not exist', () => {
  const target = mkTmp();
  const status = readCanaryStatus(target);
  assert.deepEqual(status, { lastRoundTripMs: null });
});

test('readCanaryStatus reads a recorded round-trip time', () => {
  const target = mkTmp();
  writeCanaryStatus(target, 60_000);
  const status = readCanaryStatus(target);
  assert.equal(status.lastRoundTripMs, 60_000);
});

test('writeCanaryStatus creates the directory structure and writes atomically', () => {
  const target = mkTmp();
  writeCanaryStatus(target, 120_000);
  assert(fs.existsSync(path.join(target, '.swarmforge', 'daemon', 'canary-status.json')));
});

test('readCanaryStatus handles corrupted status file gracefully', () => {
  const target = mkTmp();
  const dir = path.join(target, '.swarmforge', 'daemon');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'canary-status.json'), 'invalid json', 'utf-8');
  const status = readCanaryStatus(target);
  assert.deepEqual(status, { lastRoundTripMs: null });
});

// ── isCanaryWithinBudget ──────────────────────────────────────────────────

test('isCanaryWithinBudget returns true when age is less than budget', () => {
  assert.equal(isCanaryWithinBudget(60, 300), true);
});

test('isCanaryWithinBudget returns true when age equals budget (inclusive)', () => {
  assert.equal(isCanaryWithinBudget(300, 300), true);
});

test('isCanaryWithinBudget returns false when age exceeds budget', () => {
  assert.equal(isCanaryWithinBudget(301, 300), false);
});

// ── tryInjectCanary ───────────────────────────────────────────────────────

test('tryInjectCanary injects immediately when no prior canary exists', () => {
  const target = mkTmp();
  const roles = ['coordinator', 'specifier', 'coder'];
  const taskName = tryInjectCanary(target, NOW, { injectionIntervalSeconds: 600, budgetSeconds: 300 }, roles);

  assert(taskName);
  assert.match(taskName, /^canary-\d{8}T\d{6}Z$/);

  const tracked = readTrackedCanaries(target);
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].canaryTaskName, taskName);
  assert.equal(tracked[0].injectedAtMs, NOW);
});

test('tryInjectCanary returns null when the injection interval has not elapsed', () => {
  const target = mkTmp();
  const roles = ['coordinator', 'specifier', 'coder'];
  const config = { injectionIntervalSeconds: 600, budgetSeconds: 300 };

  const taskName1 = tryInjectCanary(target, NOW, config, roles);
  const taskName2 = tryInjectCanary(target, NOW + 300_000, config, roles); // 5 minutes later (< 10 min interval)

  assert(taskName1);
  assert.equal(taskName2, null); // Too soon

  const tracked = readTrackedCanaries(target);
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].canaryTaskName, taskName1);
});

test('tryInjectCanary injects a new canary after the interval has elapsed', () => {
  const target = mkTmp();
  const roles = ['coordinator', 'specifier', 'coder'];
  const config = { injectionIntervalSeconds: 600, budgetSeconds: 300 };

  const taskName1 = tryInjectCanary(target, NOW, config, roles);
  const taskName2 = tryInjectCanary(target, NOW + 601_000, config, roles); // 10+ min later

  assert(taskName1);
  assert(taskName2);
  assert.notEqual(taskName1, taskName2);

  const tracked = readTrackedCanaries(target);
  assert.equal(tracked.length, 2);
});

// ── detectCompletedCanaries ───────────────────────────────────────────────

test('detectCompletedCanaries records round-trip time when a canary completes', () => {
  const target = mkTmp();
  const roles = ['coordinator', 'specifier', 'coder'];

  const taskName = tryInjectCanary(target, NOW, { injectionIntervalSeconds: 600, budgetSeconds: 300 }, roles);
  assert(taskName);

  // Simulate canary arriving in completed/ after 45 seconds
  // File must be a .handoff file and must contain the matching task name
  const completedDir = mkTmp();
  const completedName = `00_20260705T220045Z_000001_from_QA_to_coordinator_for_coordinator.handoff`;
  const content = `id: 20260705T220045Z_000001_from_QA
from: QA
to: coordinator
recipient: coordinator
priority: 00
type: git_handoff
role: QA
task: ${taskName}
commit: 1234567890

Canary completed`;
  fs.writeFileSync(path.join(completedDir, completedName), content, 'utf-8');

  detectCompletedCanaries(target, NOW + 45_000, completedDir);

  const status = readCanaryStatus(target);
  assert.equal(status.lastRoundTripMs, 45_000);

  // Canary should be removed from tracked list once detected
  const tracked = readTrackedCanaries(target);
  assert.equal(tracked.length, 0);
});

test('detectCompletedCanaries does not fail when completed dir does not exist', () => {
  const target = mkTmp();
  const roles = ['coordinator', 'specifier', 'coder'];

  tryInjectCanary(target, NOW, { injectionIntervalSeconds: 600, budgetSeconds: 300 }, roles);
  const nonexistentDir = path.join(mkTmp(), 'does-not-exist');

  // Should not throw
  detectCompletedCanaries(target, NOW + 10_000, nonexistentDir);

  // Canary still tracked (not yet completed)
  const tracked = readTrackedCanaries(target);
  assert.equal(tracked.length, 1);
});

test('detectCompletedCanaries ignores a completed-path that is not a directory', () => {
  const target = mkTmp();
  const roles = ['coordinator', 'specifier', 'coder'];

  tryInjectCanary(target, NOW, { injectionIntervalSeconds: 600, budgetSeconds: 300 }, roles);
  const filePath = path.join(mkTmp(), 'completed-path');
  fs.writeFileSync(filePath, 'not a directory', 'utf-8');

  assert.doesNotThrow(() => detectCompletedCanaries(target, NOW + 10_000, filePath));

  const tracked = readTrackedCanaries(target);
  assert.equal(tracked.length, 1);
});

test('detectCompletedCanaries cleans up old undelivered canaries (age > 1h)', () => {
  const target = mkTmp();
  const roles = ['coordinator', 'specifier', 'coder'];

  const taskName = tryInjectCanary(target, NOW, { injectionIntervalSeconds: 600, budgetSeconds: 300 }, roles);
  assert(taskName);

  // Run detector 2 hours later — canary should be considered lost
  detectCompletedCanaries(target, NOW + 7200_000, mkTmp());

  const tracked = readTrackedCanaries(target);
  assert.equal(tracked.length, 0);
});

test('detectCompletedCanaries keeps recently-injected canaries (age < 1h)', () => {
  const target = mkTmp();
  const roles = ['coordinator', 'specifier', 'coder'];

  tryInjectCanary(target, NOW, { injectionIntervalSeconds: 600, budgetSeconds: 300 }, roles);

  // Run detector 30 minutes later — canary still pending
  detectCompletedCanaries(target, NOW + 1800_000, mkTmp());

  const tracked = readTrackedCanaries(target);
  assert.equal(tracked.length, 1); // Still tracked, not yet old enough to clean up
});

// ── canaryOutboxFilename ──────────────────────────────────────────────────

test('canaryOutboxFilename generates a deterministic outbox filename', () => {
  const filename = canaryOutboxFilename('canary-20260705T220000Z', 7);
  assert.match(filename, /^00_canary[0-9TZ]+_from_coordinator_to_coordinator(,coordinator){6}\.handoff$/);
});

// ── generateCanaryHandoffDraft ────────────────────────────────────────────

test('generateCanaryHandoffDraft creates a valid handoff draft with all roles', () => {
  const roles = ['coordinator', 'specifier', 'coder', 'cleaner'];
  const draft = generateCanaryHandoffDraft('canary-20260705T220000Z', roles);

  assert(draft.includes('type: git_handoff'));
  assert(draft.includes(`task: canary-20260705T220000Z`));
  assert(draft.includes(`to: ${roles.join(',')}`));
  assert(draft.includes('priority: 00'));
  assert(draft.includes('Testing delivery: canary handoff round-trip'));
});

// ── readTrackedCanaries ───────────────────────────────────────────────────

test('readTrackedCanaries returns an empty array when the file does not exist', () => {
  const target = mkTmp();
  const tracked = readTrackedCanaries(target);
  assert.deepEqual(tracked, []);
});

test('readTrackedCanaries handles corrupted JSON gracefully', () => {
  const target = mkTmp();
  const dir = path.join(target, '.swarmforge', 'daemon');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'canaries.json'), 'not valid json', 'utf-8');
  const tracked = readTrackedCanaries(target);
  assert.deepEqual(tracked, []);
});
