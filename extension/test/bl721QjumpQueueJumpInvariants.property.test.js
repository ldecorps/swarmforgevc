const assert = require('node:assert/strict');
const fc = require('fast-check');
const { decideTopicAction } = require('../out/concierge/topicRouter');
const { decideCallbackQueryAction, pollAndForward, APPROVALS_SUBJECT_ID } = require('../out/tools/telegramFrontDeskBotCore');
const { classifyApprovalsTopicReply } = require('../out/concierge/pendingApprovalReply');
const { parseExpediteTicket } = require('../out/tools/telegramCursorBridgeExpedite');

// BL-721/BL-654: coder-authored property tests for the ticket's three
// declared invariants. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs) - excluded from the normal unit/coverage/
// mutation run, same separation as every other *.property.test.js file.

const PRINCIPAL_ID = 111;
const APPROVALS_TOPIC_ID = 750;

// BL-xxx-shaped ids (never a bare random string) - the same reachable space
// every real ticket id occupies, and the exact shape parseExpediteTicket's
// own normalizeExpediteTicket requires to recognize a ticket at all.
const backlogIdArb = fc.stringMatching(/^BL-[0-9]{1,6}$/);

function mkCallbackUpdate(data) {
  return {
    update_id: 1,
    callback_query: { id: 'cbq-1', data, from: { id: PRINCIPAL_ID }, message: { chat: { id: 1 }, message_thread_id: APPROVALS_TOPIC_ID } },
  };
}

function mkQjumpTextUpdate(backlogId) {
  return {
    update_id: 1,
    message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: APPROVALS_TOPIC_ID, text: `/qjump ${backlogId}` },
  };
}

// ── Declared invariant 1 ──────────────────────────────────────────────────
// "The Approvals ask fourth button is labeled Q jump (not Expedite);
// tapping it still approve + promote + dispatch into the live swarm (BL-490
// behavior unchanged)."
//
// decideTopicAction's button builder and decideCallbackQueryAction's
// callback_data decoder are two SEPARATE pure functions, joined only by the
// callback_data string that flows from one to the other - exactly the seam
// a label-vs-behavior regression would slip through (e.g. a rename that
// accidentally also touched the callback_data, or a decoder that started
// keying off button text instead of the data payload). Checked here for
// every reachable ticket id, not just one hand-picked example.
test('property: the Approvals ask fourth button is always labeled "Q jump" with callback_data expedite:<id>, and that callback_data always decodes back to the expedite action for the SAME ticket', () => {
  fc.assert(
    fc.property(backlogIdArb, (backlogId) => {
      const action = decideTopicAction({ type: 'ApprovalRequested', backlogId, payload: {} }, {}, 'a fine feature');
      const fourthButton = action.buttons[0][3];
      assert.equal(fourthButton.text, 'Q jump', 'expected the fourth button to always read "Q jump", never "Expedite"');
      assert.equal(fourthButton.callbackData, `expedite:${backlogId}`, 'expected callback_data to stay on the expedite: namespace for compatibility');

      const decision = decideCallbackQueryAction(mkCallbackUpdate(fourthButton.callbackData).callback_query, PRINCIPAL_ID, '1');
      assert.deepEqual(decision, { action: 'expedite', backlogId }, 'expected the SAME expedite decision regardless of the button label text');
    }),
    { numRuns: 200 }
  );
});

test('non-vacuity (invariant 1): a build that reverted the label back to "Expedite" would fail the property above', () => {
  const action = decideTopicAction({ type: 'ApprovalRequested', backlogId: 'BL-1', payload: {} }, {}, 't');
  const fourthButton = action.buttons[0][3];
  assert.notEqual(fourthButton.text, 'Expedite', 'sanity check: the production button must not still read Expedite');
});

// ── Declared invariant 2 ──────────────────────────────────────────────────
// "A Telegram front-desk slash verb /qjump BL-xxx performs the same
// queue-jump effects as that button for an eligible ticket."
//
// Runs BOTH entry points (a button tap, and a typed "/qjump <id>" reply)
// through the real pollAndForward dispatch, against adapters that log every
// queue-jump side effect call - then asserts the two call sequences are
// IDENTICAL for the same backlogId. A divergence here (e.g. /qjump skipping
// promoteTicketIfPaused, or never checking the file-collision safety net)
// would be exactly the kind of "same effects" regression this invariant
// guards, and would not be caught by two separately-pinned example tests
// that each only ever look at their own single call log.
function loggingAdapters(calls, subjectForTopic) {
  return {
    chatId: '1',
    subjectForTopic,
    backlogForTopic: () => undefined,
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for an Approvals-topic decision');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for an Approvals-topic decision');
    },
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for an Approvals-topic decision');
    },
    recordApprovalReply: async (backlogId) => {
      calls.push(['recordApprovalReply', backlogId]);
      return true;
    },
    recordRejectionReply: async () => {
      throw new Error('recordRejectionReply should not be called for a queue-jump decision');
    },
    promoteTicketIfPaused: async (backlogId) => {
      calls.push(['promoteTicketIfPaused', backlogId]);
      return true;
    },
    commitExpediteWrites: async (backlogId) => {
      calls.push(['commitExpediteWrites', backlogId]);
      return true;
    },
    checkExpediteFileCollision: async (backlogId) => {
      calls.push(['checkExpediteFileCollision', backlogId]);
      return undefined;
    },
    dispatchExpediteBuild: async (backlogId) => {
      calls.push(['dispatchExpediteBuild', backlogId]);
      return true;
    },
    answerCallbackQuery: async () => {},
    notifyApprovalsTopic: async () => true,
  };
}

