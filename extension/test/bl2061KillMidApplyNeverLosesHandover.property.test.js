'use strict';

// BL-2061 declared invariant 1: "Every update the bridge reads while it
// holds getUpdates is either handled by the bridge or handed to the front
// desk; none is consumed and dropped." bl2061HandoverCompleteness.property.test.js
// covers the BRIDGE's own drop-vs-hand-over decision; this file covers the
// FRONT DESK side of the same invariant - a hand-over, once drained, must
// still reach delivery even if the front desk is killed between the drain
// and applying every entry (QA bounce D1, 2026-10-09: "kill mid-apply loses
// drained hand-overs"). Drives the REAL durable drain
// (cursorBridgeHandoverQueue's drainCursorBridgeHandoverUpdatesDurable) and
// the REAL front-desk apply cycle (telegramFrontDeskBotCore's
// pollAndForward), varying how many entries were queued and how many times
// in a row the front desk "crashes" (drains durably but never commits)
// before a cycle finally succeeds - the generator must reach zero crashes
// (the ordinary path) and several in a row, or a property that only ever
// sees one would prove nothing about the recovery this invariant depends on.
//
// Non-vacuous: confirmed red (entries queued before any crash cycle were
// posted zero times once a crash occurred) by swapping the crash-cycle
// simulation to the non-durable drainCursorBridgeHandoverUpdates (immediate,
// unconditional unlink - the pre-D3 shape), then restoring the durable one.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');

const { pollAndForward } = require('../out/tools/telegramFrontDeskBotCore');
const {
  appendCursorBridgeHandoverUpdate,
  drainCursorBridgeHandoverUpdatesDurable,
  isHandoverUpdateApplied,
  recordAppliedHandoverId,
} = require('../out/tools/cursorBridgeHandoverQueue');
const { mkTmpDir } = require('./helpers/tmpDir');

const PRINCIPAL_ID = '42';
const TOPIC_ID = 7;

function mkUpdate(updateId) {
  return {
    update_id: updateId,
    message: { message_id: updateId, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: TOPIC_ID, text: `u${updateId}` },
  };
}

test('property (BL-2061 invariant 1, D1): a hand-over survives any number of front-desk crashes mid-apply, never lost, never duplicated', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 5 }),
      fc.integer({ min: 0, max: 4 }),
      async (updateIds, crashCycles) => {
        const root = mkTmpDir('bl2061-kill-mid-apply-');
        const opDir = path.join(root, '.swarmforge', 'operator');
        fs.mkdirSync(opDir, { recursive: true });
        for (const id of updateIds) {
          appendCursorBridgeHandoverUpdate(opDir, mkUpdate(id));
        }

        // Each "crash": the front desk drains durably (entries leave the
        // live queue file) but dies before applying or committing anything
        // at all - exactly the window D1 found. A commit is never called,
        // so the next drain (another crash, or the final real cycle below)
        // must recover every entry again.
        for (let i = 0; i < crashCycles; i += 1) {
          const killed = drainCursorBridgeHandoverUpdatesDurable(opDir);
          assert.deepEqual(
            killed.updates.map((u) => u.update_id).sort(),
            [...updateIds].sort(),
            `crash cycle ${i} must still see every entry - nothing committed yet`
          );
        }

        // The real, final cycle: wired exactly as production's
        // buildPollAdapters wires it (durable drain, commit only after
        // every entry is applied/re-queued).
        let pendingCommit;
        const posted = [];
        const result = await pollAndForward(0, PRINCIPAL_ID, {
          chatId: '1',
          drainHandoverUpdates: () => {
            const { updates, commit } = drainCursorBridgeHandoverUpdatesDurable(opDir);
            pendingCommit = commit;
            return Promise.resolve(updates);
          },
          commitHandoverDrain: () => pendingCommit?.(),
          isHandoverApplied: (updateId) => isHandoverUpdateApplied(opDir, updateId),
          recordHandoverApplied: (updateId) => recordAppliedHandoverId(opDir, updateId),
          getUpdates: async () => ({ success: true, updates: [] }),
          postToBridge: async (_subjectId, _text, updateId) => {
            posted.push(updateId);
            return true;
          },
          subjectForTopic: (topicId) => (topicId === TOPIC_ID ? 'SUP-1' : undefined),
          openSubjectAndRecord: async () => {
            throw new Error('openSubjectAndRecord should not be called - every update here is topic-scoped');
          },
          nextOffset: (_updates, current) => current,
        });

        assert.deepEqual(
          posted.slice().sort((a, b) => a - b),
          [...updateIds].sort((a, b) => a - b),
          `every queued update must be posted exactly once across ${crashCycles} crash(es), never lost, never duplicated`
        );
        assert.equal(result.posted, updateIds.length);

        // Nothing left to recover once the real cycle committed.
        const after = drainCursorBridgeHandoverUpdatesDurable(opDir);
        assert.deepEqual(after.updates, [], 'nothing should remain after a successful, committed cycle');
        after.commit();
      }
    ),
    { numRuns: 30 }
  );
});
