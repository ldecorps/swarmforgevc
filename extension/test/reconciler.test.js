/**
 * BL-023: Reconciler (in_process-stuck + done-but-undelivered) — unit tests.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  nudgePath,
  readNudgeCount,
  writeNudgeCount,
  scanInProcess,
  decideStuckAction,
  isDoneButUndelivered,
} = require('../out/swarm/inboxChaser');

const NOW = new Date('2026-06-30T12:00:00Z').getTime();
const STUCK_TIMEOUT = 180; // seconds
const MAX_CHASES = 3;
const CFG = { chaseIntervalSeconds: 30, chaseTimeoutSeconds: 90, maxChases: MAX_CHASES, stuckInProcessTimeoutSeconds: STUCK_TIMEOUT };

const STALE_MS = NOW - (STUCK_TIMEOUT + 60) * 1000; // past stuck timeout
const FRESH_MS = NOW - 60_000; // 1 minute — still within timeout

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-reconciler-'));
}

// ── nudgePath ──────────────────────────────────────────────────────────────────

test('nudgePath appends .nudge to item path', () => {
  const result = nudgePath('/path/to/item.handoff');
  assert.equal(result, '/path/to/item.handoff.nudge');
});

// ── readNudgeCount / writeNudgeCount ──────────────────────────────────────────

test('readNudgeCount returns 0 when sidecar absent', () => {
  const tmp = mkTmp();
  assert.equal(readNudgeCount(path.join(tmp, 'item.handoff')), 0);
});

test('writeNudgeCount then readNudgeCount round-trips', () => {
  const tmp = mkTmp();
  const itemPath = path.join(tmp, 'item.handoff');
  writeNudgeCount(itemPath, 2);
  assert.equal(readNudgeCount(itemPath), 2);
});

test('readNudgeCount returns 0 for corrupt sidecar', () => {
  const tmp = mkTmp();
  const itemPath = path.join(tmp, 'item.handoff');
  fs.writeFileSync(nudgePath(itemPath), 'bad-json', 'utf-8');
  assert.equal(readNudgeCount(itemPath), 0);
});

// ── scanInProcess ──────────────────────────────────────────────────────────────

test('scanInProcess returns empty array when directory absent', () => {
  const tmp = mkTmp();
  const items = scanInProcess(path.join(tmp, 'nonexistent'));
  assert.deepEqual(items, []);
});

test('scanInProcess returns .handoff files directly under in_process', () => {
  const tmp = mkTmp();
  const inProc = path.join(tmp, 'in_process');
  fs.mkdirSync(inProc, { recursive: true });
  fs.writeFileSync(path.join(inProc, 'item.handoff'), '', 'utf-8');
  fs.writeFileSync(path.join(inProc, 'item.txt'), '', 'utf-8');

  const items = scanInProcess(inProc);
  assert.equal(items.length, 1);
  assert.ok(items[0].filePath.endsWith('item.handoff'));
});

test('scanInProcess includes .handoff files inside batch_* subdirectories', () => {
  const tmp = mkTmp();
  const inProc = path.join(tmp, 'in_process');
  const batchDir = path.join(inProc, 'batch_20260630T000000Z_abc');
  fs.mkdirSync(batchDir, { recursive: true });
  fs.writeFileSync(path.join(batchDir, 'item.handoff'), '', 'utf-8');

  const items = scanInProcess(inProc);
  assert.equal(items.length, 1);
  assert.ok(items[0].filePath.endsWith('item.handoff'));
});

test('scanInProcess reads nudge count from sidecar', () => {
  const tmp = mkTmp();
  const inProc = path.join(tmp, 'in_process');
  fs.mkdirSync(inProc, { recursive: true });
  const itemPath = path.join(inProc, 'item.handoff');
  fs.writeFileSync(itemPath, '', 'utf-8');
  writeNudgeCount(itemPath, 1);

  const items = scanInProcess(inProc);
  assert.equal(items[0].nudgeCount, 1);
});

// ── decideStuckAction ─────────────────────────────────────────────────────────

test('item within timeout → skipped', () => {
  assert.equal(decideStuckAction(FRESH_MS, 0, NOW, CFG), 'skipped');
});

test('stale item with 0 nudges → nudge', () => {
  assert.equal(decideStuckAction(STALE_MS, 0, NOW, CFG), 'nudge');
});

test('stale item with nudgeCount < maxChases → nudge', () => {
  assert.equal(decideStuckAction(STALE_MS, 2, NOW, CFG), 'nudge');
});

test('stale item with nudgeCount >= maxChases → alert', () => {
  assert.equal(decideStuckAction(STALE_MS, MAX_CHASES, NOW, CFG), 'alert');
});

test('stale item with nudgeCount beyond maxChases → alert', () => {
  assert.equal(decideStuckAction(STALE_MS, MAX_CHASES + 2, NOW, CFG), 'alert');
});

// ── isDoneButUndelivered ──────────────────────────────────────────────────────

test('isDoneButUndelivered: no in_process items → false', () => {
  const result = isDoneButUndelivered(
    [],           // inProcessItems (empty)
    0,            // latestCommitMs (irrelevant)
    0,            // lastSentMs
    NOW,
    CFG
  );
  assert.equal(result, false);
});

test('isDoneButUndelivered: in_process exists but commit not newer than lastSent → false', () => {
  const commitMs = NOW - 500_000; // older than lastSent
  const lastSentMs = NOW - 100_000;
  const items = [{ filePath: '/fake/item.handoff', mtimeMs: STALE_MS, nudgeCount: 0 }];
  assert.equal(isDoneButUndelivered(items, commitMs, lastSentMs, NOW, CFG), false);
});

test('isDoneButUndelivered: in_process exists, commit newer than lastSent, age past timeout → true', () => {
  const lastSentMs = NOW - 500_000;
  const commitMs = NOW - (STUCK_TIMEOUT + 60) * 1000; // past timeout
  const items = [{ filePath: '/fake/item.handoff', mtimeMs: STALE_MS, nudgeCount: 0 }];
  assert.equal(isDoneButUndelivered(items, commitMs, lastSentMs, NOW, CFG), true);
});

test('isDoneButUndelivered: commit newer than lastSent but age within timeout → false', () => {
  const lastSentMs = NOW - 500_000;
  const commitMs = NOW - 60_000; // within stuckInProcessTimeoutSeconds
  const items = [{ filePath: '/fake/item.handoff', mtimeMs: FRESH_MS, nudgeCount: 0 }];
  assert.equal(isDoneButUndelivered(items, commitMs, lastSentMs, NOW, CFG), false);
});
