const assert = require('node:assert/strict');
const {
  staleApprovalAsksNeedingClose,
  reconcileStaleApprovalAsks,
} = require('../out/tools/telegramFrontDeskBotCore');

test('staleApprovalAsksNeedingClose: an open ask whose ticket file is gone needs close', () => {
  const recorded = {
    'BL-1186': { topicId: 1, messageId: 10, text: 'BL-1186 needs your approval...' },
  };
  const exists = (id) => id !== 'BL-1186';
  assert.deepEqual(staleApprovalAsksNeedingClose(recorded, exists), ['BL-1186']);
});

test('staleApprovalAsksNeedingClose: an open ask whose ticket file still exists is skipped', () => {
  const recorded = {
    'BL-1186': { topicId: 1, messageId: 10, text: 'BL-1186 needs your approval...' },
  };
  assert.deepEqual(staleApprovalAsksNeedingClose(recorded, () => true), []);
});

test('staleApprovalAsksNeedingClose: an ask already showing a decided footer (including Stale:) is skipped', () => {
  const recorded = {
    'BL-1186': { topicId: 1, messageId: 10, text: 'ask...\n-- Stale: ticket file missing 2026-08-27 19:00 UTC' },
    'BL-1187': { topicId: 1, messageId: 11, text: 'ask...\n-- Approved 2026-08-27 19:00 UTC' },
  };
  assert.deepEqual(staleApprovalAsksNeedingClose(recorded, () => false), []);
});

test('staleApprovalAsksNeedingClose: sorts ids deterministically', () => {
  const recorded = {
    'BL-9': { topicId: 1, messageId: 1, text: 'ask' },
    'BL-2': { topicId: 1, messageId: 2, text: 'ask' },
    'BL-10': { topicId: 1, messageId: 3, text: 'ask' },
  };
  assert.deepEqual(staleApprovalAsksNeedingClose(recorded, () => false), ['BL-10', 'BL-2', 'BL-9']);
});

test('reconcileStaleApprovalAsks: closes each open ask whose ticket file is gone, with Stale verdict', async () => {
  const closed = [];
  const waits = [];
  await reconcileStaleApprovalAsks(
    {
      readApprovalAskMessages: () => ({
        'BL-1186': { topicId: 1, messageId: 10, text: 'ask 1186' },
        'BL-1187': { topicId: 1, messageId: 11, text: 'ask 1187' },
      }),
      ticketFileExists: () => false,
      closeApprovalAsk: async (backlogId, verdict, nowMs) => {
        closed.push({ backlogId, verdict, nowMs });
      },
      waitBetweenCloses: async (ms) => {
        waits.push(ms);
      },
    },
    456
  );
  assert.deepEqual(closed, [
    { backlogId: 'BL-1186', verdict: { kind: 'stale' }, nowMs: 456 },
    { backlogId: 'BL-1187', verdict: { kind: 'stale' }, nowMs: 456 },
  ]);
  assert.deepEqual(waits, [150]);
});

test('reconcileStaleApprovalAsks: never closes an ask whose ticket file still exists', async () => {
  const closed = [];
  await reconcileStaleApprovalAsks(
    {
      readApprovalAskMessages: () => ({
        'BL-1186': { topicId: 1, messageId: 10, text: 'ask 1186' },
      }),
      ticketFileExists: () => true,
      closeApprovalAsk: async (backlogId, verdict, nowMs) => {
        closed.push({ backlogId, verdict, nowMs });
      },
    },
    456
  );
  assert.deepEqual(closed, []);
});
