'use strict';

// BL-2061 declared invariant 2: "A handed-over update is applied by the
// front desk at most once, however many times it is handed over or read."
// Drives the REAL front-desk poll cycle (telegramFrontDeskBotCore's
// pollAndForward) against the REAL hand-over queue (cursorBridgeHandoverQueue),
// appending the SAME update a random number of times and draining it across
// a random number of poll cycles - the generator must reach both a single
// appearance and several duplicate re-appends/re-drains, or a property that
// only ever sees one append would prove nothing about redelivery.
//
// Non-vacuous: confirmed red (applied once per drain rather than once ever)
// by temporarily removing the isHandoverApplied dedup check in
// pollAndForward, then restoring it.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');

const { pollAndForward } = require('../out/tools/telegramFrontDeskBotCore');
const {
  appendCursorBridgeHandoverUpdate,
  drainCursorBridgeHandoverUpdates,
  isHandoverUpdateApplied,
  recordAppliedHandoverId,
} = require('../out/tools/cursorBridgeHandoverQueue');
const { mkTmpDir } = require('./helpers/tmpDir');

const PRINCIPAL_ID = '42';

function approveUpdate(updateId, backlogId) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cbq-${updateId}`,
      data: `approve:${backlogId}`,
      from: { id: PRINCIPAL_ID },
      message: { message_id: updateId, chat: { id: '-100' }, message_thread_id: 1 },
    },
  };
}

function adaptersOver(opDir, applyCalls) {
  return {
    chatId: '-100',
    getUpdates: async () => ({ success: true, updates: [] }),
    postToBridge: async () => true,
    subjectForTopic: () => undefined,
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for an approve callback');
    },
    backlogForTopic: () => undefined,
    postOperatorContext: async () => true,
    answerCallbackQuery: async () => {},
    setPendingButtonAction: async () => {},
    recordApprovalReply: async () => {
      applyCalls.push('approve');
      return true;
    },
    recordRejectionReply: async () => true,
    recordAmendReply: async () => true,
    drainHandoverUpdates: async () => drainCursorBridgeHandoverUpdates(opDir),
    isHandoverApplied: (updateId) => isHandoverUpdateApplied(opDir, updateId),
    recordHandoverApplied: (updateId) => recordAppliedHandoverId(opDir, updateId),
  };
}

test('property (BL-2061 invariant 2): a handed-over update is applied at most once, however many times it is re-appended or the front desk polls', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 1_000_000 }),
      fc.integer({ min: 1, max: 5 }),
      fc.integer({ min: 1, max: 5 }),
      async (updateId, reappends, polls) => {
        const root = mkTmpDir('bl2061-applied-once-');
        const opDir = path.join(root, '.swarmforge', 'operator');
        fs.mkdirSync(opDir, { recursive: true });
        const applyCalls = [];
        const update = approveUpdate(updateId, 'BL-9999');
        // The bridge re-appending the SAME update (a crash before the
        // front desk recorded it applied) is the redelivery this invariant
        // guards: several appends land in the queue before any drain.
        for (let i = 0; i < reappends; i += 1) {
          appendCursorBridgeHandoverUpdate(opDir, update);
        }
        for (let i = 0; i < polls; i += 1) {
          await pollAndForward(0, PRINCIPAL_ID, adaptersOver(opDir, applyCalls));
        }
        assert.equal(applyCalls.length, 1, `expected the approval to apply exactly once across ${reappends} re-appends and ${polls} polls, got ${applyCalls.length}`);
      }
    ),
    { numRuns: 30 }
  );
});