test('property: "/qjump <id>" triggers the exact same queue-jump effect sequence as tapping the Q jump button, for the same ticket', async () => {
  await fc.assert(
    fc.asyncProperty(backlogIdArb, async (backlogId) => {
      const buttonCalls = [];
      await pollAndForward(0, PRINCIPAL_ID, {
        ...loggingAdapters(buttonCalls, () => undefined),
        getUpdates: async () => ({ success: true, updates: [mkCallbackUpdate(`expedite:${backlogId}`)] }),
      });

      const typedCalls = [];
      await pollAndForward(0, PRINCIPAL_ID, {
        ...loggingAdapters(typedCalls, (topicId) => (topicId === APPROVALS_TOPIC_ID ? APPROVALS_SUBJECT_ID : undefined)),
        getUpdates: async () => ({ success: true, updates: [mkQjumpTextUpdate(backlogId)] }),
      });

      assert.deepEqual(typedCalls, buttonCalls, 'expected the typed /qjump verb to fire the identical effect sequence as the button tap');
      assert.deepEqual(
        buttonCalls.map((c) => c[0]),
        ['recordApprovalReply', 'promoteTicketIfPaused', 'commitExpediteWrites', 'checkExpediteFileCollision', 'dispatchExpediteBuild'],
        'sanity check: the button path itself still fires every BL-490 queue-jump effect, in order'
      );
    }),
    { numRuns: 50 }
  );
});

test('non-vacuity (invariant 2): a /qjump delivery that skipped recordExpediteDecisionAndClose (calling the plain approve routine instead) would fail the property above', async () => {
  const buttonCalls = [];
  await pollAndForward(0, PRINCIPAL_ID, {
    ...loggingAdapters(buttonCalls, () => undefined),
    getUpdates: async () => ({ success: true, updates: [mkCallbackUpdate('expedite:BL-1')] }),
  });
  const approveOnlyCalls = [];
  await pollAndForward(0, PRINCIPAL_ID, {
    ...loggingAdapters(approveOnlyCalls, (topicId) => (topicId === APPROVALS_TOPIC_ID ? APPROVALS_SUBJECT_ID : undefined)),
    getUpdates: async () => ({ success: true, updates: [{ update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: APPROVALS_TOPIC_ID, text: 'approve BL-1' } }] }),
  });
  assert.notDeepEqual(approveOnlyCalls, buttonCalls, 'sanity check: a plain approve reply must NOT fire the same effect sequence as a queue-jump');
});

// ── Declared invariant 3 ──────────────────────────────────────────────────
// "Offline expeditor stays on /expedite (Cursor bridge); /qjump never
// starts the offline expeditor; queue-jump ≠ expeditor."
//
// Constructs BOTH commands from the SAME generated id (never two
// independently-drawn strings that might coincidentally collide) and checks
// the two parsers are mutually exclusive across the whole reachable id
// space: "/qjump <id>" is recognized by the Approvals-topic queue-jump
// grammar and NEVER by the offline expeditor's parser; "/expedite <id>" is
// recognized by the offline expeditor's parser and NEVER classified as a
// queue-jump by the Approvals-topic grammar.
test('property: "/qjump <id>" is recognized as a queue-jump and NEVER as an offline-expedite invocation; "/expedite <id>" is recognized by the offline expeditor and NEVER as a queue-jump', () => {
  fc.assert(
    fc.property(backlogIdArb, (backlogId) => {
      const qjumpText = `/qjump ${backlogId}`;
      const expediteText = `/expedite ${backlogId}`;

      assert.deepEqual(classifyApprovalsTopicReply(qjumpText), { kind: 'qjump', backlogId });
      assert.equal(parseExpediteTicket(qjumpText), undefined, 'expected /qjump to NEVER start the offline expeditor');

      assert.equal(parseExpediteTicket(expediteText), backlogId, 'expected /expedite to still route to the offline expeditor, unchanged');
      assert.notEqual(classifyApprovalsTopicReply(expediteText).kind, 'qjump', 'expected /expedite to NEVER be classified as a queue-jump');
    }),
    { numRuns: 200 }
  );
});

test('non-vacuity (invariant 3): if classifyApprovalsTopicReply treated "/expedite" as an alias for "/qjump", the property above would fail', () => {
  // Mirrors the defect this property guards against: a queue-jump grammar
  // that (wrongly) also matched the offline expeditor's own verb.
  const aliasedClassify = (text) => {
    const trimmed = text.trim();
    if (/^\/(qjump|expedite)\s+(\S+)\s*$/i.test(trimmed)) {
      const match = trimmed.match(/^\/(qjump|expedite)\s+(\S+)\s*$/i);
      return { kind: 'qjump', backlogId: match[2] };
    }
    return classifyApprovalsTopicReply(text);
  };
  assert.equal(aliasedClassify('/expedite BL-1').kind, 'qjump', 'sanity check: the deliberately-broken aliased classifier DOES misclassify /expedite as qjump');
  assert.notEqual(classifyApprovalsTopicReply('/expedite BL-1').kind, 'qjump', 'the real classifier must not');
});
