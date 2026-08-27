const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  lifecycleSnapshotPath,
  serializeLifecycleSnapshot,
  isUsableSnapshot,
  writeLifecycleSnapshot,
  readLifecycleSnapshot,
} = require('../out/metrics/lifecycleSnapshot');

const DAY1 = Date.parse('2026-08-15T09:00:00Z');
const DAY1_LATER = Date.parse('2026-08-15T18:00:00Z');
const DAY2 = Date.parse('2026-08-16T09:00:00Z');

const RECORDS = [
  { ticketId: 'BL-1', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: null },
  { ticketId: 'BL-2', specDateIso: '2026-08-02T00:00:00Z', closeDateIso: '2026-08-10T00:00:00Z' },
];

test('lifecycleSnapshotPath joins under .swarmforge/briefing/', () => {
  const p = lifecycleSnapshotPath('/repo');
  assert.equal(p, path.join('/repo', '.swarmforge', 'briefing', 'lifecycle-snapshot.json'));
});

test('serializeLifecycleSnapshot carries todays UTC day-key and the given records verbatim', () => {
  const file = serializeLifecycleSnapshot(RECORDS, DAY1);
  assert.equal(file.dayKey, '2026-08-15');
  assert.deepEqual(file.records, RECORDS);
  assert.equal(typeof file.generatedAtIso, 'string');
});

test('isUsableSnapshot is true for a same-day well-formed snapshot', () => {
  const file = serializeLifecycleSnapshot(RECORDS, DAY1);
  assert.equal(isUsableSnapshot(file, DAY1_LATER), true);
});

test('isUsableSnapshot is false for a snapshot from a prior day', () => {
  const file = serializeLifecycleSnapshot(RECORDS, DAY1);
  assert.equal(isUsableSnapshot(file, DAY2), false);
});

test('isUsableSnapshot is false for null/non-object/missing-records input', () => {
  assert.equal(isUsableSnapshot(null, DAY1), false);
  assert.equal(isUsableSnapshot('a string', DAY1), false);
  assert.equal(isUsableSnapshot({ dayKey: '2026-08-15' }, DAY1), false);
  assert.equal(isUsableSnapshot({ dayKey: '2026-08-15', records: 'not-an-array' }, DAY1), false);
});

// ── readLifecycleSnapshot: the actual fallback contract (scenario 03) ──────

test('readLifecycleSnapshot returns the records of a fresh, well-formed snapshot', () => {
  const dir = mkTmpDir('sfvc-lifecycle-snapshot-');
  writeLifecycleSnapshot(dir, RECORDS, DAY1);
  const written = lifecycleSnapshotPath(dir);
  assert.deepEqual(readLifecycleSnapshot(written, DAY1_LATER), RECORDS);
});

test('readLifecycleSnapshot degrades to null when the file is missing', () => {
  assert.equal(readLifecycleSnapshot('/no/such/path/snapshot.json', DAY1), null);
});

test('readLifecycleSnapshot degrades to null when the file is unreadable JSON', () => {
  const dir = mkTmpDir('sfvc-lifecycle-snapshot-');
  const filePath = path.join(dir, 'corrupt.json');
  fs.writeFileSync(filePath, '{ not valid json', 'utf8');
  assert.equal(readLifecycleSnapshot(filePath, DAY1), null);
});

test('readLifecycleSnapshot degrades to null when the snapshot is from a prior day', () => {
  const dir = mkTmpDir('sfvc-lifecycle-snapshot-');
  writeLifecycleSnapshot(dir, RECORDS, DAY1);
  const written = lifecycleSnapshotPath(dir);
  assert.equal(readLifecycleSnapshot(written, DAY2), null);
});

test('writeLifecycleSnapshot never writes inside a git-tracked location by itself - it always writes under .swarmforge/', () => {
  const dir = mkTmpDir('sfvc-lifecycle-snapshot-');
  const written = writeLifecycleSnapshot(dir, RECORDS, DAY1);
  assert.ok(written.includes(`${path.sep}.swarmforge${path.sep}`));
  assert.ok(fs.existsSync(written));
});
