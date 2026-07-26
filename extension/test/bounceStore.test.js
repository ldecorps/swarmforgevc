const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { qaBouncesDir } = require('../out/metrics/qaBounceStore');
const { bouncesDir, readBounceRecords, appendBounceRecordIfNew } = require('../out/metrics/bounceStore');

// BL-635: the generalised (by-role) bounce log, additive over the legacy
// QA-only qa_bounces/ store (qaBounceStore.test.js).

function mkTmp() {
  return mkTmpDir('sfvc-bounce-store-');
}

function record(overrides = {}) {
  return {
    ticket: 'BL-590',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: 'abc1234567',
    at: '2026-07-25T10:00:00.000Z',
    by: 'architect',
    ...overrides,
  };
}

test('reading from a target with no bounces dirs at all returns an empty array', () => {
  const target = mkTmp();
  assert.deepEqual(readBounceRecords(target), []);
});

test('appending writes a `by` record into the NEW generalised dir, never the legacy dir', () => {
  const target = mkTmp();
  const appended = appendBounceRecordIfNew(target, record());
  assert.equal(appended, true);
  assert.equal(fs.existsSync(path.join(bouncesDir(target), '2026-07.jsonl')), true);
  assert.equal(fs.existsSync(qaBouncesDir(target)), false);
  assert.deepEqual(readBounceRecords(target), [record()]);
});

// ── record-bounce-by-role-06: legacy by-less records stay readable ────────

test('reading merges the legacy qa_bounces log with the new bounces log', () => {
  const target = mkTmp();
  fs.mkdirSync(qaBouncesDir(target), { recursive: true });
  const legacy = {
    ticket: 'BL-441',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'unit',
    commit: 'legacyaa11',
    at: '2026-07-10T09:00:00.000Z',
  };
  fs.writeFileSync(path.join(qaBouncesDir(target), '2026-07.jsonl'), JSON.stringify(legacy) + '\n');
  appendBounceRecordIfNew(target, record({ by: 'QA' }));

  const records = readBounceRecords(target);
  assert.equal(records.length, 2);
  const legacyRead = records.find((r) => r.ticket === 'BL-441');
  const newRead = records.find((r) => r.ticket === 'BL-590');
  assert.equal(legacyRead.by, undefined);
  assert.equal(newRead.by, 'QA');
});

// ── record-bounce-by-role-04: four same-day bounces on one ticket, each a
//    distinct commit, must all be recorded (never collapse to one) ────────

test('four bounces on one ticket in one day, each a distinct commit, all append', () => {
  const target = mkTmp();
  for (const commit of ['commit0001', 'commit0002', 'commit0003', 'commit0004']) {
    assert.equal(appendBounceRecordIfNew(target, record({ commit })), true);
  }
  assert.equal(readBounceRecords(target).length, 4);
});

// ── idempotency: a genuine re-run of the SAME write never double-counts ───

test('re-appending the identical record is a no-op (idempotent on the natural key)', () => {
  const target = mkTmp();
  assert.equal(appendBounceRecordIfNew(target, record()), true);
  assert.equal(appendBounceRecordIfNew(target, record()), false);
  assert.equal(readBounceRecords(target).length, 1);
});

test('a malformed line in a bounces file is skipped, never a crash', () => {
  const target = mkTmp();
  fs.mkdirSync(bouncesDir(target), { recursive: true });
  fs.writeFileSync(path.join(bouncesDir(target), '2026-07.jsonl'), 'not json\n' + JSON.stringify(record()) + '\n');
  assert.deepEqual(readBounceRecords(target), [record()]);
});

test('a line whose `by` is outside the closed set is skipped, never trusted raw', () => {
  const target = mkTmp();
  fs.mkdirSync(bouncesDir(target), { recursive: true });
  fs.writeFileSync(path.join(bouncesDir(target), '2026-07.jsonl'), JSON.stringify(record({ by: 'hardener' })) + '\n');
  assert.deepEqual(readBounceRecords(target), []);
});

test('a line whose `by` is present but not a string (e.g. a number) is skipped, never coerced', () => {
  const target = mkTmp();
  fs.mkdirSync(bouncesDir(target), { recursive: true });
  fs.writeFileSync(path.join(bouncesDir(target), '2026-07.jsonl'), JSON.stringify(record({ by: 42 })) + '\n');
  assert.deepEqual(readBounceRecords(target), []);
});

// The shape check on the base QA fields (ticket/producingRole/.../at) is
// AND-ed with the `by` shape check - a line missing a core field entirely
// must be rejected regardless of `by` being well-formed (or absent), never
// let a valid-looking `by` paper over a malformed base record.
test('a line missing a required base field entirely is rejected even when `by` is well-formed', () => {
  const target = mkTmp();
  fs.mkdirSync(bouncesDir(target), { recursive: true });
  const malformed = record();
  delete malformed.ticket;
  fs.writeFileSync(path.join(bouncesDir(target), '2026-07.jsonl'), JSON.stringify(malformed) + '\n');
  assert.deepEqual(readBounceRecords(target), []);
});
