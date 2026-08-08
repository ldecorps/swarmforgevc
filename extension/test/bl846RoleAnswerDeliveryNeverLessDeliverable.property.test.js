const assert = require('node:assert/strict');
const fc = require('fast-check');
const { pollAndForward, roleAskThreadId } = require('../out/tools/telegramFrontDeskBotCore');

// BL-846 invariant 2 (coder.prompt's Invariants section - first authorship
// rests with the coder): "No answer becomes less deliverable than it is
// today: whenever the live-pane leg does not deliver, the queued-note leg
// still runs, and the per-role pending marker clears only when one of the
// two actually captured the answer."
//
// This orchestration (captureRoleAnswer, telegramFrontDeskBotCore.ts) is NOT
// changed by BL-846 - the fix is resolution-only (resolveRolePaneTarget) -
// but the invariant is DECLARED on the ticket, so it still gets its own
// property-test encoding per the Invariants section ("in every path this
// ticket writes... no path leaves the architect authoring it"). Drives the
// REAL compiled pollAndForward -> deliverAskAnswer -> captureRoleAnswer
// chain (a role-question button tap) against every one of the four
// (delivered, enqueueSucceeds) combinations, fake only at the
// redirectToRole/enqueueRoleAnswerNote/clearRolePendingQuestion adapter
// boundary - mirrors bl607RoleClarifyingPollSteps.js's own "drive the real
// core, fake only the tmux/queue boundary" posture.
//
// Non-vacuity, checked by hand before landing: changing captureRoleAnswer's
// `delivered || (await enqueueRoleAnswerNote?.(...))` to just `delivered`
// (dropping the queued-note fallback) reproduced the exact failure this
// property is built to catch - the delivered=false/enqueueSucceeds=true case
// stopped queuing a note and stopped clearing the marker; restoring the real
// fallback made it pass again.

const PRINCIPAL_ID = 111;
const ROLE = 'QA';
const THREAD_ID = roleAskThreadId(ROLE);
const ANSWER_LABEL = 'proceed';

function mkCallbackUpdate() {
  return {
    update_id: 1,
    callback_query: { id: 'cbq-1', data: `ask:${THREAD_ID}:0`, from: { id: PRINCIPAL_ID }, message: { chat: { id: 1 } } },
  };
}

async function runScenario(delivered, enqueueSucceeds) {
  const redirected = [];
  const queuedNotes = [];
  const clearedRoles = [];
  await pollAndForward(0, String(PRINCIPAL_ID), {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkCallbackUpdate()] }),
    postToBridge: async () => {
      throw new Error('postToBridge should never be called for a role question');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a role-topic answer');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: () => undefined,
    readRoleTopicMap: () => ({}),
    redirectToRole: async (role, text) => {
      redirected.push({ role, text });
      return delivered ? { kind: 'delivered' } : { kind: 'no-pane' };
    },
    getRolePendingQuestion: async (role) => role === ROLE,
    clearRolePendingQuestion: async (role) => {
      clearedRoles.push(role);
    },
    enqueueRoleAnswerNote: async (role, text) => {
      queuedNotes.push({ role, text });
      return enqueueSucceeds;
    },
    answerCallbackQuery: async () => {},
    resolveAskOptions: async (threadId) => (threadId === THREAD_ID ? [{ label: ANSWER_LABEL }] : undefined),
  });
  return { redirected, queuedNotes, clearedRoles };
}

test('property: whenever the live-pane leg does not deliver, the queued-note leg still runs, and the pending marker clears only when one leg actually captured it', async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), fc.boolean(), async (delivered, enqueueSucceeds) => {
      const { queuedNotes, clearedRoles } = await runScenario(delivered, enqueueSucceeds);

      if (delivered) {
        assert.equal(queuedNotes.length, 0, 'a delivered live-pane answer must never also be queued as a note');
      } else {
        assert.equal(queuedNotes.length, 1, 'a non-delivered answer must always fall through to the queued-note leg');
        assert.deepEqual(queuedNotes[0], { role: ROLE, text: ANSWER_LABEL });
      }

      const captured = delivered || enqueueSucceeds;
      if (captured) {
        assert.deepEqual(clearedRoles, [ROLE], 'expected the pending marker cleared once one leg actually captured the answer');
      } else {
        assert.deepEqual(clearedRoles, [], 'expected the pending marker LEFT SET when neither leg captured the answer - never silently lost');
      }
    }),
    { numRuns: 20 }
  );
});
