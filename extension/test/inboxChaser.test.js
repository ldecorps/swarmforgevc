/**
 * BL-022: InboxChaser — unit tests.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  decideItemAction,
  readChaseCount,
  writeChaseCount,
  sidecarPath,
  deadLetterPath,
  scanInboxNew,
  runSweep,
  decideStuckAction,
  isDoneButUndelivered,
  nudgePath,
  readNudgeCount,
  writeNudgeCount,
  scanInProcess,
  respawnCooldownPath,
  readRespawnCooldownUntilMs,
  writeRespawnCooldownUntilMs,
} = require('../out/swarm/inboxChaser');

const CFG = {
  chaseIntervalSeconds: 30,
  chaseTimeoutSeconds: 90,
  maxChases: 3,
  stuckInProcessTimeoutSeconds: 60,
  respawnCooldownSeconds: 300,
};
const NOW = new Date('2026-06-30T10:00:00Z').getTime();
const STALE_MS = NOW - 120_000; // 2 minutes old — past chaseTimeoutSeconds
const FRESH_MS = NOW - 30_000;  // 30s old — within chaseTimeoutSeconds
const ACTIVE_MS = NOW;          // last activity right now — within stuckInProcessTimeoutSeconds
const IDLE_MS = NOW - 120_000;  // last activity 2 minutes ago — past stuckInProcessTimeoutSeconds

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-inbox-chaser-'));
}

// ── decideItemAction (pure) ───────────────────────────────────────────────────

test('stale item with alive recipient, 0 chases, no recent activity → chased', () => {
  assert.equal(decideItemAction(STALE_MS, 0, NOW, CFG, 'alive', IDLE_MS), 'chased');
});

test('stale item with idle recipient, 0 chases, no recent activity → chased', () => {
  assert.equal(decideItemAction(STALE_MS, 0, NOW, CFG, 'idle', IDLE_MS), 'chased');
});

test('fresh item (not yet stale) → skipped regardless of liveness or activity', () => {
  assert.equal(decideItemAction(FRESH_MS, 0, NOW, CFG, 'alive', IDLE_MS), 'skipped');
});

test('item exactly at the chaseTimeoutSeconds boundary is already stale, not skipped', () => {
  const boundaryMs = NOW - CFG.chaseTimeoutSeconds * 1000;
  assert.equal(decideItemAction(boundaryMs, 0, NOW, CFG, 'alive', IDLE_MS), 'chased');
});

// BL-087 no-false-respawn-01/02: absence of heartbeat evidence (liveness
// 'dead'/'unknown'/'stuck') must never, by itself, justify an IMMEDIATE
// respawn — chase attempts must be exhausted first, no matter what liveness
// reports on the very first stale sweep.
test('stale item with dead recipient but chases not yet exhausted → chased, not respawned', () => {
  assert.equal(decideItemAction(STALE_MS, 0, NOW, CFG, 'dead', IDLE_MS), 'chased');
});

test('stale item with unknown recipient but chases not yet exhausted → chased, not respawned', () => {
  assert.equal(decideItemAction(STALE_MS, 0, NOW, CFG, 'unknown', IDLE_MS), 'chased');
});

test('stale item with stuck recipient but chases not yet exhausted → chased, not respawned', () => {
  assert.equal(decideItemAction(STALE_MS, 0, NOW, CFG, 'stuck', IDLE_MS), 'chased');
});

// BL-087 no-false-respawn-03: only once chase escalation is exhausted
// (maxChases reached) AND there is no recent activity does a genuinely
// unresponsive role escalate to a respawn.
test('dead recipient with no recent activity, chases exhausted → respawned', () => {
  assert.equal(decideItemAction(STALE_MS, 3, NOW, CFG, 'dead', IDLE_MS), 'respawned');
});

test('unknown recipient with no recent activity, chases exhausted → respawned', () => {
  assert.equal(decideItemAction(STALE_MS, 3, NOW, CFG, 'unknown', IDLE_MS), 'respawned');
});

test('stuck recipient with no recent activity, chases exhausted → respawned', () => {
  assert.equal(decideItemAction(STALE_MS, 3, NOW, CFG, 'stuck', IDLE_MS), 'respawned');
});

// Explicit 'alive' liveness is positive evidence, like recent activity: it
// blocks respawn even once chase attempts are exhausted.
test('stale item at maxChases with alive recipient and no recent activity → dead-lettered, not respawned', () => {
  assert.equal(decideItemAction(STALE_MS, 3, NOW, CFG, 'alive', IDLE_MS), 'dead-lettered');
});

test('stale item beyond maxChases with alive recipient → dead-lettered', () => {
  assert.equal(decideItemAction(STALE_MS, 5, NOW, CFG, 'alive', IDLE_MS), 'dead-lettered');
});

// BL-087 no-false-respawn-01/02: recent pane/outbox activity is positive
// proof of life and overrides a bad liveness reading entirely, even once
// chase attempts are exhausted — the role is dead-lettered (never respawned).
test('recent activity blocks respawn even with dead liveness and chases exhausted → dead-lettered', () => {
  assert.equal(decideItemAction(STALE_MS, 3, NOW, CFG, 'dead', ACTIVE_MS), 'dead-lettered');
});

test('recent activity blocks respawn even with unknown liveness (missing heartbeat) below maxChases → chased', () => {
  assert.equal(decideItemAction(STALE_MS, 0, NOW, CFG, 'unknown', ACTIVE_MS), 'chased');
});

// ── sidecarPath ───────────────────────────────────────────────────────────────

test('sidecarPath appends .chase.json to handoff path', () => {
  const result = sidecarPath('/path/to/50_20260630T000000Z_from_coder.handoff');
  assert.equal(result, '/path/to/50_20260630T000000Z_from_coder.handoff.chase.json');
});

// ── deadLetterPath ────────────────────────────────────────────────────────────

test('deadLetterPath appends .dead to handoff path', () => {
  const result = deadLetterPath('/path/to/50_20260630T000000Z_from_coder.handoff');
  assert.equal(result, '/path/to/50_20260630T000000Z_from_coder.handoff.dead');
});

// ── readChaseCount / writeChaseCount ──────────────────────────────────────────

test('readChaseCount returns 0 when sidecar absent', () => {
  const tmp = mkTmp();
  const handoffPath = path.join(tmp, 'test.handoff');
  assert.equal(readChaseCount(handoffPath), 0);
});

test('writeChaseCount then readChaseCount round-trips', () => {
  const tmp = mkTmp();
  const handoffPath = path.join(tmp, 'test.handoff');
  writeChaseCount(handoffPath, 2);
  assert.equal(readChaseCount(handoffPath), 2);
});

test('readChaseCount returns 0 when the sidecar holds valid JSON with a non-number chaseCount', () => {
  const tmp = mkTmp();
  const handoffPath = path.join(tmp, 'test.handoff');
  fs.writeFileSync(sidecarPath(handoffPath), JSON.stringify({ chaseCount: 'two' }), 'utf-8');
  assert.equal(readChaseCount(handoffPath), 0);
});

test('readChaseCount returns 0 for corrupt sidecar', () => {
  const tmp = mkTmp();
  const handoffPath = path.join(tmp, 'test.handoff');
  fs.writeFileSync(sidecarPath(handoffPath), 'not-json', 'utf-8');
  assert.equal(readChaseCount(handoffPath), 0);
});

// ── scanInboxNew ──────────────────────────────────────────────────────────────

test('scanInboxNew returns empty array when directory absent', () => {
  const tmp = mkTmp();
  const items = scanInboxNew(path.join(tmp, 'nonexistent'));
  assert.deepEqual(items, []);
});

test('scanInboxNew returns only .handoff files', () => {
  const tmp = mkTmp();
  const inboxNew = path.join(tmp, 'inbox', 'new');
  fs.mkdirSync(inboxNew, { recursive: true });
  fs.writeFileSync(path.join(inboxNew, 'foo.handoff'), '', 'utf-8');
  fs.writeFileSync(path.join(inboxNew, 'foo.txt'), '', 'utf-8');
  fs.mkdirSync(path.join(inboxNew, 'tmp'), { recursive: true });

  const items = scanInboxNew(inboxNew, NOW);
  assert.equal(items.length, 1);
  assert.ok(items[0].filePath.endsWith('foo.handoff'));
});

test('scanInboxNew reads chaseCount from sidecar', () => {
  const tmp = mkTmp();
  const inboxNew = path.join(tmp, 'inbox', 'new');
  fs.mkdirSync(inboxNew, { recursive: true });
  const handoffFile = path.join(inboxNew, 'test.handoff');
  fs.writeFileSync(handoffFile, '', 'utf-8');
  writeChaseCount(handoffFile, 2);

  const items = scanInboxNew(inboxNew, NOW);
  assert.equal(items[0].chaseCount, 2);
});

test('scanInboxNew returns mtimeMs for each item', () => {
  const tmp = mkTmp();
  const inboxNew = path.join(tmp, 'inbox', 'new');
  fs.mkdirSync(inboxNew, { recursive: true });
  const handoffFile = path.join(inboxNew, 'test.handoff');
  fs.writeFileSync(handoffFile, '', 'utf-8');

  const items = scanInboxNew(inboxNew, NOW);
  assert.ok(items[0].mtimeMs > 0);
});

// ── decideStuckAction (pure) ──────────────────────────────────────────────────

const STUCK_CFG = { chaseIntervalSeconds: 30, chaseTimeoutSeconds: 90, maxChases: 3, stuckInProcessTimeoutSeconds: 300 };

test('decideStuckAction skips when idle time is below the stuck timeout', () => {
  assert.equal(decideStuckAction(NOW - 100_000, 0, NOW, STUCK_CFG), 'skipped');
});

test('decideStuckAction skips exactly at the stuck timeout boundary minus one', () => {
  assert.equal(decideStuckAction(NOW - 299_000, 0, NOW, STUCK_CFG), 'skipped');
});

test('decideStuckAction nudges once idle time reaches the stuck timeout', () => {
  assert.equal(decideStuckAction(NOW - 300_000, 0, NOW, STUCK_CFG), 'nudge');
});

test('decideStuckAction nudges when nudgeCount is below maxChases', () => {
  assert.equal(decideStuckAction(NOW - 400_000, 2, NOW, STUCK_CFG), 'nudge');
});

test('decideStuckAction alerts once nudgeCount reaches maxChases', () => {
  assert.equal(decideStuckAction(NOW - 400_000, 3, NOW, STUCK_CFG), 'alert');
});

test('decideStuckAction alerts when nudgeCount exceeds maxChases', () => {
  assert.equal(decideStuckAction(NOW - 400_000, 10, NOW, STUCK_CFG), 'alert');
});

// ── isDoneButUndelivered (pure) ───────────────────────────────────────────────

test('isDoneButUndelivered false when there are no in_process items', () => {
  assert.equal(isDoneButUndelivered([], NOW, NOW - 1000, NOW, STUCK_CFG), false);
});

test('isDoneButUndelivered false when the latest commit is not after the last sent handoff', () => {
  const items = [{ filePath: 'a', mtimeMs: NOW, nudgeCount: 0 }];
  assert.equal(isDoneButUndelivered(items, NOW - 1000, NOW, NOW, STUCK_CFG), false);
});

test('isDoneButUndelivered false when the commit is after lastSentMs but still fresh', () => {
  const items = [{ filePath: 'a', mtimeMs: NOW, nudgeCount: 0 }];
  assert.equal(isDoneButUndelivered(items, NOW - 10_000, NOW - 20_000, NOW, STUCK_CFG), false);
});

test('isDoneButUndelivered true once the undelivered commit is older than the stuck timeout', () => {
  const items = [{ filePath: 'a', mtimeMs: NOW, nudgeCount: 0 }];
  const latestCommitMs = NOW - 300_000;
  assert.equal(isDoneButUndelivered(items, latestCommitMs, latestCommitMs - 1000, NOW, STUCK_CFG), true);
});

test('isDoneButUndelivered false with no items even when the commit age alone would otherwise qualify', () => {
  // Distinguishes the real inProcessItems.length === 0 short-circuit from a
  // mutant that always skips it: with items=[] the commit/age math below
  // would independently evaluate to true if reached.
  const latestCommitMs = NOW - 400_000;
  assert.equal(isDoneButUndelivered([], latestCommitMs, latestCommitMs - 1000, NOW, STUCK_CFG), false);
});

test('isDoneButUndelivered false when the commit exactly equals lastSentMs (not strictly after)', () => {
  const items = [{ filePath: 'a', mtimeMs: NOW, nudgeCount: 0 }];
  const commitMs = NOW - 400_000;
  assert.equal(isDoneButUndelivered(items, commitMs, commitMs, NOW, STUCK_CFG), false);
});

test('isDoneButUndelivered false for an old, already-delivered commit even though its age alone would qualify', () => {
  // Distinguishes the real latestCommitMs <= lastSentMs short-circuit from a
  // mutant that always skips it: the commit here is old enough (400s) that
  // the age check below would independently evaluate to true if reached.
  const items = [{ filePath: 'a', mtimeMs: NOW, nudgeCount: 0 }];
  const latestCommitMs = NOW - 400_000;
  const lastSentMs = NOW - 100_000; // sent AFTER the commit → already delivered
  assert.equal(isDoneButUndelivered(items, latestCommitMs, lastSentMs, NOW, STUCK_CFG), false);
});

// ── nudgePath / readNudgeCount / writeNudgeCount ──────────────────────────────

test('nudgePath appends .nudge to the item path', () => {
  assert.equal(nudgePath('/path/to/a.handoff'), '/path/to/a.handoff.nudge');
});

test('readNudgeCount returns 0 when no nudge sidecar exists', () => {
  const tmp = mkTmp();
  assert.equal(readNudgeCount(path.join(tmp, 'a.handoff')), 0);
});

test('readNudgeCount returns 0 for a corrupt nudge sidecar', () => {
  const tmp = mkTmp();
  const itemPath = path.join(tmp, 'a.handoff');
  fs.writeFileSync(nudgePath(itemPath), 'not-json', 'utf-8');
  assert.equal(readNudgeCount(itemPath), 0);
});

test('writeNudgeCount then readNudgeCount round-trips', () => {
  const tmp = mkTmp();
  const itemPath = path.join(tmp, 'a.handoff');
  writeNudgeCount(itemPath, 4);
  assert.equal(readNudgeCount(itemPath), 4);
});

test('readNudgeCount returns 0 when the sidecar holds valid JSON with a non-number nudgeCount', () => {
  const tmp = mkTmp();
  const itemPath = path.join(tmp, 'a.handoff');
  fs.writeFileSync(nudgePath(itemPath), JSON.stringify({ nudgeCount: 'four' }), 'utf-8');
  assert.equal(readNudgeCount(itemPath), 0);
});

// ── scanInProcess ─────────────────────────────────────────────────────────────

test('scanInProcess returns empty array when directory absent', () => {
  const tmp = mkTmp();
  assert.deepEqual(scanInProcess(path.join(tmp, 'nonexistent')), []);
});

test('scanInProcess finds a flat .handoff file directly in the directory', () => {
  const tmp = mkTmp();
  const inProcessDir = path.join(tmp, 'inbox', 'in_process');
  fs.mkdirSync(inProcessDir, { recursive: true });
  fs.writeFileSync(path.join(inProcessDir, 'a.handoff'), '', 'utf-8');

  const items = scanInProcess(inProcessDir);
  assert.equal(items.length, 1);
  assert.ok(items[0].filePath.endsWith('a.handoff'));
});

test('scanInProcess descends into a batch_ directory to find nested handoffs', () => {
  const tmp = mkTmp();
  const inProcessDir = path.join(tmp, 'inbox', 'in_process');
  const batchDir = path.join(inProcessDir, 'batch_20260630T000000Z_000001');
  fs.mkdirSync(batchDir, { recursive: true });
  fs.writeFileSync(path.join(batchDir, 'a.handoff'), '', 'utf-8');
  fs.writeFileSync(path.join(batchDir, 'b.handoff'), '', 'utf-8');

  const items = scanInProcess(inProcessDir);
  assert.equal(items.length, 2);
});

test('scanInProcess ignores non-.handoff files and non-batch_ directories', () => {
  const tmp = mkTmp();
  const inProcessDir = path.join(tmp, 'inbox', 'in_process');
  fs.mkdirSync(inProcessDir, { recursive: true });
  fs.writeFileSync(path.join(inProcessDir, 'a.handoff.nudge'), '', 'utf-8');
  fs.mkdirSync(path.join(inProcessDir, 'not_a_batch'), { recursive: true });
  fs.writeFileSync(path.join(inProcessDir, 'not_a_batch', 'c.handoff'), '', 'utf-8');

  assert.deepEqual(scanInProcess(inProcessDir), []);
});

test('scanInProcess reads nudgeCount from each item\'s sidecar', () => {
  const tmp = mkTmp();
  const inProcessDir = path.join(tmp, 'inbox', 'in_process');
  fs.mkdirSync(inProcessDir, { recursive: true });
  const itemPath = path.join(inProcessDir, 'a.handoff');
  fs.writeFileSync(itemPath, '', 'utf-8');
  writeNudgeCount(itemPath, 2);

  const items = scanInProcess(inProcessDir);
  assert.equal(items[0].nudgeCount, 2);
});

// ── respawnCooldownPath / readRespawnCooldownUntilMs / writeRespawnCooldownUntilMs (BL-087) ──

test('respawnCooldownPath resolves to a role-level marker sibling to inbox/new', () => {
  const inboxNewDir = '/tmp/example/.swarmforge/handoffs/inbox/new';
  assert.equal(
    respawnCooldownPath(inboxNewDir),
    '/tmp/example/.swarmforge/handoffs/inbox/respawn-cooldown.json'
  );
});

test('readRespawnCooldownUntilMs returns null when no marker exists', () => {
  const tmp = mkTmp();
  const inboxNewDir = path.join(tmp, 'inbox', 'new');
  fs.mkdirSync(inboxNewDir, { recursive: true });
  assert.equal(readRespawnCooldownUntilMs(inboxNewDir), null);
});

test('writeRespawnCooldownUntilMs then readRespawnCooldownUntilMs round-trips', () => {
  const tmp = mkTmp();
  const inboxNewDir = path.join(tmp, 'inbox', 'new');
  fs.mkdirSync(inboxNewDir, { recursive: true });
  writeRespawnCooldownUntilMs(inboxNewDir, NOW + 300_000);
  assert.equal(readRespawnCooldownUntilMs(inboxNewDir), NOW + 300_000);
});

test('readRespawnCooldownUntilMs returns null for a corrupt marker file', () => {
  const tmp = mkTmp();
  const inboxNewDir = path.join(tmp, 'inbox', 'new');
  fs.mkdirSync(inboxNewDir, { recursive: true });
  fs.writeFileSync(respawnCooldownPath(inboxNewDir), 'not-json', 'utf-8');
  assert.equal(readRespawnCooldownUntilMs(inboxNewDir), null);
});

// ── runSweep ──────────────────────────────────────────────────────────────────

const SWEEP_CFG = {
  chaseIntervalSeconds: 30,
  chaseTimeoutSeconds: 90,
  maxChases: 3,
  stuckInProcessTimeoutSeconds: 300,
  respawnCooldownSeconds: 600,
};

function mkRoleInbox(role) {
  const tmp = mkTmp();
  const inboxNewDir = path.join(tmp, 'inbox', 'new');
  const inProcessDir = path.join(tmp, 'inbox', 'in_process');
  fs.mkdirSync(inboxNewDir, { recursive: true });
  return { role, inboxNewDir, inProcessDir };
}

function writeAgedHandoff(inboxNewDir, name, ageSeconds, nowMs) {
  const filePath = path.join(inboxNewDir, name);
  fs.writeFileSync(filePath, '', 'utf-8');
  const mtime = new Date(nowMs - ageSeconds * 1000);
  fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

function mkAdapters(liveness, lastActivityMs = NOW) {
  const calls = { wakeUps: [], respawns: [], deadLetters: [] };
  return {
    calls,
    adapters: {
      getLiveness: () => liveness,
      sendWakeUp: (role) => calls.wakeUps.push(role),
      triggerRespawn: (role) => calls.respawns.push(role),
      logDeadLetter: (role, filePath) => calls.deadLetters.push({ role, filePath }),
      getLastActivityMs: () => lastActivityMs,
      onStuckEscalation: () => {},
    },
  };
}

test('runSweep chases a stale item for an alive recipient and bumps its chase count', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInbox('coder');
  const filePath = writeAgedHandoff(inboxNewDir, 'a.handoff', 120, NOW);
  const { calls, adapters } = mkAdapters('alive');

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.deepEqual(calls.wakeUps, ['coder']);
  assert.equal(calls.respawns.length, 0);
  assert.equal(calls.deadLetters.length, 0);
  assert.equal(readChaseCount(filePath), 1);
});

// BL-087: the chaser previously respawned a role on the very first stale
// sweep whenever liveness read 'dead'/'unknown'/'stuck' (which is what an
// absent heartbeat file always reports) — even while the role's pane/outbox
// showed activity moments ago. That is the false-positive respawn this bug
// fixes: recent activity must block respawn, and a dead-liveness role gets
// chased like any other until chase attempts are actually exhausted.
test('runSweep never respawns a dead-liveness role that is still showing recent activity — chases instead', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInbox('coder');
  writeAgedHandoff(inboxNewDir, 'a.handoff', 120, NOW);
  const { calls, adapters } = mkAdapters('dead', NOW); // active just now

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.deepEqual(calls.wakeUps, ['coder']);
  assert.equal(calls.respawns.length, 0);
  assert.equal(calls.deadLetters.length, 0);
});

// BL-087 no-false-respawn-03: only once chase attempts are exhausted for a
// role that has ALSO shown no recent pane/outbox activity does the chaser
// escalate to an actual respawn.
test('runSweep escalates to a respawn only once chase attempts are exhausted for a genuinely inactive dead role', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInbox('coder');
  const filePath = writeAgedHandoff(inboxNewDir, 'a.handoff', 120, NOW);
  writeChaseCount(filePath, 3); // == maxChases: chase escalation already exhausted
  const { calls, adapters } = mkAdapters('dead', NOW - 400_000); // idle well past stuckInProcessTimeoutSeconds

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.deepEqual(calls.respawns, ['coder']);
  assert.equal(calls.wakeUps.length, 0);
  assert.equal(calls.deadLetters.length, 0);
});

// BL-087 no-false-respawn-04: a respawn cannot loop even when the same stale
// item keeps qualifying on every subsequent sweep.
test('runSweep does not respawn again within the cooldown window after a respawn just fired', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInbox('coder');
  const filePath = writeAgedHandoff(inboxNewDir, 'a.handoff', 120, NOW);
  writeChaseCount(filePath, 3);
  const { calls, adapters } = mkAdapters('dead', NOW - 400_000);

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);
  assert.deepEqual(calls.respawns, ['coder']);

  // Same still-stale, still-inactive, still-dead item on the very next sweep.
  runSweep([{ role, inboxNewDir, inProcessDir }], NOW + 1000, SWEEP_CFG, adapters);

  assert.deepEqual(calls.respawns, ['coder'], 'no second respawn fired while cooling down');
  assert.equal(calls.wakeUps.length, 1, 'the cooldown-suppressed respawn is downgraded to a chase');
});

test('runSweep dead-letters an item at maxChases, renaming both the handoff and its sidecar', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInbox('coder');
  const filePath = writeAgedHandoff(inboxNewDir, 'a.handoff', 120, NOW);
  writeChaseCount(filePath, 3); // == maxChases
  const { calls, adapters } = mkAdapters('alive');

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.equal(calls.deadLetters.length, 1);
  assert.deepEqual(calls.deadLetters[0], { role: 'coder', filePath });
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(fs.existsSync(deadLetterPath(filePath)), true);
  assert.equal(fs.existsSync(sidecarPath(filePath)), false);
  assert.equal(fs.existsSync(sidecarPath(deadLetterPath(filePath))), true);
});

test('runSweep dead-letters an item with no sidecar without throwing', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInbox('coder');
  const filePath = writeAgedHandoff(inboxNewDir, 'a.handoff', 120, NOW);
  // Force dead-lettering without ever calling writeChaseCount, so no sidecar exists.
  const cfgZeroMaxChases = { ...SWEEP_CFG, maxChases: 0 };
  const { calls, adapters } = mkAdapters('alive');

  assert.doesNotThrow(() => runSweep([{ role, inboxNewDir, inProcessDir }], NOW, cfgZeroMaxChases, adapters));
  assert.equal(calls.deadLetters.length, 1);
  assert.equal(fs.existsSync(deadLetterPath(filePath)), true);
});

test('runSweep skips a fresh item and makes no adapter calls', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInbox('coder');
  const filePath = writeAgedHandoff(inboxNewDir, 'a.handoff', 10, NOW);
  const { calls, adapters } = mkAdapters('dead');

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.equal(calls.wakeUps.length, 0);
  assert.equal(calls.respawns.length, 0);
  assert.equal(calls.deadLetters.length, 0);
  assert.equal(fs.existsSync(filePath), true);
});

// ── runSweep cooldown gating (BL-082) ────────────────────────────────────────

test('runSweep suppresses wake/chase for a role cooling down', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInbox('coder');
  writeAgedHandoff(inboxNewDir, 'a.handoff', 120, NOW);
  const { calls, adapters } = mkAdapters('alive');
  adapters.getCooldownUntilMs = () => NOW + 60_000;

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.equal(calls.wakeUps.length, 0);
  assert.equal(calls.respawns.length, 0);
  assert.equal(calls.deadLetters.length, 0);
});

test('runSweep suppresses in_process nudges for a role cooling down', () => {
  const tmp = mkTmp();
  const inboxNewDir = path.join(tmp, 'inbox', 'new');
  const inProcessDir = path.join(tmp, 'inbox', 'in_process');
  fs.mkdirSync(inboxNewDir, { recursive: true });
  fs.mkdirSync(inProcessDir, { recursive: true });
  fs.writeFileSync(path.join(inProcessDir, 'a.handoff'), '', 'utf-8');
  const { calls, adapters } = mkAdapters('alive');
  adapters.getLastActivityMs = () => NOW - 10_000_000; // long idle, would normally nudge
  adapters.getCooldownUntilMs = () => NOW + 60_000;

  runSweep([{ role: 'coder', inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.equal(calls.wakeUps.length, 0);
});

test('runSweep sends exactly one wake when a role\'s cooldown just expired', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInbox('coder');
  const { calls, adapters } = mkAdapters('alive');
  adapters.getCooldownUntilMs = () => NOW - 1000; // already expired
  adapters.getCooldownWokenMarker = () => null; // not yet woken for this window
  const expiredNotifications = [];
  adapters.onCooldownExpired = (r, untilMs) => expiredNotifications.push({ r, untilMs });

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.deepEqual(calls.wakeUps, ['coder']);
  assert.deepEqual(expiredNotifications, [{ r: 'coder', untilMs: NOW - 1000 }]);
});

test('runSweep does not re-wake once already woken for the same cooldown window', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInbox('coder');
  const { calls, adapters } = mkAdapters('alive');
  adapters.getCooldownUntilMs = () => NOW - 1000;
  adapters.getCooldownWokenMarker = () => NOW - 1000; // already woken for this exact window

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.equal(calls.wakeUps.length, 0);
});

test('runSweep leaves non-cooldown roles unaffected while another role cools down', () => {
  const coderInbox = mkRoleInbox('coder');
  const cleanerInbox = mkRoleInbox('cleaner');
  writeAgedHandoff(coderInbox.inboxNewDir, 'a.handoff', 120, NOW);
  writeAgedHandoff(cleanerInbox.inboxNewDir, 'b.handoff', 120, NOW);

  const calls = { wakeUps: [], respawns: [] };
  const adapters = {
    getLiveness: () => 'alive',
    sendWakeUp: (r) => calls.wakeUps.push(r),
    triggerRespawn: (r) => calls.respawns.push(r),
    logDeadLetter: () => {},
    getLastActivityMs: () => NOW,
    onStuckEscalation: () => {},
    getCooldownUntilMs: (r) => (r === 'coder' ? NOW + 60_000 : null),
  };

  runSweep(
    [
      { role: 'coder', inboxNewDir: coderInbox.inboxNewDir, inProcessDir: coderInbox.inProcessDir },
      { role: 'cleaner', inboxNewDir: cleanerInbox.inboxNewDir, inProcessDir: cleanerInbox.inProcessDir },
    ],
    NOW,
    SWEEP_CFG,
    adapters
  );

  assert.deepEqual(calls.wakeUps, ['cleaner']);
});

test('runSweep processes multiple roles independently in one pass', () => {
  const coderInbox = mkRoleInbox('coder');
  const cleanerInbox = mkRoleInbox('cleaner');
  writeAgedHandoff(coderInbox.inboxNewDir, 'a.handoff', 120, NOW);
  // cleaner's chase escalation is already exhausted AND it shows no recent
  // activity, so (unlike coder) it is eligible to actually respawn (BL-087).
  const cleanerFilePath = writeAgedHandoff(cleanerInbox.inboxNewDir, 'b.handoff', 120, NOW);
  writeChaseCount(cleanerFilePath, 3);

  const livenessByRole = { coder: 'alive', cleaner: 'dead' };
  const lastActivityByRole = { coder: NOW, cleaner: NOW - 400_000 };
  const calls = { wakeUps: [], respawns: [] };
  const adapters = {
    getLiveness: (role) => livenessByRole[role],
    sendWakeUp: (role) => calls.wakeUps.push(role),
    triggerRespawn: (role) => calls.respawns.push(role),
    logDeadLetter: () => {},
    getLastActivityMs: (role) => lastActivityByRole[role],
    onStuckEscalation: () => {},
  };

  runSweep(
    [
      { role: 'coder', inboxNewDir: coderInbox.inboxNewDir, inProcessDir: coderInbox.inProcessDir },
      { role: 'cleaner', inboxNewDir: cleanerInbox.inboxNewDir, inProcessDir: cleanerInbox.inProcessDir },
    ],
    NOW,
    SWEEP_CFG,
    adapters
  );

  assert.deepEqual(calls.wakeUps, ['coder']);
  assert.deepEqual(calls.respawns, ['cleaner']);
});

test('runSweep wakes on cooldown expiry without throwing when getCooldownWokenMarker is not implemented', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInbox('coder');
  const { calls, adapters } = mkAdapters('alive');
  adapters.getCooldownUntilMs = () => NOW - 1000; // already expired
  // getCooldownWokenMarker deliberately omitted - adapter is optional (BL-082)

  assert.doesNotThrow(() => runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters));
  assert.deepEqual(calls.wakeUps, ['coder']);
});

test('runSweep wakes on cooldown expiry without throwing when onCooldownExpired is not implemented', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInbox('coder');
  const { calls, adapters } = mkAdapters('alive');
  adapters.getCooldownUntilMs = () => NOW - 1000; // already expired
  adapters.getCooldownWokenMarker = () => null;
  // onCooldownExpired deliberately omitted - adapter is optional (BL-082)

  assert.doesNotThrow(() => runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters));
  assert.deepEqual(calls.wakeUps, ['coder']);
});

// ── runSweep in_process reconciler (BL-067) ──────────────────────────────────

function mkRoleInboxWithInProcess(role) {
  const tmp = mkTmp();
  const inboxNewDir = path.join(tmp, 'inbox', 'new');
  const inProcessDir = path.join(tmp, 'inbox', 'in_process');
  fs.mkdirSync(inboxNewDir, { recursive: true });
  fs.mkdirSync(inProcessDir, { recursive: true });
  return { role, inboxNewDir, inProcessDir };
}

test('runSweep does nothing for a role with no in_process work', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInboxWithInProcess('coder');
  const { calls, adapters } = mkAdapters('alive');
  const escalations = [];
  adapters.onStuckEscalation = (r, escalated) => escalations.push({ r, escalated });

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.equal(calls.wakeUps.length, 0);
  assert.deepEqual(escalations, [{ r: 'coder', escalated: false }]);
});

test('runSweep never nudges an empty in_process dir even when getLastActivityMs looks long-idle', () => {
  // Distinguishes the real held.length === 0 short-circuit from a mutant
  // that always skips it: with no held items, Math.max() over an empty
  // array plus a long-idle activity timestamp would independently drive
  // decideStuckAction to 'nudge' (and a wake) if the short-circuit were
  // skipped.
  const { role, inboxNewDir, inProcessDir } = mkRoleInboxWithInProcess('coder');
  const { calls, adapters } = mkAdapters('alive');
  adapters.getLastActivityMs = () => NOW - 400_000;

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.equal(calls.wakeUps.length, 0);
});

test('runSweep never queries the cooldown-woken marker when the role has no cooldown at all', () => {
  // Distinguishes the real cooldownUntilMs == null short-circuit from a
  // mutant that always skips it: getCooldownWokenMarker must not be
  // invoked when there is no cooldown to check expiry against.
  const { role, inboxNewDir, inProcessDir } = mkRoleInboxWithInProcess('coder');
  const { adapters } = mkAdapters('alive');
  adapters.getCooldownUntilMs = () => null;
  let markerQueried = false;
  adapters.getCooldownWokenMarker = () => {
    markerQueried = true;
    return null;
  };

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.equal(markerQueried, false);
});

test('runSweep leaves an active in_process item alone (idle time below stuck timeout)', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInboxWithInProcess('coder');
  fs.writeFileSync(path.join(inProcessDir, 'a.handoff'), '', 'utf-8');
  const { calls, adapters } = mkAdapters('alive');
  adapters.getLastActivityMs = () => NOW; // active just now

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.equal(calls.wakeUps.length, 0);
});

test('runSweep nudges a stuck in_process role: wakes it and bumps every held item\'s nudge count', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInboxWithInProcess('coder');
  const itemPath = path.join(inProcessDir, 'a.handoff');
  fs.writeFileSync(itemPath, '', 'utf-8');
  const { calls, adapters } = mkAdapters('alive');
  adapters.getLastActivityMs = () => NOW - 400_000; // idle past stuckInProcessTimeoutSeconds
  const escalations = [];
  adapters.onStuckEscalation = (r, escalated) => escalations.push({ r, escalated });

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.deepEqual(calls.wakeUps, ['coder']);
  assert.equal(readNudgeCount(itemPath), 1);
  assert.deepEqual(escalations, [{ r: 'coder', escalated: false }]);
});

test('runSweep escalates (alerts, does not wake) once a stuck role\'s nudges reach maxChases', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInboxWithInProcess('coder');
  const itemPath = path.join(inProcessDir, 'a.handoff');
  fs.writeFileSync(itemPath, '', 'utf-8');
  writeNudgeCount(itemPath, 3); // == maxChases
  const { calls, adapters } = mkAdapters('alive');
  adapters.getLastActivityMs = () => NOW - 400_000;
  const escalations = [];
  adapters.onStuckEscalation = (r, escalated) => escalations.push({ r, escalated });

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.equal(calls.wakeUps.length, 0);
  assert.equal(readNudgeCount(itemPath), 3); // unchanged - alert does not bump nudges
  assert.deepEqual(escalations, [{ r: 'coder', escalated: true }]);
});

test('runSweep clears stale nudge counts once a previously-stuck role becomes active again', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInboxWithInProcess('coder');
  const itemPath = path.join(inProcessDir, 'a.handoff');
  fs.writeFileSync(itemPath, '', 'utf-8');
  writeNudgeCount(itemPath, 2);
  const { calls, adapters } = mkAdapters('alive');
  adapters.getLastActivityMs = () => NOW; // active again
  const escalations = [];
  adapters.onStuckEscalation = (r, escalated) => escalations.push({ r, escalated });

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  assert.equal(calls.wakeUps.length, 0);
  assert.equal(readNudgeCount(itemPath), 0);
  assert.deepEqual(escalations, [{ r: 'coder', escalated: false }]);
});

test('runSweep does not rewrite a nudge count that is already zero when clearing stale counts', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInboxWithInProcess('coder');
  const itemPath = path.join(inProcessDir, 'a.handoff');
  fs.writeFileSync(itemPath, '', 'utf-8');
  const { adapters } = mkAdapters('alive');
  adapters.getLastActivityMs = () => NOW;

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  // No nudge sidecar should have been created for an item that was never nudged.
  assert.equal(fs.existsSync(nudgePath(itemPath)), false);
});

test('runSweep uses the highest nudge count among multiple held in_process items', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInboxWithInProcess('coder');
  const batchDir = path.join(inProcessDir, 'batch_20260630T000000Z_000001');
  fs.mkdirSync(batchDir, { recursive: true });
  const itemA = path.join(batchDir, 'a.handoff');
  const itemB = path.join(batchDir, 'b.handoff');
  fs.writeFileSync(itemA, '', 'utf-8');
  fs.writeFileSync(itemB, '', 'utf-8');
  writeNudgeCount(itemA, 3); // already at maxChases
  writeNudgeCount(itemB, 0);
  const { calls, adapters } = mkAdapters('alive');
  adapters.getLastActivityMs = () => NOW - 400_000;
  const escalations = [];
  adapters.onStuckEscalation = (r, escalated) => escalations.push({ r, escalated });

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);

  // Max of (3, 0) is 3 → alerts, not a fresh nudge.
  assert.equal(calls.wakeUps.length, 0);
  assert.deepEqual(escalations, [{ r: 'coder', escalated: true }]);
});
