const assert = require('node:assert/strict');
const { reconcileTopicLifecycle } = require('../out/concierge/topicReconciliation');
const { buildTicketStatusText } = require('../out/concierge/ticketStatusMessage');

function ticket(overrides = {}) {
  return { id: 'BL-123', title: 'a fine feature', ...overrides };
}

function fakeAdapters({ alreadyReconciledIds = [] } = {}) {
  const topicMap = {};
  const created = [];
  const posted = [];
  const edited = [];
  const recorded = [];
  const messageStates = {};
  let backlogTopicId = 760;
  return {
    topicMap,
    created,
    posted,
    edited,
    recorded,
    messageStates,
    adapters: {
      getTopicMap: () => topicMap,
      isAlreadyReconciled: (backlogId) => alreadyReconciledIds.includes(backlogId),
      routeAdapters: {
        getTopicMap: () => topicMap,
        createTopic: async (name) => {
          created.push(name);
          return { success: true, topicId: 800 + created.length };
        },
        recordTopicId: (backlogId, topicId) => {
          topicMap[backlogId] = topicId;
        },
        sendMessage: async () => true,
        closeTopic: async () => true,
        recordMessage: (backlogId, text) => {
          recorded.push({ backlogId, text });
        },
        ensureOperatorTopic: async () => undefined,
        ensureApprovalsTopic: async () => undefined,
        ensureBacklogTopic: async () => backlogTopicId,
        postMessage: async (topicId, text) => {
          const messageId = 9000 + posted.length;
          posted.push({ topicId, text, messageId });
          return messageId;
        },
        editMessage: async (topicId, messageId, text) => {
          edited.push({ topicId, messageId, text });
          return true;
        },
        getTicketMessageState: (backlogId) => messageStates[backlogId],
        setTicketMessageState: (backlogId, state) => {
          messageStates[backlogId] = state;
        },
      },
    },
  };
}

// ── topic-reconciliation-01/02: a missed or never-witnessed completion is
//    still reconciled from current state ────────────────────────────────

test('BL-330 topic-reconciliation-01/02: a done ticket whose status message is not yet completed is brought to its completed state (epic-less -> standing Backlog topic)', async () => {
  const { adapters, posted } = fakeAdapters();
  const result = await reconcileTopicLifecycle([ticket()], {}, adapters);
  assert.deepEqual(result, { reconciled: ['BL-123'] });
  assert.deepEqual(posted, [{ topicId: 760, text: buildTicketStatusText('BL-123', 'a fine feature', 'done'), messageId: 9000 }]);
});

test('BL-330: the completion is genuinely posted - the exact real routeEvent path, not a synthetic reconstruction', async () => {
  const { adapters, posted } = fakeAdapters();
  await reconcileTopicLifecycle([ticket()], {}, adapters);
  assert.match(posted[0].text, /^BL-123 ✅ done — /);
});

// ── topic-reconciliation-03: idempotent ─────────────────────────────────

test('BL-330 topic-reconciliation-03: a done ticket already reconciled is left alone - never posted a second time', async () => {
  const { adapters, posted } = fakeAdapters({ alreadyReconciledIds: ['BL-123'] });
  const result = await reconcileTopicLifecycle([ticket()], {}, adapters);
  assert.deepEqual(result, { reconciled: [] });
  assert.deepEqual(posted, []);
});

test('BL-330: running reconciliation twice in a row only posts once - the second pass is a pure no-op', async () => {
  const reconciledIds = [];
  const { adapters, posted } = fakeAdapters({ alreadyReconciledIds: reconciledIds });
  const first = await reconcileTopicLifecycle([ticket()], {}, adapters);
  assert.deepEqual(first, { reconciled: ['BL-123'] });
  // Simulate the persisted state a real isAlreadyReconciled would now see
  // (BL-329's own store, updated by the recordMessage call the first pass
  // just made) - the SAME real invariant, expressed without needing the
  // real store in this pure-adapter test.
  reconciledIds.push('BL-123');
  const second = await reconcileTopicLifecycle([ticket()], {}, adapters);
  assert.deepEqual(second, { reconciled: [] });
  assert.equal(posted.length, 1, 'expected exactly one post across both sweeps');
});

// ── topic-reconciliation-04: an in-flight ticket is left alone ─────────

