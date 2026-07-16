const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { qaBouncesDir, readQaBounceRecords, appendQaBounceRecordIfNew } = require('../out/quality/qaBounceStore');

// BL-454: the impure read/write layer over .swarmforge/qa_bounces/<YYYY-MM>.jsonl.

function mkTmp() {
  return mkTmpDir('sfvc-qa-bounce-store-');
}

function record(overrides = {}) {
  return {
    ticket: 'BL-340',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'abc1234567',
    at: '2026-07-14T10:00:00.000Z',
    ...overrides,
  };
}

test('reading from a target with no qa_bounces dir yet returns an empty array, never a crash', () => {
  const target = mkTmp();
  assert.deepEqual(readQaBounceRecords(target), []);
});

test('appending a new record writes it into the month file matching its own `at` date', () => {
  const target = mkTmp();
  const appended = appendQaBounceRecordIfNew(target, record());
  assert.equal(appended, true);
  const filePath = path.join(qaBouncesDir(target), '2026-07.jsonl');
  assert.equal(fs.existsSync(filePath), true);
  assert.deepEqual(readQaBounceRecords(target), [record()]);
});

test('appending the same bounce twice does not double-count it (idempotent on the natural key)', () => {
  const target = mkTmp();
  assert.equal(appendQaBounceRecordIfNew(target, record()), true);
  assert.equal(appendQaBounceRecordIfNew(target, record({ commit: 'deadbeef00', producingRole: 'cleaner' })), false);
  assert.equal(readQaBounceRecords(target).length, 1);
});

test('a record from a different month is written into ITS OWN month file, not the current one', () => {
  const target = mkTmp();
  appendQaBounceRecordIfNew(target, record({ at: '2026-06-01T00:00:00.000Z' }));
  appendQaBounceRecordIfNew(target, record({ ticket: 'BL-341', at: '2026-07-01T00:00:00.000Z' }));
  const files = fs.readdirSync(qaBouncesDir(target)).sort();
  assert.deepEqual(files, ['2026-06.jsonl', '2026-07.jsonl']);
  assert.equal(readQaBounceRecords(target).length, 2);
});

test('a malformed line in a qa_bounces file is skipped, never a crash', () => {
  const target = mkTmp();
  fs.mkdirSync(qaBouncesDir(target), { recursive: true });
  fs.writeFileSync(path.join(qaBouncesDir(target), '2026-07.jsonl'), 'not json\n' + JSON.stringify(record()) + '\n');
  assert.deepEqual(readQaBounceRecords(target), [record()]);
});

test('a line with a producingRole outside the closed set is skipped, never trusted raw', () => {
  const target = mkTmp();
  fs.mkdirSync(qaBouncesDir(target), { recursive: true });
  const badRecord = JSON.stringify(record({ producingRole: 'QA' }));
  fs.writeFileSync(path.join(qaBouncesDir(target), '2026-07.jsonl'), badRecord + '\n');
  assert.deepEqual(readQaBounceRecords(target), []);
});
