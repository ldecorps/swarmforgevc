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
  const items = scanInboxNew(path.join(tmp, 'nonexistent'), NOW);
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
