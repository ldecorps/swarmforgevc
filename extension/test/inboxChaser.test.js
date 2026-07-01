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
} = require('../out/swarm/inboxChaser');

const CFG = { chaseIntervalSeconds: 30, chaseTimeoutSeconds: 90, maxChases: 3 };
const NOW = new Date('2026-06-30T10:00:00Z').getTime();
const STALE_MS = NOW - 120_000; // 2 minutes old — past chaseTimeoutSeconds
const FRESH_MS = NOW - 30_000;  // 30s old — within chaseTimeoutSeconds

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-inbox-chaser-'));
}

// ── decideItemAction (pure) ───────────────────────────────────────────────────

test('stale item with alive recipient and 0 chases → chased', () => {
  assert.equal(decideItemAction(STALE_MS, 0, NOW, CFG, 'alive'), 'chased');
});

test('stale item with idle recipient and 0 chases → chased', () => {
  assert.equal(decideItemAction(STALE_MS, 0, NOW, CFG, 'idle'), 'chased');
});

test('fresh item (not yet stale) → skipped regardless of liveness', () => {
  assert.equal(decideItemAction(FRESH_MS, 0, NOW, CFG, 'alive'), 'skipped');
});

test('stale item with dead recipient → respawned', () => {
  assert.equal(decideItemAction(STALE_MS, 0, NOW, CFG, 'dead'), 'respawned');
});

test('stale item with unknown recipient → respawned', () => {
  assert.equal(decideItemAction(STALE_MS, 0, NOW, CFG, 'unknown'), 'respawned');
});

test('stale item with stuck recipient → respawned', () => {
  assert.equal(decideItemAction(STALE_MS, 0, NOW, CFG, 'stuck'), 'respawned');
});

test('stale item at maxChases → dead-lettered', () => {
  assert.equal(decideItemAction(STALE_MS, 3, NOW, CFG, 'alive'), 'dead-lettered');
});

test('stale item beyond maxChases → dead-lettered', () => {
  assert.equal(decideItemAction(STALE_MS, 5, NOW, CFG, 'alive'), 'dead-lettered');
});

