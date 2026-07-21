const assert = require('node:assert/strict');
const {
  approvalAsksNeedingRepost,
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
