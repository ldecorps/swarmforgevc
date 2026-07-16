const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { observatorySignalsPath, persistReworkSignal, readReworkSignalEntry, readReworkSignal } = require('../out/metrics/reworkObservatoryStore');

function mkTmp() {
  return mkTmpDir('sfvc-observatory-store-');
}

function readSignals(targetPath) {
  return JSON.parse(fs.readFileSync(observatorySignalsPath(targetPath), 'utf8')).signals;
}

test('persistReworkSignal creates the signals file on first write', () => {
  const target = mkTmp();
  persistReworkSignal(target, { kind: 'rework-rate', version: 1, computedAtIso: '2026-07-15T00:00:00Z', foo: 'bar' });
  assert.equal(fs.existsSync(observatorySignalsPath(target)), true);
  assert.deepEqual(readSignals(target), [{ kind: 'rework-rate', version: 1, computedAtIso: '2026-07-15T00:00:00Z', foo: 'bar' }]);
});

test('persistReworkSignal upserts by kind - a second write of the same kind replaces the first, not appends', () => {
  const target = mkTmp();
  persistReworkSignal(target, { kind: 'rework-rate', version: 1, computedAtIso: '2026-07-15T00:00:00Z' });
  persistReworkSignal(target, { kind: 'rework-rate', version: 1, computedAtIso: '2026-07-16T00:00:00Z' });
  const signals = readSignals(target);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].computedAtIso, '2026-07-16T00:00:00Z');
});

test('persistReworkSignal preserves a DIFFERENT kind\'s entry untouched - the additive-schema requirement', () => {
  const target = mkTmp();
  persistReworkSignal(target, { kind: 'rework-rate', version: 1, computedAtIso: '2026-07-15T00:00:00Z' });
  persistReworkSignal(target, { kind: 'bottleneck-dwell', version: 1, computedAtIso: '2026-07-15T01:00:00Z' });
  const signals = readSignals(target);
  assert.equal(signals.length, 2);
  assert.ok(signals.some((s) => s.kind === 'rework-rate'));
  assert.ok(signals.some((s) => s.kind === 'bottleneck-dwell'));
});

test('persistReworkSignal recovers from a corrupt/unparseable existing file rather than crashing', () => {
  const target = mkTmp();
  fs.mkdirSync(path.dirname(observatorySignalsPath(target)), { recursive: true });
  fs.writeFileSync(observatorySignalsPath(target), 'not json');

  persistReworkSignal(target, { kind: 'rework-rate', version: 1, computedAtIso: '2026-07-15T00:00:00Z' });

  assert.deepEqual(readSignals(target), [{ kind: 'rework-rate', version: 1, computedAtIso: '2026-07-15T00:00:00Z' }]);
});

// Sibling of the corrupt/unparseable case above - this one IS valid JSON
// (JSON.parse succeeds) but not the expected {signals: [...]} shape, which
// is a distinct guard (Array.isArray(parsed.signals)) from the try/catch
// around JSON.parse itself. Without this test, a mutant collapsing that
// guard to `if (true)` survives - the wrong-shape file would then reach
// `file.signals.filter(...)` on a non-array and crash instead of starting
// fresh.
test('persistReworkSignal recovers from a valid-JSON file with the wrong shape rather than crashing', () => {
  const target = mkTmp();
  fs.mkdirSync(path.dirname(observatorySignalsPath(target)), { recursive: true });
  fs.writeFileSync(observatorySignalsPath(target), JSON.stringify({ notSignals: true }));

  persistReworkSignal(target, { kind: 'rework-rate', version: 1, computedAtIso: '2026-07-15T00:00:00Z' });

  assert.deepEqual(readSignals(target), [{ kind: 'rework-rate', version: 1, computedAtIso: '2026-07-15T00:00:00Z' }]);
});

// ── readReworkSignalEntry (BL-431's read side) ──────────────────────────────

test('readReworkSignalEntry returns the persisted rework-rate entry', () => {
  const target = mkTmp();
  persistReworkSignal(target, { kind: 'rework-rate', version: 1, computedAtIso: '2026-07-15T00:00:00Z', signal: { reworkRate: 0.4 } });
  const entry = readReworkSignalEntry(target);
  assert.equal(entry.kind, 'rework-rate');
  assert.deepEqual(entry.signal, { reworkRate: 0.4 });
});

test('readReworkSignalEntry returns null when no signals file exists yet', () => {
  const target = mkTmp();
  assert.equal(readReworkSignalEntry(target), null);
});

test('readReworkSignalEntry returns null when the file has other kinds but no rework-rate entry', () => {
  const target = mkTmp();
  persistReworkSignal(target, { kind: 'bottleneck-dwell', version: 1, computedAtIso: '2026-07-15T00:00:00Z' });
  assert.equal(readReworkSignalEntry(target), null);
});

test('readReworkSignalEntry returns null rather than crashing on a corrupt file', () => {
  const target = mkTmp();
  fs.mkdirSync(path.dirname(observatorySignalsPath(target)), { recursive: true });
  fs.writeFileSync(observatorySignalsPath(target), 'not json');
  assert.equal(readReworkSignalEntry(target), null);
});

// ── readReworkSignal (BL-432 DRY cleanup: the shared entry->signal extraction
// previously duplicated verbatim in suboptimality-verdict-line.ts and
// emit-throttle-recommendation.ts) ──────────────────────────────────────────

test('readReworkSignal returns the nested signal field of the persisted entry', () => {
  const target = mkTmp();
  persistReworkSignal(target, { kind: 'rework-rate', version: 1, computedAtIso: '2026-07-15T00:00:00Z', signal: { reworkRate: 0.4 } });
  assert.deepEqual(readReworkSignal(target), { reworkRate: 0.4 });
});

test('readReworkSignal returns null when no entry exists at all', () => {
  const target = mkTmp();
  assert.equal(readReworkSignal(target), null);
});

// Present-but-malformed: the entry exists but its `signal` field is not an
// object (a hand-edited file, or a future producer bug) - must be REJECTED
// (null), not passed through as if it were a real signal.
test('readReworkSignal returns null when the entry exists but its signal field is not an object', () => {
  const target = mkTmp();
  persistReworkSignal(target, { kind: 'rework-rate', version: 1, computedAtIso: '2026-07-15T00:00:00Z', signal: 'not-an-object' });
  assert.equal(readReworkSignal(target), null);
});

test('readReworkSignal returns null when the entry exists but has no signal field at all', () => {
  const target = mkTmp();
  persistReworkSignal(target, { kind: 'rework-rate', version: 1, computedAtIso: '2026-07-15T00:00:00Z' });
  assert.equal(readReworkSignal(target), null);
});

test('readReworkSignal returns null when the entry\'s signal field is explicitly null', () => {
  const target = mkTmp();
  persistReworkSignal(target, { kind: 'rework-rate', version: 1, computedAtIso: '2026-07-15T00:00:00Z', signal: null });
  assert.equal(readReworkSignal(target), null);
});
