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
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

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

// BL-1691: three cells, one per owned-topic kind, each with a generator
// that FIXES its own kind's field to a bound integer (never undefined) -
// the other two fields stay optionally bound/unbound, unused by this
// test's own assertions - so every cell's own kind is reached on every
// run, never left to a 50/50 fc.option draw plus a 1-in-3 pick.
const OWNED_RANGES = { cursor: { min: 1000, max: 1999 }, bubble: { min: 2000, max: 2999 }, local: { min: 3000, max: 3999 } };
const boundTopicArbFor = (boundKind) =>
  fc.record({
    cursor: boundKind === 'cursor' ? fc.integer(OWNED_RANGES.cursor) : fc.option(fc.integer(OWNED_RANGES.cursor), { nil: undefined }),
    bubble: boundKind === 'bubble' ? fc.integer(OWNED_RANGES.bubble) : fc.option(fc.integer(OWNED_RANGES.bubble), { nil: undefined }),
    local: boundKind === 'local' ? fc.integer(OWNED_RANGES.local) : fc.option(fc.integer(OWNED_RANGES.local), { nil: undefined }),
  });

test('property (invariant): every bridge-owned topic (cursor, Bubble, or local seat) is forwarded whole and never opens a subject', async () => {
  const CELLS = ['cursor', 'bubble', 'local'];
  const PER_CELL_RUNS = runsPerCell(60, CELLS.length);
  const seen = { cursor: 0, bubble: 0, local: 0 };
  let updateId = 1;
  for (const pick of CELLS) {
    await fc.assert(
      fc.asyncProperty(boundTopicArbFor(pick), fc.constant(pick), async (topicMap, pick) => {
        const messageTopicId = topicMap[pick];
        assert.notEqual(messageTopicId, undefined, `cell ${pick}'s own generator failed to bind its topic`);
        seen[pick] += 1;
        updateId += 1;
        const { opened, forwarded } = await routeOne(topicMap, messageTopicId, updateId);
        assert.equal(forwarded.length, 1, `the ${pick} topic's update must be forwarded whole: ${JSON.stringify(forwarded)}`);
        assert.equal(forwarded[0].update_id, updateId);
        assert.deepEqual(opened, [], `a support subject was opened for the owned ${pick} topic: ${JSON.stringify(opened)}`);
      }),
      { numRuns: PER_CELL_RUNS }
    );
  }
  assertReachFloor(seen, CELLS, PER_CELL_RUNS, 'owned-topic-kind');
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
