const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { observatorySignalsPath, persistReworkSignal } = require('../out/metrics/reworkObservatoryStore');

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
