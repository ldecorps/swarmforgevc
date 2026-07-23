const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { siblingDeferralsDir, readSiblingDeferralRecords, appendSiblingDeferralRecordIfNew } = require('../out/metrics/siblingDeferralStore');

// BL-532: the impure read/write layer over .swarmforge/qa_deferrals/<YYYY-MM>.jsonl.

function mkTmp() {
  return mkTmpDir('sfvc-sibling-deferral-store-');
}

function deferRecord(overrides = {}) {
  return {
    ticket: 'BL-477',
    blockedBy: 'BL-469',
    action: 'defer',
    failureClass: 'integration',
    check: 'npm run compile',
    commit: 'abc1234567',
    at: '2026-07-17T10:00:00.000Z',
    ...overrides,
  };
}

function clearRecord(overrides = {}) {
  return {
    ticket: 'BL-477',
    blockedBy: 'BL-469',
    action: 'clear',
    commit: 'def4567890',
    at: '2026-07-18T10:00:00.000Z',
    ...overrides,
  };
}

test('reading from a target with no qa_deferrals dir yet returns an empty array, never a crash', () => {
  const target = mkTmp();
  assert.deepEqual(readSiblingDeferralRecords(target), []);
});

test('appending a new defer record writes it into the month file matching its own `at` date, under qa_deferrals/ (never qa_bounces/)', () => {
  const target = mkTmp();
  const appended = appendSiblingDeferralRecordIfNew(target, deferRecord());
  assert.equal(appended, true);
  const filePath = path.join(siblingDeferralsDir(target), '2026-07.jsonl');
  assert.equal(fs.existsSync(filePath), true);
  assert.equal(path.basename(siblingDeferralsDir(target)), 'qa_deferrals');
  assert.deepEqual(readSiblingDeferralRecords(target), [deferRecord()]);
});

test('appending the same defer twice does not double-count it (idempotent on the natural key)', () => {
  const target = mkTmp();
  assert.equal(appendSiblingDeferralRecordIfNew(target, deferRecord()), true);
  assert.equal(appendSiblingDeferralRecordIfNew(target, deferRecord({ commit: 'deadbeef00' })), false);
  assert.equal(readSiblingDeferralRecords(target).length, 1);
});

test('defer -> clear -> defer appends all three records (latest-record-wins, not full-history dedup)', () => {
  const target = mkTmp();
  assert.equal(appendSiblingDeferralRecordIfNew(target, deferRecord()), true);
  assert.equal(appendSiblingDeferralRecordIfNew(target, clearRecord()), true);
  const reopened = deferRecord({ at: '2026-07-19T10:00:00.000Z', commit: 'cafebabe00' });
  assert.equal(appendSiblingDeferralRecordIfNew(target, reopened), true);
  assert.equal(readSiblingDeferralRecords(target).length, 3);
});

test('a record from a different month is written into ITS OWN month file, not the current one', () => {
  const target = mkTmp();
  appendSiblingDeferralRecordIfNew(target, deferRecord({ at: '2026-06-01T00:00:00.000Z' }));
  appendSiblingDeferralRecordIfNew(target, deferRecord({ ticket: 'BL-478', at: '2026-07-01T00:00:00.000Z' }));
  const files = fs.readdirSync(siblingDeferralsDir(target)).sort();
  assert.deepEqual(files, ['2026-06.jsonl', '2026-07.jsonl']);
  assert.equal(readSiblingDeferralRecords(target).length, 2);
});

test('a malformed line in a qa_deferrals file is skipped, never a crash', () => {
  const target = mkTmp();
  fs.mkdirSync(siblingDeferralsDir(target), { recursive: true });
  fs.writeFileSync(path.join(siblingDeferralsDir(target), '2026-07.jsonl'), 'not json\n' + JSON.stringify(deferRecord()) + '\n');
  assert.deepEqual(readSiblingDeferralRecords(target), [deferRecord()]);
});

test('a defer line with a failureClass outside the closed set is skipped, never trusted raw', () => {
  const target = mkTmp();
  fs.mkdirSync(siblingDeferralsDir(target), { recursive: true });
  const badRecord = JSON.stringify(deferRecord({ failureClass: 'not-a-real-class' }));
  fs.writeFileSync(path.join(siblingDeferralsDir(target), '2026-07.jsonl'), badRecord + '\n');
  assert.deepEqual(readSiblingDeferralRecords(target), []);
});

test('a defer line missing its check command is skipped', () => {
  const target = mkTmp();
  fs.mkdirSync(siblingDeferralsDir(target), { recursive: true });
  const badRecord = JSON.stringify(deferRecord({ check: undefined }));
  fs.writeFileSync(path.join(siblingDeferralsDir(target), '2026-07.jsonl'), badRecord + '\n');
  assert.deepEqual(readSiblingDeferralRecords(target), []);
});

test('a clear record round-trips with no failureClass/check', () => {
  const target = mkTmp();
  appendSiblingDeferralRecordIfNew(target, clearRecord());
  assert.deepEqual(readSiblingDeferralRecords(target), [clearRecord()]);
});

