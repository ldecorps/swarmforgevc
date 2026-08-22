const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { leanLedgerDir, leanLedgerFilePath, snapshotFilePath, readLeanLedgerEvents, appendLeanLedgerEventIfNew, readLeanLedgerSnapshot, writeLeanLedgerSnapshotFor } = require('../out/metrics/leanLedgerStore');

// BL-819: the impure read/write layer - .swarmforge/lean/<yyyy-MM-dd>.jsonl
// (day-bucketed, mirroring bounceStore.ts's month-bucketed convention; see
// leanLedgerStore.ts's own header comment for why day, not a real shift),
// plus a per-ticket latest-snapshot file that is always a pure fold
// (leanLedger.ts's foldLeanLedgerSnapshot), never an independent writer.

function mkTmp() {
  return mkTmpDir('sfvc-lean-ledger-store-');
}

function event(overrides = {}) {
  return {
    ticket: 'BL-819',
    type: 'stage_transition',
    source: 'stage-dwell',
    at: '2026-08-07T10:00:00.000Z',
    role: 'coder',
    data: { queueWaitMs: 1000, processingMs: 5000 },
    ...overrides,
  };
}

test('reading from a target with no lean dir at all returns an empty array', () => {
  const target = mkTmp();
  assert.deepEqual(readLeanLedgerEvents(target), []);
});

test('appending writes into a day-bucketed file under .swarmforge/lean/', () => {
  const target = mkTmp();
  const appended = appendLeanLedgerEventIfNew(target, event());
  assert.equal(appended, true);
  assert.equal(fs.existsSync(path.join(leanLedgerDir(target), '2026-08-07.jsonl')), true);
  assert.deepEqual(readLeanLedgerEvents(target), [event()]);
});

test('leanLedgerFilePath buckets by the event\'s own `at` date, not wall clock', () => {
  const target = mkTmp();
  assert.equal(leanLedgerFilePath(target, '2026-01-15T23:59:59.000Z'), path.join(leanLedgerDir(target), '2026-01-15.jsonl'));
});

test('re-appending the identical event is a no-op (idempotent on the natural key) - invariant 1', () => {
  const target = mkTmp();
  assert.equal(appendLeanLedgerEventIfNew(target, event()), true);
  assert.equal(appendLeanLedgerEventIfNew(target, event()), false);
  assert.equal(readLeanLedgerEvents(target).length, 1);
});

test('two distinct events for the same ticket on the same day both append', () => {
  const target = mkTmp();
  assert.equal(appendLeanLedgerEventIfNew(target, event({ role: 'coder' })), true);
  assert.equal(appendLeanLedgerEventIfNew(target, event({ role: 'cleaner', at: '2026-08-07T11:00:00.000Z' })), true);
  assert.equal(readLeanLedgerEvents(target).length, 2);
});

test('events on different days land in different files but both read back together', () => {
  const target = mkTmp();
  appendLeanLedgerEventIfNew(target, event({ at: '2026-08-07T10:00:00.000Z' }));
  appendLeanLedgerEventIfNew(target, event({ at: '2026-08-08T10:00:00.000Z', role: 'cleaner' }));
  assert.equal(fs.existsSync(path.join(leanLedgerDir(target), '2026-08-07.jsonl')), true);
  assert.equal(fs.existsSync(path.join(leanLedgerDir(target), '2026-08-08.jsonl')), true);
  assert.equal(readLeanLedgerEvents(target).length, 2);
});

test('an event failing shape validation (invented data key) is refused, never written', () => {
  const target = mkTmp();
  const bad = event({ data: { queueWaitMs: 1000, processingMs: 5000, llmSummary: 'nope' } });
  assert.throws(() => appendLeanLedgerEventIfNew(target, bad));
  assert.deepEqual(readLeanLedgerEvents(target), []);
});

test('a malformed line in a ledger file is skipped, never a crash', () => {
  const target = mkTmp();
  fs.mkdirSync(leanLedgerDir(target), { recursive: true });
  fs.writeFileSync(path.join(leanLedgerDir(target), '2026-08-07.jsonl'), 'not json\n' + JSON.stringify(event()) + '\n');
  assert.deepEqual(readLeanLedgerEvents(target), [event()]);
});

test('readLeanLedgerEvents can filter to one ticket', () => {
  const target = mkTmp();
  appendLeanLedgerEventIfNew(target, event({ ticket: 'BL-819' }));
  appendLeanLedgerEventIfNew(target, event({ ticket: 'BL-820', at: '2026-08-07T12:00:00.000Z' }));
  assert.equal(readLeanLedgerEvents(target, 'BL-819').length, 1);
  assert.equal(readLeanLedgerEvents(target).length, 2);
});

// ── per-ticket snapshot: pure fold, written to its own file ────────────

test('writeLeanLedgerSnapshotFor writes the fold of exactly that ticket\'s events, and reading it back matches', () => {
  const target = mkTmp();
  appendLeanLedgerEventIfNew(target, event({ ticket: 'BL-819' }));
  appendLeanLedgerEventIfNew(target, event({ ticket: 'BL-820', at: '2026-08-07T12:00:00.000Z' }));
  const snapshot = writeLeanLedgerSnapshotFor(target, 'BL-819');
  assert.equal(snapshot.ticket, 'BL-819');
  assert.equal(snapshot.dwell.length, 1);
  assert.equal(fs.existsSync(snapshotFilePath(target, 'BL-819')), true);
  assert.deepEqual(readLeanLedgerSnapshot(target, 'BL-819'), snapshot);
});

test('reading a snapshot for a ticket with no events returns null, never a fabricated empty file read as real', () => {
  const target = mkTmp();
  assert.equal(readLeanLedgerSnapshot(target, 'BL-999'), null);
});

test('re-running writeLeanLedgerSnapshotFor after a duplicate append produces the byte-identical snapshot - invariant 1', () => {
  const target = mkTmp();
  appendLeanLedgerEventIfNew(target, event());
  const first = writeLeanLedgerSnapshotFor(target, 'BL-819');
  appendLeanLedgerEventIfNew(target, event()); // duplicate, refused
  const second = writeLeanLedgerSnapshotFor(target, 'BL-819');
  assert.deepEqual(first, second);
});
