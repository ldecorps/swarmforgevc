/**
 * BL-022: InboxChaser — unit tests.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  decideItemAction,
  readChaseCount,
  writeChaseCount,
  readLastChasedAtMs,
  computeChaseBackoffSeconds,
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
  parseHandoffHeaderField,
  listDeadLettersForRole,
  listDeadLetters,
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

// BL-109: a recipient showing recent activity (actively generating a long
// turn) must never have its own queued mail dead-lettered, no matter how
// many chases have already been sent or what liveness reports — this is
// exactly the "busy, not stuck" case the sweep must keep chasing forever,
// letting the recipient's own idle-time ready_for_next.sh eventually see it.
test('recent activity keeps chasing even with dead liveness and chases exhausted → chased, never dead-lettered', () => {
  assert.equal(decideItemAction(STALE_MS, 3, NOW, CFG, 'dead', ACTIVE_MS), 'chased');
});

test('recent activity keeps chasing well past maxChases regardless of liveness → chased, never dead-lettered', () => {
  assert.equal(decideItemAction(STALE_MS, 50, NOW, CFG, 'alive', ACTIVE_MS), 'chased');
  assert.equal(decideItemAction(STALE_MS, 50, NOW, CFG, 'unknown', ACTIVE_MS), 'chased');
});

test('recent activity blocks respawn even with unknown liveness (missing heartbeat) below maxChases → chased', () => {
  assert.equal(decideItemAction(STALE_MS, 0, NOW, CFG, 'unknown', ACTIVE_MS), 'chased');
});

// idleSeconds must be computed as milliseconds / 1000 (not * 1000) - 30s of
// real elapsed time is well within the 60s stuckInProcessTimeoutSeconds and
// so must still count as "recent" and keep chasing rather than dead-letter.
test('idle seconds are computed from real elapsed milliseconds, not inflated', () => {
  const recentlyActiveMs = NOW - 30_000; // 30s ago, real seconds - within the 60s window
  assert.equal(decideItemAction(STALE_MS, 3, NOW, CFG, 'dead', recentlyActiveMs), 'chased');
});

// hasRecentActivity uses a strict "<" against stuckInProcessTimeoutSeconds:
// idle time exactly AT the threshold is no longer "recent" and must allow a
// respawn once chases are exhausted.
test('idle time exactly at the stuck threshold no longer counts as recent activity', () => {
  const exactlyAtThresholdMs = NOW - CFG.stuckInProcessTimeoutSeconds * 1000;
  assert.equal(decideItemAction(STALE_MS, 3, NOW, CFG, 'dead', exactlyAtThresholdMs), 'respawned');
});

// BL-135: a busy recipient's queued mail must be chased with a GROWING
// backoff, not on every sweep tick (98 nudges in ~16min at a 5s tick was the
// real-world bug). Once a chase has already been sent (lastChasedAtMs is
// known), decideItemAction must consult computeChaseBackoffSeconds instead
// of unconditionally re-chasing.
test('recent activity with a very recent prior chase is skipped, not re-chased', () => {
  const justChasedMs = NOW - 1_000; // 1s ago — nowhere near any backoff window
  assert.equal(decideItemAction(STALE_MS, 1, NOW, CFG, 'alive', ACTIVE_MS, justChasedMs), 'skipped');
});

test('recent activity re-chases once the backoff interval for that chaseCount has elapsed', () => {
  // computeChaseBackoffSeconds(1, CFG) = min(CFG.chaseIntervalSeconds * 2^1, CFG.stuckInProcessTimeoutSeconds)
  //                                    = min(60, 60) = 60
  const longAgoMs = NOW - 60_000;
  assert.equal(decideItemAction(STALE_MS, 1, NOW, CFG, 'alive', ACTIVE_MS, longAgoMs), 'chased');
});

test('recent activity with no prior recorded chase (lastChasedAtMs null) chases immediately', () => {
  assert.equal(decideItemAction(STALE_MS, 0, NOW, CFG, 'alive', ACTIVE_MS, null), 'chased');
});

test('backoff bounds a hammered note to far fewer chases than a fixed-interval hammer would produce', () => {
  // Simulate ~16 minutes of 5s-tick sweeps (the BL-135 incident's cadence)
  // against a recipient that stays busy the whole time, using the real
  // sidecar read/write path so chaseCount and lastChasedAtMs accumulate
  // exactly as production does.
  const tmp = mkTmp();
  const handoffPath = path.join(tmp, 'note.handoff');
  fs.writeFileSync(handoffPath, 'irrelevant body');

  const startMs = NOW;
  const totalTicks = (16 * 60) / 5; // 192 ticks at a 5s cadence
  let chaseTimes = 0;
  for (let tick = 0; tick < totalTicks; tick++) {
    const tickNowMs = startMs + tick * 5_000;
    const chaseCount = readChaseCount(handoffPath);
    const lastChasedAtMs = readLastChasedAtMs(handoffPath);
    const action = decideItemAction(STALE_MS, chaseCount, tickNowMs, CFG, 'alive', tickNowMs, lastChasedAtMs);
    if (action === 'chased') {
      chaseTimes++;
      writeChaseCount(handoffPath, chaseCount + 1, tickNowMs);
    }
  }

  // CFG's default backoff cap (stuckInProcessTimeoutSeconds = 60s) bounds
  // the steady-state rate to roughly one chase per 60s once the doubling
  // interval saturates, i.e. ~16 over 16 minutes — night and day versus the
  // fixed-5s-tick hammer that produced the real ~98/16min incident.
  assert.ok(
    chaseTimes <= 20,
    `expected far fewer than the ~98 hammer chases over 16min, got ${chaseTimes}`
  );
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

// ── readLastChasedAtMs / writeChaseCount(..., lastChasedAtMs) — BL-135 ─────────

test('readLastChasedAtMs returns null when sidecar absent', () => {
  const tmp = mkTmp();
  const handoffPath = path.join(tmp, 'test.handoff');
  assert.equal(readLastChasedAtMs(handoffPath), null);
});

test('writeChaseCount with a lastChasedAtMs round-trips both fields', () => {
  const tmp = mkTmp();
  const handoffPath = path.join(tmp, 'test.handoff');
  writeChaseCount(handoffPath, 3, 1_700_000_000_000);
  assert.equal(readChaseCount(handoffPath), 3);
  assert.equal(readLastChasedAtMs(handoffPath), 1_700_000_000_000);
});

test('writeChaseCount without lastChasedAtMs preserves a previously recorded one', () => {
  const tmp = mkTmp();
  const handoffPath = path.join(tmp, 'test.handoff');
  writeChaseCount(handoffPath, 1, 1_700_000_000_000);
  writeChaseCount(handoffPath, 2); // no lastChasedAtMs passed this time
  assert.equal(readChaseCount(handoffPath), 2);
  assert.equal(readLastChasedAtMs(handoffPath), 1_700_000_000_000);
});

// ── computeChaseBackoffSeconds (pure) — BL-135 ─────────────────────────────────

test('computeChaseBackoffSeconds doubles per chase, capped at chaseBackoffMaxSeconds default', () => {
  // base defaults to chaseIntervalSeconds (30), max defaults to
  // stuckInProcessTimeoutSeconds (60) when the optional fields are omitted.
  assert.equal(computeChaseBackoffSeconds(0, CFG), 30);
  assert.equal(computeChaseBackoffSeconds(1, CFG), 60);
  assert.equal(computeChaseBackoffSeconds(5, CFG), 60); // capped
});

test('computeChaseBackoffSeconds honors explicit base/max overrides', () => {
  const cfg = { ...CFG, chaseBackoffBaseSeconds: 10, chaseBackoffMaxSeconds: 200 };
  assert.equal(computeChaseBackoffSeconds(0, cfg), 10);
  assert.equal(computeChaseBackoffSeconds(2, cfg), 40);
  assert.equal(computeChaseBackoffSeconds(10, cfg), 200); // capped
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

test('scanInboxNew reads lastChasedAtMs from sidecar, null when never chased', () => {
  const tmp = mkTmp();
  const inboxNew = path.join(tmp, 'inbox', 'new');
  fs.mkdirSync(inboxNew, { recursive: true });
  const neverChased = path.join(inboxNew, 'never.handoff');
  const chased = path.join(inboxNew, 'chased.handoff');
  fs.writeFileSync(neverChased, '', 'utf-8');
  fs.writeFileSync(chased, '', 'utf-8');
  writeChaseCount(chased, 1, 1_700_000_000_000);

  const items = scanInboxNew(inboxNew, NOW);
  const neverItem = items.find((i) => i.filePath === neverChased);
  const chasedItem = items.find((i) => i.filePath === chased);
  assert.equal(neverItem.lastChasedAtMs, null);
  assert.equal(chasedItem.lastChasedAtMs, 1_700_000_000_000);
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

test('readRespawnCooldownUntilMs returns null when untilMs is valid JSON but not a number', () => {
  const tmp = mkTmp();
  const inboxNewDir = path.join(tmp, 'inbox', 'new');
  fs.mkdirSync(inboxNewDir, { recursive: true });
  fs.writeFileSync(respawnCooldownPath(inboxNewDir), JSON.stringify({ untilMs: 'soon' }), 'utf-8');
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

// BL-135: the runSweep wiring (sweepRoleInbox -> decideItemAction ->
// applyInboxItemAction) must actually carry lastChasedAtMs through two real
// sweeps, not just the pure decideItemAction unit above. A second sweep run
// moments after the first, against a recipient still showing activity, must
// be suppressed by the backoff rather than re-chasing on every tick.
test('runSweep suppresses a second chase of a busy recipient within the backoff window, then chases again once it elapses', () => {
  const { role, inboxNewDir, inProcessDir } = mkRoleInbox('coder');
  const filePath = writeAgedHandoff(inboxNewDir, 'a.handoff', 120, NOW);
  const { calls, adapters } = mkAdapters('alive', NOW);

  runSweep([{ role, inboxNewDir, inProcessDir }], NOW, SWEEP_CFG, adapters);
  assert.deepEqual(calls.wakeUps, ['coder']);
  assert.equal(readChaseCount(filePath), 1);

  // 5s later - well inside the backoff window for chaseCount=1
  // (min(30*2^1, 300) = 60s) - must be skipped, not re-chased.
  runSweep([{ role, inboxNewDir, inProcessDir }], NOW + 5_000, SWEEP_CFG, adapters);
  assert.deepEqual(calls.wakeUps, ['coder']);
  assert.equal(readChaseCount(filePath), 1);

  // 61s after the first chase - backoff has elapsed, so the sweep chases again.
  runSweep([{ role, inboxNewDir, inProcessDir }], NOW + 61_000, SWEEP_CFG, adapters);
  assert.deepEqual(calls.wakeUps, ['coder', 'coder']);
  assert.equal(readChaseCount(filePath), 2);
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
  // BL-109: dead-lettering requires NO recent activity - a busy recipient
  // must never be dead-lettered regardless of chase count or liveness.
  const { calls, adapters } = mkAdapters('alive', NOW - 400_000);

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
  const { calls, adapters } = mkAdapters('alive', NOW - 400_000);

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

// ── dead-letter visibility (BL-109 dead-letter-visible-03) ──────────────────
// A dead-lettered handoff was previously invisible debris: renamed to
// <name>.handoff.dead next to a .chase.json sidecar nothing ever read back.
// listDeadLetters makes it discoverable — who it was for, what it was.

test('parseHandoffHeaderField extracts a named header value', () => {
  const content = 'type: git_handoff\nto: coder\nrecipient: coder\ntask: BL-109\n';
  assert.equal(parseHandoffHeaderField(content, 'type'), 'git_handoff');
  assert.equal(parseHandoffHeaderField(content, 'task'), 'BL-109');
});

test('parseHandoffHeaderField trims trailing whitespace off the captured value', () => {
  const content = 'task: BL-109   \n';
  assert.equal(parseHandoffHeaderField(content, 'task'), 'BL-109');
});

test('parseHandoffHeaderField returns undefined for a missing header', () => {
  assert.equal(parseHandoffHeaderField('type: note\n', 'task'), undefined);
});

test('listDeadLettersForRole returns empty array when the inbox does not exist', () => {
  assert.deepEqual(listDeadLettersForRole('coder', path.join(mkTmp(), 'inbox', 'new')), []);
});

test('listDeadLettersForRole ignores live (non-dead) handoffs', () => {
  const { inboxNewDir } = mkRoleInbox('coder');
  writeAgedHandoff(inboxNewDir, 'a.handoff', 10, NOW);
  assert.deepEqual(listDeadLettersForRole('coder', inboxNewDir), []);
});

test('listDeadLettersForRole surfaces a dead-lettered handoff with its header fields and chase count', () => {
  const { inboxNewDir } = mkRoleInbox('coder');
  const deadPath = path.join(inboxNewDir, 'a.handoff.dead');
  fs.writeFileSync(
    deadPath,
    'type: git_handoff\nfrom: specifier\nto: coder\nrecipient: coder\ntask: BL-109\n',
    'utf-8'
  );
  writeChaseCount(deadPath, 3);

  const found = listDeadLettersForRole('coder', inboxNewDir);
  assert.equal(found.length, 1);
  assert.equal(found[0].role, 'coder');
  assert.equal(found[0].filePath, deadPath);
  assert.equal(found[0].from, 'specifier');
  assert.equal(found[0].recipient, 'coder');
  assert.equal(found[0].type, 'git_handoff');
  assert.equal(found[0].task, 'BL-109');
  assert.equal(found[0].chaseCount, 3);
});

test('listDeadLettersForRole defaults chaseCount to 0 when there is no sidecar', () => {
  const { inboxNewDir } = mkRoleInbox('coder');
  const deadPath = path.join(inboxNewDir, 'a.handoff.dead');
  fs.writeFileSync(deadPath, 'type: note\nrecipient: coder\n', 'utf-8');

  const found = listDeadLettersForRole('coder', inboxNewDir);
  assert.equal(found[0].chaseCount, 0);
});

test('listDeadLetters aggregates dead letters across every role inbox', () => {
  const coderInbox = mkRoleInbox('coder');
  const cleanerInbox = mkRoleInbox('cleaner');
  fs.writeFileSync(path.join(coderInbox.inboxNewDir, 'a.handoff.dead'), 'type: note\nrecipient: coder\n', 'utf-8');
  fs.writeFileSync(path.join(cleanerInbox.inboxNewDir, 'b.handoff.dead'), 'type: note\nrecipient: cleaner\n', 'utf-8');

  const found = listDeadLetters([coderInbox, cleanerInbox]);
  assert.deepEqual(
    found.map((d) => d.role).sort(),
    ['cleaner', 'coder']
  );
});