for (const field of ['ticket', 'blockedBy', 'commit', 'at']) {
  test(`a line whose "${field}" field is the wrong type is skipped, never trusted raw`, () => {
    const target = mkTmp();
    fs.mkdirSync(siblingDeferralsDir(target), { recursive: true });
    const badRecord = JSON.stringify(deferRecord({ [field]: 42 }));
    fs.writeFileSync(path.join(siblingDeferralsDir(target), '2026-07.jsonl'), badRecord + '\n');
    assert.deepEqual(readSiblingDeferralRecords(target), []);
  });
}

test('a clear line carrying a stray failureClass is skipped (clear must name neither class nor check)', () => {
  const target = mkTmp();
  fs.mkdirSync(siblingDeferralsDir(target), { recursive: true });
  const badRecord = JSON.stringify(clearRecord({ failureClass: 'integration' }));
  fs.writeFileSync(path.join(siblingDeferralsDir(target), '2026-07.jsonl'), badRecord + '\n');
  assert.deepEqual(readSiblingDeferralRecords(target), []);
});

test('a clear line carrying a stray check (but no failureClass) is skipped too - both must be absent, not just one', () => {
  // Symmetric to the stray-failureClass case above: with failureClass
  // already undefined, the `&&` in hasKnownSiblingDeferralValues short-
  // circuits before ever evaluating the check===undefined half, so that
  // case alone can't prove `&&` wasn't weakened to `||`. This record makes
  // the check-side comparison the one that decides the (still-false) result.
  const target = mkTmp();
  fs.mkdirSync(siblingDeferralsDir(target), { recursive: true });
  const badRecord = JSON.stringify(clearRecord({ check: 'npm run compile' }));
  fs.writeFileSync(path.join(siblingDeferralsDir(target), '2026-07.jsonl'), badRecord + '\n');
  assert.deepEqual(readSiblingDeferralRecords(target), []);
});

test('a defer line with an empty-string check is skipped (check must be non-empty, not merely a string)', () => {
  const target = mkTmp();
  fs.mkdirSync(siblingDeferralsDir(target), { recursive: true });
  const badRecord = JSON.stringify(deferRecord({ check: '' }));
  fs.writeFileSync(path.join(siblingDeferralsDir(target), '2026-07.jsonl'), badRecord + '\n');
  assert.deepEqual(readSiblingDeferralRecords(target), []);
});

test('a line whose "action" is outside {defer, clear} is skipped, never trusted raw', () => {
  const target = mkTmp();
  fs.mkdirSync(siblingDeferralsDir(target), { recursive: true });
  const badRecord = JSON.stringify(deferRecord({ action: 'hold' }));
  fs.writeFileSync(path.join(siblingDeferralsDir(target), '2026-07.jsonl'), badRecord + '\n');
  assert.deepEqual(readSiblingDeferralRecords(target), []);
});

test('a defer line whose check is a non-string with a truthy .length (an array) is skipped - "check.length > 0" alone is not the guard, the type check is', () => {
  const target = mkTmp();
  fs.mkdirSync(siblingDeferralsDir(target), { recursive: true });
  const badRecord = JSON.stringify(deferRecord({ check: ['npm', 'test'] }));
  fs.writeFileSync(path.join(siblingDeferralsDir(target), '2026-07.jsonl'), badRecord + '\n');
  assert.deepEqual(readSiblingDeferralRecords(target), []);
});

test('a directory (not a file) can never match the qa_deferrals reader since only *.jsonl paths are read as files', () => {
  const target = mkTmp();
  const dir = siblingDeferralsDir(target);
  // A directory happens to be named like a monthly ledger file - readdirSync
  // still lists it (it matches the '.jsonl' suffix filter), so the read must
  // survive attempting fs.readFileSync on a directory (EISDIR) rather than
  // crash the whole read.
  fs.mkdirSync(path.join(dir, '2026-07.jsonl'), { recursive: true });
  assert.deepEqual(readSiblingDeferralRecords(target), []);
});

test('a non-.jsonl file sitting alongside a real ledger file is never read, even if it holds a well-formed record', () => {
  const target = mkTmp();
  const dir = siblingDeferralsDir(target);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-07.jsonl'), JSON.stringify(deferRecord()) + '\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), JSON.stringify(deferRecord({ blockedBy: 'BL-999' })) + '\n');
  assert.deepEqual(readSiblingDeferralRecords(target), [deferRecord()]);
});

test('a JSON line that parses to a non-object value (not null, not an object literal) is skipped, never a crash', () => {
  const target = mkTmp();
  fs.mkdirSync(siblingDeferralsDir(target), { recursive: true });
  fs.writeFileSync(path.join(siblingDeferralsDir(target), '2026-07.jsonl'), '42\n' + JSON.stringify(deferRecord()) + '\n');
  assert.deepEqual(readSiblingDeferralRecords(target), [deferRecord()]);
});

test('a JSON line that parses to null is skipped, never a crash', () => {
  const target = mkTmp();
  fs.mkdirSync(siblingDeferralsDir(target), { recursive: true });
  fs.writeFileSync(path.join(siblingDeferralsDir(target), '2026-07.jsonl'), 'null\n' + JSON.stringify(deferRecord()) + '\n');
  assert.deepEqual(readSiblingDeferralRecords(target), [deferRecord()]);
});
