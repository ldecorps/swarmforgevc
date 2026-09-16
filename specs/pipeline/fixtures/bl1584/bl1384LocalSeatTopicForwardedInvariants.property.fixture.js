'use strict';

// BL-1384 declared invariant (BL-654: coder-authored property test):
//
// "A topic the bridge process owns - cursor host, Bubble, or the local seat -
// is forwarded whole to the bridge inbound queue and never opens a support
// subject, whether or not the bridge is currently draining."
//
// Drives the REAL front-desk dispatch (pollAndForward -> processMessageUpdate
// -> attemptCursorBridgeTopicExclusion) over randomized combinations of which
// of the three bridge-owned topics are bound and which topic the message
// actually arrives in - the invariant must hold for EVERY owned topic, not
// just the one this ticket adds, and the companion property pins the other
// side: an unowned topic must still open its subject exactly as before.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { pollAndForward } = require('../out/tools/telegramFrontDeskBotCore');

const PRINCIPAL_ID = 111;

function mkUpdate(topicId, text, updateId) {
  return {
    update_id: updateId,
    message: { message_id: updateId, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: topicId, text },
  };
}

async function routeOne(topicMap, messageTopicId, updateId) {
  const opened = [];
  const forwarded = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate(messageTopicId, 'hello', updateId)] }),
    postToBridge: async () => true,
    subjectForTopic: () => undefined,
    openSubjectAndRecord: async (topicId) => {
      opened.push(topicId);
      return 'SUP-1';
    },
    ...(topicMap.cursor !== undefined ? { cursorBridgeTopicId: async () => topicMap.cursor } : {}),
    ...(topicMap.bubble !== undefined ? { bubbleTopicId: async () => topicMap.bubble } : {}),
    ...(topicMap.local !== undefined ? { qwenLocalSeatTopicId: async () => topicMap.local } : {}),
    forwardCursorBridgeUpdate: async (u) => {
      forwarded.push(u);
      return true;
    },
  });
  return { result, opened, forwarded };
}

// Three independent topic ids, each present or absent, drawn from disjoint
// ranges so no owned topic can accidentally collide with another or with the
// message's own topic unless the property deliberately means it to.
const ownedTopicArb = fc.record({
  cursor: fc.option(fc.integer({ min: 1000, max: 1999 }), { nil: undefined }),
  bubble: fc.option(fc.integer({ min: 2000, max: 2999 }), { nil: undefined }),
  local: fc.option(fc.integer({ min: 3000, max: 3999 }), { nil: undefined }),
});

test('property (invariant): every bridge-owned topic (cursor, Bubble, or local seat) is forwarded whole and never opens a subject', async () => {
  const seen = { cursor: 0, bubble: 0, local: 0 };
  let updateId = 1;
  await fc.assert(
    fc.asyncProperty(ownedTopicArb, fc.constantFrom('cursor', 'bubble', 'local'), async (topicMap, pick) => {
      const messageTopicId = topicMap[pick];
      if (messageTopicId === undefined) {
        // This owned-topic kind was not bound in this draw - not applicable.
        return;
      }
      seen[pick] += 1;
      updateId += 1;
      const { opened, forwarded } = await routeOne(topicMap, messageTopicId, updateId);
      assert.equal(forwarded.length, 1, `the ${pick} topic's update must be forwarded whole: ${JSON.stringify(forwarded)}`);
      assert.equal(forwarded[0].update_id, updateId);
      assert.deepEqual(opened, [], `a support subject was opened for the owned ${pick} topic: ${JSON.stringify(opened)}`);
    }),
    { numRuns: 60 }
  );
  assert.ok(
    seen.cursor >= 1 && seen.bubble >= 1 && seen.local >= 1,
    `generator never reached all three owned-topic kinds: ${JSON.stringify(seen)}`
  );
});

test('property (invariant, the other side): a topic none of the three own still opens its subject exactly as before', async () => {
  let updateId = 100000;
  await fc.assert(
    fc.asyncProperty(
      ownedTopicArb,
      fc.integer({ min: 1, max: 999 }), // deliberately outside every owned range above
      async (topicMap, messageTopicId) => {
        updateId += 1;
        const { opened, forwarded } = await routeOne(topicMap, messageTopicId, updateId);
        assert.deepEqual(forwarded, [], `an unowned topic must never be forwarded: ${JSON.stringify(forwarded)}`);
        assert.deepEqual(opened, [messageTopicId], `an unowned topic must still open its subject: ${JSON.stringify(opened)}`);
      }
    ),
    { numRuns: 30 }
  );
});
