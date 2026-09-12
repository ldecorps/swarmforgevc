const assert = require('node:assert/strict');
const {
  approvalAsksNeedingRepost,
  approvalAskRecordedOnLiveTopic,
  approvalRequestedEmittedKey,
} = require('../out/concierge/approvalAskReconcile');

test('approvalAsksNeedingRepost: empty when Approvals topic is unbound', () => {
  assert.deepEqual(approvalAsksNeedingRepost(['BL-525'], {}, undefined), []);
});

test('approvalAsksNeedingRepost: pending ticket with no recorded ask and no emitted key needs a buttoned ask', () => {
  assert.deepEqual(approvalAsksNeedingRepost(['BL-525'], {}, 3857), ['BL-525']);
});

test('approvalAsksNeedingRepost: does not re-fire when emittedKeys already marks ApprovalRequested (sendMessage fallback path)', () => {
  const emitted = new Set([approvalRequestedEmittedKey('BL-525')]);
  assert.deepEqual(approvalAsksNeedingRepost(['BL-525'], {}, 3857, emitted), []);
});

test('approvalAsksNeedingRepost: recorded ask on the LIVE Approvals topic is a no-op', () => {
  assert.deepEqual(
    approvalAsksNeedingRepost(['BL-525'], { 'BL-525': { topicId: 3857 } }, 3857, new Set()),
    []
  );
});

test('approvalAsksNeedingRepost: recorded ask on a STALE topic id is re-posted onto the live Approvals topic (remint)', () => {
  const emitted = new Set([approvalRequestedEmittedKey('BL-525')]);
  assert.deepEqual(
    approvalAsksNeedingRepost(['BL-525'], { 'BL-525': { topicId: 100 } }, 3857, emitted),
    ['BL-525']
  );
});

test('approvalAsksNeedingRepost: sorts ids deterministically', () => {
  assert.deepEqual(approvalAsksNeedingRepost(['BL-9', 'BL-2', 'BL-10'], {}, 1), ['BL-10', 'BL-2', 'BL-9']);
});

test('approvalAskRecordedOnLiveTopic: true only when ask topicId matches live Approvals id', () => {
  assert.equal(approvalAskRecordedOnLiveTopic('BL-525', { 'BL-525': { topicId: 3857 } }, 3857), true);
  assert.equal(approvalAskRecordedOnLiveTopic('BL-525', { 'BL-525': { topicId: 100 } }, 3857), false);
  assert.equal(approvalAskRecordedOnLiveTopic('BL-525', {}, 3857), false);
  assert.equal(approvalAskRecordedOnLiveTopic('BL-525', { 'BL-525': { topicId: 3857 } }, undefined), false);
});

// BL-1455: a decided (closed) ask is never "live", even though its
// topicId still names the live Approvals topic — that record is the
// audit trail of an EARLIER decision, not a still-open ask.
test('approvalAskRecordedOnLiveTopic: false when the recorded ask on the live topic is explicitly marked closed', () => {
  assert.equal(approvalAskRecordedOnLiveTopic('BL-525', { 'BL-525': { topicId: 3857, closed: true } }, 3857), false);
});

test('approvalAskRecordedOnLiveTopic: an explicit closed:false on the live topic is still live', () => {
  assert.equal(approvalAskRecordedOnLiveTopic('BL-525', { 'BL-525': { topicId: 3857, closed: false } }, 3857), true);
});

// Pre-BL-1455 records carry no `closed` field at all — fall back to
// scanning the stored text for BL-484's decided-verdict suffix.
test('approvalAskRecordedOnLiveTopic: legacy record (no closed field) falls back to the decided-verdict text suffix', () => {
  assert.equal(
    approvalAskRecordedOnLiveTopic('BL-525', { 'BL-525': { topicId: 3857, text: 'ask\n-- Approved 2026-09-05 08:14 UTC' } }, 3857),
    false
  );
  assert.equal(
    approvalAskRecordedOnLiveTopic('BL-525', { 'BL-525': { topicId: 3857, text: 'ask\n-- Ruled: pick B 2026-09-02 19:38 UTC' } }, 3857),
    false
  );
});

test('approvalAskRecordedOnLiveTopic: legacy record (no closed field) with undecided text is still live', () => {
  assert.equal(approvalAskRecordedOnLiveTopic('BL-525', { 'BL-525': { topicId: 3857, text: 'BL-525 needs your approval' } }, 3857), true);
});

// BL-1455 scenario 06: a closed ask still sitting on the live topic must
// repost even when emittedKeys already carries the key from the FIRST,
// now-decided ask — that key was earned by a different ask.
test('approvalAsksNeedingRepost: a CLOSED ask on the live topic reposts even when emittedKeys already has the key', () => {
  const emitted = new Set([approvalRequestedEmittedKey('BL-525')]);
  assert.deepEqual(
    approvalAsksNeedingRepost(['BL-525'], { 'BL-525': { topicId: 3857, closed: true } }, 3857, emitted),
    ['BL-525']
  );
});

test('approvalAsksNeedingRepost: a legacy closed ask (decided-verdict text, no closed field) on the live topic reposts', () => {
  const emitted = new Set([approvalRequestedEmittedKey('BL-525')]);
  assert.deepEqual(
    approvalAsksNeedingRepost(
      ['BL-525'],
      { 'BL-525': { topicId: 3857, text: 'ask\n-- Approved 2026-09-05 08:14 UTC' } },
      3857,
      emitted
    ),
    ['BL-525']
  );
});

test('approvalAsksNeedingRepost: an UNDECIDED ask on the live topic never reposts, even with no emittedKeys entry', () => {
  assert.deepEqual(
    approvalAsksNeedingRepost(['BL-525'], { 'BL-525': { topicId: 3857, text: 'BL-525 needs your approval' } }, 3857, new Set()),
    []
  );
});
