const assert = require('node:assert/strict');
const {
  isBounceCorrection,
  bounceCorrectionTargetKey,
  applyBounceCorrections,
  KNOWN_BOUNCE_ROLES,
} = require('../out/quality/qaBounce');

// BL-990: a bounce recorded against the wrong role was permanent - the CLI
// only appends and no consumer reads prose, so a demonstrated
// misattribution (BL-971, the specifier's mid-flight amendment charged to
// the coder) kept feeding a live experiment. The correction has to be a
// RECORD, and the store has to stay append-only: the fact that a
// misattribution happened is itself evidence worth keeping.
//
// The correction marks its target EXCLUDED FROM ATTRIBUTION rather than
// re-pointing it at the specifier - the smaller of the two options the
// ticket left open, and the one that does not widen KNOWN_PRODUCING_ROLES,
// which every consumer groups on.

const bounce = (over = {}) => ({
  ticket: 'BL-971',
  producingRole: 'coder',
  ticketType: 'defect',
  failureClass: 'acceptance',
  commit: '8956d30eee',
  by: 'QA',
  at: '2026-08-20T13:45:00.000Z',
  ...over,
});

const correction = (over = {}) => ({
  kind: 'bounce-correction',
  ticket: 'BL-971',
  commit: '8956d30eee',
  by: 'QA',
  reason: 'misattributed - caused by a mid-flight spec amendment, not the coder',
  at: '2026-08-20T14:00:00.000Z',
  ...over,
});

// ── shape ────────────────────────────────────────────────────────────────

test('isBounceCorrection accepts a well-formed correction', () => {
  assert.equal(isBounceCorrection(correction()), true);
});

test('isBounceCorrection accepts an optional evidence pointer', () => {
  assert.equal(isBounceCorrection(correction({ evidence: 'backlog/evidence/BL-971-x.md' })), true);
});

test('isBounceCorrection REFUSES a correction with no reason - an unexplained retraction is indistinguishable from metric-gaming', () => {
  const { reason, ...noReason } = correction();
  assert.equal(isBounceCorrection(noReason), false);
  assert.equal(isBounceCorrection(correction({ reason: '' })), false);
  assert.equal(isBounceCorrection(correction({ reason: '   ' })), false);
});

test('isBounceCorrection refuses anything missing kind, ticket or commit', () => {
  for (const field of ['kind', 'ticket', 'commit', 'at', 'by']) {
    const bad = correction();
    delete bad[field];
    assert.equal(isBounceCorrection(bad), false, `missing ${field}`);
  }
});

test('isBounceCorrection refuses a by outside the closed role set, and never a bounce record', () => {
  assert.equal(isBounceCorrection(correction({ by: 'nobody' })), false);
  assert.equal(isBounceCorrection(bounce()), false, 'a bounce record is not a correction');
  assert.equal(isBounceCorrection(null), false);
  assert.equal(isBounceCorrection('a string'), false);
});

test('every KNOWN_BOUNCE_ROLES member may issue a correction - including the specifier', () => {
  for (const role of KNOWN_BOUNCE_ROLES) {
    assert.equal(isBounceCorrection(correction({ by: role })), true, role);
  }
  assert.ok(KNOWN_BOUNCE_ROLES.includes('specifier'));
});

// ── targeting ────────────────────────────────────────────────────────────

test('a correction targets a bounce by ticket AND commit, so a ticket that bounced twice loses only the corrected one', () => {
  assert.equal(bounceCorrectionTargetKey(bounce()), bounceCorrectionTargetKey(correction()));
  assert.notEqual(bounceCorrectionTargetKey(bounce({ commit: 'ffffffffff' })), bounceCorrectionTargetKey(correction()));
  assert.notEqual(bounceCorrectionTargetKey(bounce({ ticket: 'BL-1' })), bounceCorrectionTargetKey(correction()));
});

// ── applying ─────────────────────────────────────────────────────────────

test('applyBounceCorrections removes exactly the corrected record and leaves the rest', () => {
  const other = bounce({ ticket: 'BL-42', commit: 'aaaaaaaaaa' });
  const sameTicketOtherCommit = bounce({ commit: 'bbbbbbbbbb' });
  const out = applyBounceCorrections([bounce(), other, sameTicketOtherCommit], [correction()]);
  assert.deepEqual(out, [other, sameTicketOtherCommit]);
});

test('applyBounceCorrections with no corrections is the identity', () => {
  const records = [bounce(), bounce({ ticket: 'BL-42' })];
  assert.deepEqual(applyBounceCorrections(records, []), records);
});

test('applyBounceCorrections is idempotent - two identical corrections remove one record, not two', () => {
  const out = applyBounceCorrections([bounce()], [correction(), correction()]);
  assert.deepEqual(out, []);
});

test('a correction for a bounce that is not in the store removes nothing and does not throw', () => {
  const records = [bounce()];
  assert.deepEqual(applyBounceCorrections(records, [correction({ commit: 'cccccccccc' })]), records);
});
