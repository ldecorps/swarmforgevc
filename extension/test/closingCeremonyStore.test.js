const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  ceremonyDir,
  ceremonyRunFilePath,
  readCeremonyRun,
  writeCeremonyRun,
  listCeremonyRuns,
  findOpenCeremonyRunsBefore,
  finalizeCeremonyRunAsFailed,
  recordCeremonyOutcome,
  recordCeremonyAdjustment,
} = require('../out/metrics/closingCeremonyStore');
const { buildClosingCeremonyPacket, ceremonyRunState } = require('../out/quality/closingCeremony');

// BL-820: the impure read/write layer for the ceremony run record - one
// file per shift under .swarmforge/lean/ceremony/<yyyy-MM-dd>.json.

function mkTmp() {
  return mkTmpDir('sfvc-closing-ceremony-store-');
}

function nonEmptyPacket(shiftKey) {
  return buildClosingCeremonyPacket(shiftKey, [
    { ticket: 'BL-900', type: 'stage_transition', source: 'stage-dwell', at: `${shiftKey}T09:00:00.000Z`, role: 'coder', data: { processingMs: 1000 } },
  ]);
}

function run(shiftKey, overrides = {}) {
  return {
    shiftKey,
    packet: nonEmptyPacket(shiftKey),
    deliveredAt: `${shiftKey}T20:00:00.000Z`,
    outcome: null,
    adjustments: [],
    failedAt: null,
    ...overrides,
  };
}

// ── read/write round-trip ───────────────────────────────────────────────

test('reading a run for a target with no ceremony dir at all returns null', () => {
  const target = mkTmp();
  assert.equal(readCeremonyRun(target, '2026-08-08'), null);
});

test('writeCeremonyRun then readCeremonyRun round-trips exactly', () => {
  const target = mkTmp();
  const r = run('2026-08-08');
  writeCeremonyRun(target, r);
  assert.equal(fs.existsSync(ceremonyRunFilePath(target, '2026-08-08')), true);
  assert.deepEqual(readCeremonyRun(target, '2026-08-08'), r);
});

test('ceremonyRunFilePath lives under .swarmforge/lean/ceremony/', () => {
  const target = mkTmp();
  assert.equal(ceremonyRunFilePath(target, '2026-08-08'), path.join(ceremonyDir(target), '2026-08-08.json'));
});

test('a malformed run file is read as null, never a crash', () => {
  const target = mkTmp();
  fs.mkdirSync(ceremonyDir(target), { recursive: true });
  fs.writeFileSync(ceremonyRunFilePath(target, '2026-08-08'), 'not json');
  assert.equal(readCeremonyRun(target, '2026-08-08'), null);
});

test('valid JSON that is not an object is read as null, never a crash', () => {
  const target = mkTmp();
  fs.mkdirSync(ceremonyDir(target), { recursive: true });
  fs.writeFileSync(ceremonyRunFilePath(target, '2026-08-08'), JSON.stringify(42));
  assert.equal(readCeremonyRun(target, '2026-08-08'), null);
});

test('a JSON null run file is read as null, never a crash', () => {
  const target = mkTmp();
  fs.mkdirSync(ceremonyDir(target), { recursive: true });
  fs.writeFileSync(ceremonyRunFilePath(target, '2026-08-08'), JSON.stringify(null));
  assert.equal(readCeremonyRun(target, '2026-08-08'), null);
});

test('valid JSON object missing required run fields is read as null', () => {
  const target = mkTmp();
  fs.mkdirSync(ceremonyDir(target), { recursive: true });
  fs.writeFileSync(ceremonyRunFilePath(target, '2026-08-08'), JSON.stringify({ shiftKey: '2026-08-08' }));
  assert.equal(readCeremonyRun(target, '2026-08-08'), null);
});

// ── listCeremonyRuns / findOpenCeremonyRunsBefore ───────────────────────

test('listCeremonyRuns returns every stored run, sorted by shift key', () => {
  const target = mkTmp();
  writeCeremonyRun(target, run('2026-08-08'));
  writeCeremonyRun(target, run('2026-08-06'));
  writeCeremonyRun(target, run('2026-08-07'));
  assert.deepEqual(
    listCeremonyRuns(target).map((r) => r.shiftKey),
    ['2026-08-06', '2026-08-07', '2026-08-08']
  );
});

test('findOpenCeremonyRunsBefore returns only pending runs strictly before the given shift key', () => {
  const target = mkTmp();
  writeCeremonyRun(target, run('2026-08-05', { outcome: { type: 'no_change', ref: null, recordedAt: '2026-08-05T20:00:00.000Z' } })); // complete
  writeCeremonyRun(target, run('2026-08-06')); // pending, before
  writeCeremonyRun(target, run('2026-08-07', { failedAt: '2026-08-08T00:00:00.000Z' })); // already failed
  writeCeremonyRun(target, run('2026-08-08')); // pending, but not before itself
  assert.deepEqual(
    findOpenCeremonyRunsBefore(target, '2026-08-08').map((r) => r.shiftKey),
    ['2026-08-06']
  );
});

