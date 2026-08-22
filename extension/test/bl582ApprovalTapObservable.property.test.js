const assert = require('node:assert/strict');
const fc = require('fast-check');
const { pollAndForward } = require('../out/tools/telegramFrontDeskBotCore');

// BL-582 (coder.prompt's Invariants section - first authorship of a
// DECLARED invariant's property test rests with the coder): the ticket
// declares "Every approval tap produces an observable, durable outcome - a
// recorded decision or a durable failure record; no code path silently
// no-ops."
//
// Encoded over the REAL pollAndForward across generated callback taps
// mixing every eligibility shape (own/foreign chat, principal/stranger,
// recognized/unrecognized callback_data, a record that flips the ticket vs
// one that changes nothing, a repaint that succeeds vs one that fails):
// for EVERY generated tap, at least one observable trace exists - the
// verdict was recorded, or a diagnostic line naming the reason was emitted.
// Neither happening is the 2026-07-23 incident itself, and is what this
// property refuses.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs);
// excluded from unit/coverage/mutation.
//
// Non-vacuity, checked by hand before landing: deleting the
// emitCallbackDiagnostic call in processCallbackQuery's unauthorized-drop
// branch fails this property on the first generated not-my-chat tap;
// deleting the one in dispatchApproveCallback fails it on the first
// record-no-op. Restored, all pass. The reachability assertion below is
// what keeps that true - a generator that stopped producing (say)
// unrecognized data would let a silent path pass unnoticed, so the floor
// is asserted rather than hoped for.

const PRINCIPAL = '424242';
const CHAT_ID = '1';
const BACKLOG_ID = 'BL-582';

const tapShapeArb = fc.record({
  ownChat: fc.boolean(),
  fromPrincipal: fc.boolean(),
  // 'approve' is the verb this invariant is about; 'snooze' is a
  // well-formed tap whose data this bot cannot act on (a button from an
  // older deployment), the unrecognized-data path.
  verb: fc.constantFrom('approve', 'snooze'),
  recordFlips: fc.boolean(),
  repaintSucceeds: fc.boolean(),
});

// Which observable trace SHOULD exist, derived independently of the
// implementation - so the property is a statement about behaviour, not a
// restatement of the code.
function expectedClass(shape) {
  if (!shape.ownChat) {
    return 'not-my-chat';
  }
  if (!shape.fromPrincipal) {
    return 'not-principal';
  }
  if (shape.verb !== 'approve') {
    return 'unrecognized-data';
  }
  return shape.recordFlips ? 'recorded' : 'record-no-op';
}

function buildAdapters(shape, diagnostics, recorded) {
  return {
    chatId: CHAT_ID,
    getUpdates: async () => ({
      success: true,
      updates: [
        {
          update_id: 1,
          callback_query: {
            id: 'cbq-1',
            data: `${shape.verb}:${BACKLOG_ID}`,
            from: { id: shape.fromPrincipal ? Number(PRINCIPAL) : 999 },
            message: { chat: { id: shape.ownChat ? 1 : 2 }, message_thread_id: 7 },
          },
        },
      ],
    }),
    postToBridge: async () => true,
    openSubjectAndRecord: async () => undefined,
    subjectForTopic: () => undefined,
    backlogForTopic: () => undefined,
    postOperatorContext: async () => true,
    recordApprovalReply: async (backlogId) => {
      if (shape.recordFlips) {
        recorded.push(backlogId);
      }
      return shape.recordFlips;
    },
    recordRejectionReply: async () => shape.recordFlips,
    recordAmendReply: async () => shape.recordFlips,
    setPendingButtonAction: async () => {},
    answerCallbackQuery: async () => {},
    explainApprovalRecordNoOp: async () => 'no-ticket-file',
    readApprovalAskMessage: async () => ({ topicId: 800, messageId: 9, text: 'ask' }),
    editApprovalAskMessage: async () => (shape.repaintSucceeds ? { success: true } : { success: false, error: 'edit refused' }),
    logDiagnostic: (line) => diagnostics.push(line),
  };
}

test('property: no approval tap is ever silent - every tap records a verdict or emits a diagnostic naming why it did not', async () => {
  const reached = new Map();
  await fc.assert(
    fc.asyncProperty(tapShapeArb, async (shape) => {
      const diagnostics = [];
      const recorded = [];
      await pollAndForward(0, PRINCIPAL, buildAdapters(shape, diagnostics, recorded));

      const klass = expectedClass(shape);
      reached.set(klass, (reached.get(klass) ?? 0) + 1);

      // The invariant itself: an observable outcome always exists.
      assert.ok(
        recorded.length > 0 || diagnostics.length > 0,
        `a ${klass} tap produced neither a recorded verdict nor a diagnostic - this is the silent no-op the ticket exists to end`
      );

      if (klass === 'recorded') {
        assert.deepEqual(recorded, [BACKLOG_ID]);
        // A repaint that failed after a successful record is its own
        // durable failure record - the verdict is on disk but the human's
        // ask still shows its buttons, so silence there is the same defect
        // wearing a different hat.
        if (!shape.repaintSucceeds) {
          assert.ok(
            diagnostics.some((line) => line.includes('reason=repaint-failed')),
            'a record that landed but failed to repaint must still say so'
          );
        }
      } else {
        assert.equal(recorded.length, 0, 'a tap that did not record must not claim to have recorded');
        assert.ok(
          diagnostics.some((line) => line.includes(`reason=${klass}`)),
          `the diagnostic must name the ${klass} path specifically, not merely exist`
        );
      }
    }),
    { numRuns: 400 }
  );

  // Reachability floor, asserted rather than hoped for: a generator that
  // stopped producing one of these classes would let that path go silent
  // without this property noticing.
  for (const klass of ['not-my-chat', 'not-principal', 'unrecognized-data', 'record-no-op', 'recorded']) {
    assert.ok((reached.get(klass) ?? 0) >= 10, `the generator must reach ${klass} - it reached it ${reached.get(klass) ?? 0} time(s)`);
  }
});
