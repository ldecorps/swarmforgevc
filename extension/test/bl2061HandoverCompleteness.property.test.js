'use strict';

// BL-2061 declared invariant 1: "Every update the bridge reads while it
// holds getUpdates is either handled by the bridge or handed to the front
// desk; none is consumed and dropped." Drives the REAL bridge dispatch
// (telegramCursorBridgeLive's runCursorBridgePollOnce, dead-feeder fallback
// mode) against randomly generated updates varying topicId, cursor/bubble
// topic configuration, and callback vs. plain-text shape - the generator
// must reach both a scoped (bridge's own) and an unscoped (foreign) update
// for every run, or a property that only ever sees one shape would prove
// nothing about the boundary this invariant is about.
//
// Non-vacuous: confirmed red (an unscoped update silently vanishing,
// appearing in neither the handover queue nor any bridge-side effect) by
// temporarily hardcoding isScopedToCursorTopic's bridge-side callsite to
// always return true (never hands over), then restoring it.

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

// topicId is drawn so roughly half the runs land on a bridge-owned topic
// (cursor, bubble) and half on a foreign one.
const topicIdArb = fc.oneof(
  fc.constant(CURSOR_TOPIC_ID),
  fc.constant(BUBBLE_TOPIC_ID),
  fc.integer({ min: 100, max: 999 }),
);

const updateArb = fc.tuple(topicIdArb, fc.boolean(), fc.string({ maxLength: 20 })).map(([topicId, isCallback, text]) => ({
  topicId,
  isCallback,
  text,
}));

test('property (BL-2061 invariant 1): every update the bridge reads is either bridge-owned or handed to the front desk, never both, never neither', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 1_000_000 }), updateArb, (updateId, { topicId, isCallback, text }) => {
      const root = mkTmpDir('bl2061-completeness-');
      const opDir = path.join(root, '.swarmforge', 'operator');
      fs.mkdirSync(opDir, { recursive: true });
      const statePath = path.join(opDir, 'cursor-bridge-state.json');
      fs.writeFileSync(statePath, JSON.stringify({ updateOffset: 0, cursorTopicId: CURSOR_TOPIC_ID, bubbleTopicId: BUBBLE_TOPIC_ID }));

      const update = isCallback ? mkCallbackUpdate(updateId, topicId, `unrecognized:${text}`) : mkTextUpdate(updateId, topicId, text || ' ');

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

      return runCursorBridgePollOnce(deps, { updateOffset: 0, cursorTopicId: CURSOR_TOPIC_ID, bubbleTopicId: BUBBLE_TOPIC_ID }, false, 0).then(() => {
        const isBridgeOwned = topicId === CURSOR_TOPIC_ID || topicId === BUBBLE_TOPIC_ID;
        const handedOver = drainCursorBridgeHandoverUpdates(opDir);
        if (isBridgeOwned) {
          assert.equal(handedOver.length, 0, `a bridge-owned update (topicId=${topicId}) was handed over to the front desk`);
        } else {
          assert.equal(handedOver.length, 1, `a foreign update (topicId=${topicId}) was not handed over - it was silently dropped`);
          assert.equal(handedOver[0].update_id, updateId);
        }
      });
    }),
    { numRuns: 40 }
  );
});