test('finalizeCeremonyRunAsFailed sets failedAt and persists it', () => {
  const target = mkTmp();
  const r = run('2026-08-06');
  writeCeremonyRun(target, r);
  const failed = finalizeCeremonyRunAsFailed(target, r, '2026-08-08T00:00:00.000Z');
  assert.equal(failed.failedAt, '2026-08-08T00:00:00.000Z');
  assert.equal(ceremonyRunState(readCeremonyRun(target, '2026-08-06')), 'failed');
});

// ── recordCeremonyOutcome ────────────────────────────────────────────

test('recordCeremonyOutcome records a valid outcome against a pending run', () => {
  const target = mkTmp();
  writeCeremonyRun(target, run('2026-08-08'));
  const updated = recordCeremonyOutcome(target, '2026-08-08', { type: 'process_ticket', ref: 'BL-901', recordedAt: '2026-08-08T22:00:00.000Z' });
  assert.equal(updated.outcome.type, 'process_ticket');
  assert.equal(ceremonyRunState(readCeremonyRun(target, '2026-08-08')), 'complete');
});

test('recordCeremonyOutcome throws when no run exists for the shift', () => {
  const target = mkTmp();
  assert.throws(() => recordCeremonyOutcome(target, '2026-08-08', { type: 'no_change', ref: null, recordedAt: '2026-08-08T22:00:00.000Z' }));
});

test('recordCeremonyOutcome refuses to overwrite an already-complete run', () => {
  const target = mkTmp();
  writeCeremonyRun(target, run('2026-08-08', { outcome: { type: 'no_change', ref: null, recordedAt: '2026-08-08T21:00:00.000Z' } }));
  assert.throws(() => recordCeremonyOutcome(target, '2026-08-08', { type: 'process_ticket', ref: 'BL-901', recordedAt: '2026-08-08T22:00:00.000Z' }));
});

test('recordCeremonyOutcome refuses to record over an already-failed run', () => {
  const target = mkTmp();
  writeCeremonyRun(target, run('2026-08-08', { failedAt: '2026-08-09T00:00:00.000Z' }));
  assert.throws(() => recordCeremonyOutcome(target, '2026-08-08', { type: 'no_change', ref: null, recordedAt: '2026-08-09T01:00:00.000Z' }));
});

test('recordCeremonyOutcome refuses an invalid outcome shape (unreversible)', () => {
  const target = mkTmp();
  writeCeremonyRun(target, run('2026-08-08'));
  assert.throws(() => recordCeremonyOutcome(target, '2026-08-08', { type: 'process_ticket', ref: null, recordedAt: '2026-08-08T22:00:00.000Z' }));
});

// ── recordCeremonyAdjustment ─────────────────────────────────────────

test('recordCeremonyAdjustment appends a valid adjustment against a pending run', () => {
  const target = mkTmp();
  writeCeremonyRun(target, run('2026-08-08'));
  const adjustment = { kind: 'promotion_order', detail: 'reordered active/', record: { form: 'note', ref: 'note-123' }, recordedAt: '2026-08-08T21:00:00.000Z' };
  const updated = recordCeremonyAdjustment(target, '2026-08-08', adjustment);
  assert.equal(updated.adjustments.length, 1);
  assert.deepEqual(readCeremonyRun(target, '2026-08-08').adjustments, [adjustment]);
});

test('recordCeremonyAdjustment appends onto existing adjustments rather than replacing them', () => {
  const target = mkTmp();
  const first = { kind: 'promotion_order', detail: 'a', record: { form: 'note', ref: 'note-1' }, recordedAt: '2026-08-08T21:00:00.000Z' };
  writeCeremonyRun(target, run('2026-08-08', { adjustments: [first] }));
  const second = { kind: 'throttle_posture', detail: 'b', record: { form: 'ticket', ref: 'BL-902' }, recordedAt: '2026-08-08T21:05:00.000Z' };
  recordCeremonyAdjustment(target, '2026-08-08', second);
  assert.deepEqual(readCeremonyRun(target, '2026-08-08').adjustments, [first, second]);
});

test('recordCeremonyAdjustment throws when no run exists for the shift', () => {
  const target = mkTmp();
  assert.throws(() => recordCeremonyAdjustment(target, '2026-08-08', { kind: 'promotion_order', detail: 'x', record: { form: 'note', ref: 'n' }, recordedAt: '2026-08-08T21:00:00.000Z' }));
});

test('recordCeremonyAdjustment refuses on an already-failed run', () => {
  const target = mkTmp();
  writeCeremonyRun(target, run('2026-08-08', { failedAt: '2026-08-09T00:00:00.000Z' }));
  assert.throws(() => recordCeremonyAdjustment(target, '2026-08-08', { kind: 'promotion_order', detail: 'x', record: { form: 'note', ref: 'n' }, recordedAt: '2026-08-09T01:00:00.000Z' }));
});

test('recordCeremonyAdjustment refuses an adjustment with no reversibility ref', () => {
  const target = mkTmp();
  writeCeremonyRun(target, run('2026-08-08'));
  assert.throws(() => recordCeremonyAdjustment(target, '2026-08-08', { kind: 'promotion_order', detail: 'x', record: { form: 'note', ref: '' }, recordedAt: '2026-08-08T21:00:00.000Z' }));
});