test('dead recipient at maxChases → dead-lettered (escalation over respawn)', () => {
  assert.equal(decideItemAction(STALE_MS, 3, NOW, CFG, 'dead'), 'dead-lettered');
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

// ── runSweep ──────────────────────────────────────────────────────────────────

const SWEEP_CFG = { chaseIntervalSeconds: 30, chaseTimeoutSeconds: 90, maxChases: 3, stuckInProcessTimeoutSeconds: 300 };

function mkRoleInbox(role) {
  const tmp = mkTmp();
  const inboxNewDir = path.join(tmp, 'inbox', 'new');
  fs.mkdirSync(inboxNewDir, { recursive: true });
  return { role, inboxNewDir };
}

function writeAgedHandoff(inboxNewDir, name, ageSeconds, nowMs) {
  const filePath = path.join(inboxNewDir, name);
  fs.writeFileSync(filePath, '', 'utf-8');
  const mtime = new Date(nowMs - ageSeconds * 1000);
  fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

function mkAdapters(liveness) {
  const calls = { wakeUps: [], respawns: [], deadLetters: [] };
  return {
    calls,
    adapters: {
      getLiveness: () => liveness,
      sendWakeUp: (role) => calls.wakeUps.push(role),
      triggerRespawn: (role) => calls.respawns.push(role),
      logDeadLetter: (role, filePath) => calls.deadLetters.push({ role, filePath }),
    },
  };
}

test('runSweep chases a stale item for an alive recipient and bumps its chase count', () => {
  const { role, inboxNewDir } = mkRoleInbox('coder');
  const filePath = writeAgedHandoff(inboxNewDir, 'a.handoff', 120, NOW);
  const { calls, adapters } = mkAdapters('alive');

  runSweep([{ role, inboxNewDir }], NOW, SWEEP_CFG, adapters);

  assert.deepEqual(calls.wakeUps, ['coder']);
  assert.equal(calls.respawns.length, 0);
  assert.equal(calls.deadLetters.length, 0);
  assert.equal(readChaseCount(filePath), 1);
});

test('runSweep triggers a respawn for a stale item when the recipient is dead', () => {
  const { role, inboxNewDir } = mkRoleInbox('coder');
  writeAgedHandoff(inboxNewDir, 'a.handoff', 120, NOW);
  const { calls, adapters } = mkAdapters('dead');

  runSweep([{ role, inboxNewDir }], NOW, SWEEP_CFG, adapters);

  assert.deepEqual(calls.respawns, ['coder']);
  assert.equal(calls.wakeUps.length, 0);
  assert.equal(calls.deadLetters.length, 0);
});

test('runSweep dead-letters an item at maxChases, renaming both the handoff and its sidecar', () => {
  const { role, inboxNewDir } = mkRoleInbox('coder');
  const filePath = writeAgedHandoff(inboxNewDir, 'a.handoff', 120, NOW);
  writeChaseCount(filePath, 3); // == maxChases
  const { calls, adapters } = mkAdapters('alive');

  runSweep([{ role, inboxNewDir }], NOW, SWEEP_CFG, adapters);

  assert.equal(calls.deadLetters.length, 1);
  assert.deepEqual(calls.deadLetters[0], { role: 'coder', filePath });
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(fs.existsSync(deadLetterPath(filePath)), true);
  assert.equal(fs.existsSync(sidecarPath(filePath)), false);
  assert.equal(fs.existsSync(sidecarPath(deadLetterPath(filePath))), true);
});

test('runSweep dead-letters an item with no sidecar without throwing', () => {
  const { role, inboxNewDir } = mkRoleInbox('coder');
  const filePath = writeAgedHandoff(inboxNewDir, 'a.handoff', 120, NOW);
  // Force dead-lettering without ever calling writeChaseCount, so no sidecar exists.
  const cfgZeroMaxChases = { ...SWEEP_CFG, maxChases: 0 };
  const { calls, adapters } = mkAdapters('alive');

  assert.doesNotThrow(() => runSweep([{ role, inboxNewDir }], NOW, cfgZeroMaxChases, adapters));
  assert.equal(calls.deadLetters.length, 1);
  assert.equal(fs.existsSync(deadLetterPath(filePath)), true);
});

test('runSweep skips a fresh item and makes no adapter calls', () => {
  const { role, inboxNewDir } = mkRoleInbox('coder');
  const filePath = writeAgedHandoff(inboxNewDir, 'a.handoff', 10, NOW);
  const { calls, adapters } = mkAdapters('dead');

  runSweep([{ role, inboxNewDir }], NOW, SWEEP_CFG, adapters);

  assert.equal(calls.wakeUps.length, 0);
  assert.equal(calls.respawns.length, 0);
  assert.equal(calls.deadLetters.length, 0);
  assert.equal(fs.existsSync(filePath), true);
});

test('runSweep processes multiple roles independently in one pass', () => {
  const coderInbox = mkRoleInbox('coder');
  const cleanerInbox = mkRoleInbox('cleaner');
  writeAgedHandoff(coderInbox.inboxNewDir, 'a.handoff', 120, NOW);
  writeAgedHandoff(cleanerInbox.inboxNewDir, 'b.handoff', 120, NOW);

  const livenessByRole = { coder: 'alive', cleaner: 'dead' };
  const calls = { wakeUps: [], respawns: [] };
  const adapters = {
    getLiveness: (role) => livenessByRole[role],
    sendWakeUp: (role) => calls.wakeUps.push(role),
    triggerRespawn: (role) => calls.respawns.push(role),
    logDeadLetter: () => {},
  };

  runSweep(
    [
      { role: 'coder', inboxNewDir: coderInbox.inboxNewDir },
      { role: 'cleaner', inboxNewDir: cleanerInbox.inboxNewDir },
    ],
    NOW,
    SWEEP_CFG,
    adapters
  );

  assert.deepEqual(calls.wakeUps, ['coder']);
  assert.deepEqual(calls.respawns, ['cleaner']);
});