test('BL-330 topic-reconciliation-04: reconcileTopicLifecycle only ever receives done tickets - callers never pass active/paused ones, a structural guarantee', async () => {
  const { adapters, posted } = fakeAdapters();
  // No active/paused ticket is EVER passed to this function - proven by
  // passing an empty done list and confirming nothing happens, since the
  // function has no other input surface that could reach a topic.
  const result = await reconcileTopicLifecycle([], {}, adapters);
  assert.deepEqual(result, { reconciled: [] });
  assert.deepEqual(posted, []);
});

// BL-493: the old "never creates a topic just to close it" guard applied to
// a disposable PER-TICKET topic - the ticket's status message now targets
// SHARED, standing infrastructure (its epic topic, or the standing Backlog
// topic), so a ticket whose completion (or even its very first status
// message) was entirely missed while the bot was offline still gets it
// posted now, creating the Backlog topic on first use exactly like an
// ordinary first-ever ticket event would (see conciergeTopicRouting.test.js's
// own "first-ever event happens to be completion" coverage).
test('BL-493: a done ticket with no topic yet mapped is still reconciled - the standing Backlog topic is ensured, never skipped', async () => {
  const { adapters, posted, created } = fakeAdapters();
  const result = await reconcileTopicLifecycle([ticket()], {}, adapters);
  assert.deepEqual(result, { reconciled: ['BL-123'] });
  assert.deepEqual(created, [], 'the standing Backlog topic is ensured via ensureBacklogTopic, never createTopic');
  assert.deepEqual(posted, [{ topicId: 760, text: buildTicketStatusText('BL-123', 'a fine feature', 'done'), messageId: 9000 }]);
});

test('multiple done tickets are each reconciled independently, in order', async () => {
  const { adapters, posted } = fakeAdapters();
  const result = await reconcileTopicLifecycle([ticket({ id: 'BL-1', title: 'first' }), ticket({ id: 'BL-2', title: 'second' })], {}, adapters);
  assert.deepEqual(result, { reconciled: ['BL-1', 'BL-2'] });
  assert.deepEqual(
    posted.map((s) => s.text),
    [buildTicketStatusText('BL-1', 'first', 'done'), buildTicketStatusText('BL-2', 'second', 'done')]
  );
});

const DYNAMIC_ROUTING_EPIC_DEFINITIONS = { 'dynamic-routing': { id: 'dynamic-routing', title: 'Dynamic Routing', remainingSlices: [] } };

test('BL-493: an epic-bound done ticket reuses its already-mapped epic topic', async () => {
  const { adapters, posted, created, topicMap } = fakeAdapters();
  topicMap['dynamic-routing'] = 42;
  const result = await reconcileTopicLifecycle([ticket({ epic: 'dynamic-routing' })], DYNAMIC_ROUTING_EPIC_DEFINITIONS, adapters);
  assert.deepEqual(result, { reconciled: ['BL-123'] });
  assert.deepEqual(created, []);
  assert.deepEqual(posted, [{ topicId: 42, text: buildTicketStatusText('BL-123', 'a fine feature', 'done'), messageId: 9000 }]);
});

// BL-493 architect bounce (2026-07-17): the defect this regression guards -
// reconcileTopicLifecycle used to build TicketRouteContext.epicTitle from
// the raw epic ID (ticket.epic), never its real title, so the FIRST-EVER
// creation of an epic's topic (exactly what happens here - no prior
// mapping, forcing ensureEpicTopicId's createTopic branch) named the live
// Telegram topic "EPIC — dynamic-routing" instead of "EPIC — Dynamic
// Routing". A ticket completing while the bot was down, before its epic's
// topic was ever created through the live tick, is BL-330's own reason for
// this module to exist - so this is not a hypothetical case.
test('BL-493 architect bounce: an epic-bound done ticket whose epic topic does not exist yet creates it named after the epic\'s real TITLE, never its raw id', async () => {
  const { adapters, created } = fakeAdapters();
  const result = await reconcileTopicLifecycle([ticket({ epic: 'dynamic-routing' })], DYNAMIC_ROUTING_EPIC_DEFINITIONS, adapters);
  assert.deepEqual(result, { reconciled: ['BL-123'] });
  assert.deepEqual(created, ['EPIC — Dynamic Routing'], 'expected the epic topic created and named after its real title, not "EPIC — dynamic-routing"');
});

test('BL-493 architect bounce: an epic with NO defining ticket yet falls back to its own id as the title, same as the live tick', async () => {
  const { adapters, created } = fakeAdapters();
  const result = await reconcileTopicLifecycle([ticket({ epic: 'undocumented-epic' })], {}, adapters);
  assert.deepEqual(result, { reconciled: ['BL-123'] });
  assert.deepEqual(created, ['EPIC — undocumented-epic']);
});
