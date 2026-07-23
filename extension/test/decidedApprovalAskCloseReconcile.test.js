const assert = require('node:assert/strict');
const {
  decidedApprovalAsksNeedingClose,
  reconcileDecidedApprovalAskCloses,
} = require('../out/concierge/decidedApprovalAskCloseReconcile');

test('decidedApprovalAsksNeedingClose: open ask with a decided ticket needs close', () => {
  const recorded = {
    'BL-552': { topicId: 1, messageId: 10, text: 'BL-552 needs your approval...' },
  };
  const verdictFor = (id) => (id === 'BL-552' ? { kind: 'approved' } : undefined);
  assert.deepEqual(decidedApprovalAsksNeedingClose(recorded, verdictFor), ['BL-552']);
});

test('decidedApprovalAsksNeedingClose: ask already showing decided footer is skipped', () => {
  const recorded = {
    'BL-552': { topicId: 1, messageId: 10, text: 'BL-552 needs your approval...\n-- Approved 2026-07-17 03:07 UTC' },
  };
  const verdictFor = () => ({ kind: 'approved' });
  assert.deepEqual(decidedApprovalAsksNeedingClose(recorded, verdictFor), []);
});

test('decidedApprovalAsksNeedingClose: pending ticket (no verdict) is skipped', () => {
  const recorded = {
    'BL-553': { topicId: 1, messageId: 11, text: 'BL-553 needs your approval...' },
  };
  assert.deepEqual(decidedApprovalAsksNeedingClose(recorded, () => undefined), []);
});

test('decidedApprovalAsksNeedingClose: sorts ids deterministically', () => {
  const recorded = {
    'BL-9': { topicId: 1, messageId: 1, text: 'ask' },
    'BL-2': { topicId: 1, messageId: 2, text: 'ask' },
    'BL-10': { topicId: 1, messageId: 3, text: 'ask' },
  };
  const verdictFor = () => ({ kind: 'approved' });
  assert.deepEqual(decidedApprovalAsksNeedingClose(recorded, verdictFor), ['BL-10', 'BL-2', 'BL-9']);
});

test('reconcileDecidedApprovalAskCloses: closes each open ask that already has a verdict', async () => {
  const closed = [];
  const waits = [];
  await reconcileDecidedApprovalAskCloses(
    {
      readApprovalAskMessages: () => ({
        'BL-552': { topicId: 1, messageId: 10, text: 'ask 552' },
        'BL-553': { topicId: 1, messageId: 11, text: 'ask 553' },
      }),
      readCloseVerdict: (id) => ({ kind: 'approved' }),
      closeApprovalAsk: async (backlogId, verdict, nowMs) => {
        closed.push({ backlogId, verdict, nowMs });
      },
      waitBetweenCloses: async (ms) => {
        waits.push(ms);
      },
    },
    123
  );
  assert.deepEqual(closed, [
    { backlogId: 'BL-552', verdict: { kind: 'approved' }, nowMs: 123 },
    { backlogId: 'BL-553', verdict: { kind: 'approved' }, nowMs: 123 },
  ]);
  assert.deepEqual(waits, [150]);
});
