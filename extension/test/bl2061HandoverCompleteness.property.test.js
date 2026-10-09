'use strict';

// BL-2061 declared invariant 1: "Every update the bridge reads while it
// holds getUpdates is either handled by the bridge or handed to the front
// desk; none is consumed and dropped." Drives the REAL bridge dispatch
// (telegramCursorBridgeLive's runCursorBridgePollOnce, dead-feeder fallback
// mode) against randomly generated updates varying topicId, cursor/bubble
// topic configuration, callback/plain-text/poll_answer/unparseable shape,
// and (for poll_answer) which of the bridge's own three poll-tracking shapes
// it matches - the generator must reach both an owned and a foreign update
// of every kind across its runs, or a property that only ever sees one
// shape would prove nothing about the boundary this invariant is about.
//
// Non-vacuous: confirmed red (an unscoped update silently vanishing,
// appearing in neither the handover queue nor any bridge-side effect) by
// temporarily hardcoding isScopedToCursorTopic's bridge-side callsite to
// always return true (never hands over), then restoring it.
//
// BL-2061 D1 (QA bounce 2026-10-08): extended to draw poll_answer and
// unparseable shapes too - the pre-fix generator only ever drew text/
// callback updates in a topic, so it never reached the `continue` that
// skipped the hand-over for a poll_answer or an update inboundEventOf
// cannot parse at all. Every poll_answer here votes as a NON-principal
// user (999, never PRINCIPAL_ID): the hand-over decision (isBridgeOwnPollAnswer)
// is structural, matching only on poll id, never on who voted - so an
// unauthorized vote exercises it identically to an authorized one while
// never passing any own-poll processor's isAuthorizedPrincipal gate, which
// keeps every "own" case a safe no-op (never starting the mocked agent
// session a pendingChoicePolls match would otherwise fire-and-forget).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runCursorBridgePollOnce } = require('../out/tools/telegramCursorBridgeLive');
const { createMockCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');
const { cursorBridgeHandoverQueuePath, drainCursorBridgeHandoverUpdates } = require('../out/tools/cursorBridgeHandoverQueue');
const { mkTmpDir } = require('./helpers/tmpDir');

const CHAT_ID = '-100';
const PRINCIPAL_ID = '42';
const CURSOR_TOPIC_ID = 55;
const BUBBLE_TOPIC_ID = 66;

function mkTextUpdate(id, topicId, text) {
  return {
    update_id: id,
    message: { message_id: id, chat: { id: CHAT_ID }, message_thread_id: topicId, from: { id: PRINCIPAL_ID }, text },
  };
}

function mkCallbackUpdate(id, topicId, data) {
  return {
    update_id: id,
    callback_query: {
      id: `cbq-${id}`,
      data,
      from: { id: PRINCIPAL_ID },
      message: { message_id: id, chat: { id: CHAT_ID }, message_thread_id: topicId },
    },
  };
}

// BL-2061 D1: a poll_answer carries no topic at all - ownership is decided
// by poll id, never by a topic/chat. The voter is deliberately never
// PRINCIPAL_ID (see the file header comment).
function mkPollAnswerUpdate(id, pollId) {
  return {
    update_id: id,
    poll_answer: { poll_id: pollId, option_ids: [0], user: { id: 999 } },
  };
}

// BL-2061 D1: a callback_query with no `data` - inboundEventOf returns
// undefined for it (the exact "a callback with no data" shape the ticket's
// remediation names), so it carries neither a topic nor any other route.
function mkUnparseableUpdate(id) {
  return {
    update_id: id,
    callback_query: { id: `cbq-${id}`, from: { id: PRINCIPAL_ID }, message: { message_id: id, chat: { id: CHAT_ID } } },
  };
}

const OWN_POLL_ID = 'own-poll-1';
const FOREIGN_POLL_ID = 'foreign-poll-1';

// topicId is drawn so roughly half the runs land on a bridge-owned topic
// (cursor, bubble) and half on a foreign one.
const topicIdArb = fc.oneof(
  fc.constant(CURSOR_TOPIC_ID),
  fc.constant(BUBBLE_TOPIC_ID),
  fc.integer({ min: 100, max: 999 }),
);

// The three shapes isBridgeOwnPollAnswer recognizes as the bridge's own.
const ownPollShapeArb = fc.constantFrom('pendingPromptPoll', 'supersededPollId', 'pendingChoicePoll');

const updateArb = fc.oneof(
  fc.tuple(topicIdArb, fc.boolean(), fc.string({ maxLength: 20 })).map(([topicId, isCallback, text]) => ({
    kind: 'topic-scoped',
    topicId,
    isCallback,
    text,
  })),
  fc.tuple(fc.boolean(), ownPollShapeArb).map(([isOwn, ownPollShape]) => ({
    kind: 'poll-answer',
    isOwn,
    ownPollShape,
  })),
  fc.constant({ kind: 'unparseable' })
);

// Builds the update plus any bridge-own-poll state the draw calls for.
// Returns { update, initialState, expectHandedOver }.
function planDraw(updateId, draw) {
  const baseState = { updateOffset: 0, cursorTopicId: CURSOR_TOPIC_ID, bubbleTopicId: BUBBLE_TOPIC_ID };
  if (draw.kind === 'topic-scoped') {
    const { topicId, isCallback, text } = draw;
    const update = isCallback ? mkCallbackUpdate(updateId, topicId, `unrecognized:${text}`) : mkTextUpdate(updateId, topicId, text || ' ');
    return { update, initialState: baseState, expectHandedOver: !(topicId === CURSOR_TOPIC_ID || topicId === BUBBLE_TOPIC_ID) };
  }
  if (draw.kind === 'poll-answer') {
    const update = mkPollAnswerUpdate(updateId, draw.isOwn ? OWN_POLL_ID : FOREIGN_POLL_ID);
    if (!draw.isOwn) {
      return { update, initialState: baseState, expectHandedOver: true };
    }
    if (draw.ownPollShape === 'pendingPromptPoll') {
      return { update, initialState: { ...baseState, pendingPromptPoll: { pollId: OWN_POLL_ID, itemIds: ['qp-1'] } }, expectHandedOver: false };
    }
    if (draw.ownPollShape === 'supersededPollId') {
      return { update, initialState: { ...baseState, supersededPromptPollIds: [OWN_POLL_ID] }, expectHandedOver: false };
    }
    return {
      update,
      initialState: { ...baseState, pendingChoicePolls: [{ pollId: OWN_POLL_ID, question: 'q', options: ['a', 'b'], createdAtMs: 0 }] },
      expectHandedOver: false,
    };
  }
  // 'unparseable'
  return { update: mkUnparseableUpdate(updateId), initialState: baseState, expectHandedOver: true };
}

test('property (BL-2061 invariant 1): every update the bridge reads is either bridge-owned or handed to the front desk, never both, never neither', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 1_000_000 }), updateArb, (updateId, draw) => {
      const root = mkTmpDir('bl2061-completeness-');
      const opDir = path.join(root, '.swarmforge', 'operator');
      fs.mkdirSync(opDir, { recursive: true });
      const statePath = path.join(opDir, 'cursor-bridge-state.json');

      const { update, initialState, expectHandedOver } = planDraw(updateId, draw);
      fs.writeFileSync(statePath, JSON.stringify(initialState));

      const bridgePosts = [];
      const deps = {
        repoRoot: root,
        botToken: 'token',
        chatId: CHAT_ID,
        principalUserId: PRINCIPAL_ID,
        opDir,
        statePath,
        topicMapPath: path.join(opDir, 'cursor-bridge-topic-map.json'),
        agentSession: createMockCursorBridgeAgentSession(root),
        post: async (_bt, _cid, tId, message, replyToMessageId) => {
          bridgePosts.push({ topicId: tId, message, replyToMessageId });
        },
        // Fixtures only - never a live Telegram call. answerCallbackQuery's
        // call site for a handed-over callback uses this seam.
        telegramPostFn: async () => ({ ok: true, status: 200, json: { ok: true, result: {} } }),
        inboundQueueIdleMs: 1,
        useInboundQueue: false,
        getUpdates: async () => ({ success: true, updates: [update] }),
      };

      return runCursorBridgePollOnce(deps, initialState, false, 0).then(() => {
        const handedOver = drainCursorBridgeHandoverUpdates(opDir);
        if (expectHandedOver) {
          assert.equal(handedOver.length, 1, `update (${JSON.stringify(draw)}) was not handed over - it was silently dropped`);
          assert.equal(handedOver[0].update_id, updateId);
        } else {
          assert.equal(handedOver.length, 0, `a bridge-owned update (${JSON.stringify(draw)}) was handed over to the front desk`);
        }
      });
    }),
    { numRuns: 60 }
  );
});
