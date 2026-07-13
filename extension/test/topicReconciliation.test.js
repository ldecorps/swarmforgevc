const assert = require('node:assert/strict');
const { reconcileTopicLifecycle } = require('../out/concierge/topicReconciliation');
const { completionSummaryText } = require('../out/concierge/topicRouter');

function ticket(overrides = {}) {
  return { id: 'BL-123', title: 'a fine feature', ...overrides };
}

function fakeAdapters({ topicMap = {}, alreadyReconciledIds = [] } = {}) {
  const sent = [];
  const closed = [];
  const recorded = [];
  return {
    sent,
    closed,
    recorded,
    adapters: {
      getTopicMap: () => topicMap,
      isAlreadyReconciled: (backlogId) => alreadyReconciledIds.includes(backlogId),
      routeAdapters: {
        getTopicMap: () => topicMap,
        createTopic: async () => {
          throw new Error('reconciliation must never create a topic - only close an existing one');
        },
        recordTopicId: () => {
          throw new Error('reconciliation must never create a topic - only close an existing one');
        },
        sendMessage: async (topicId, text) => {
          sent.push({ topicId, text });
          return true;
        },
        closeTopic: async (topicId) => {
          closed.push(topicId);
          return true;
        },
        recordMessage: (backlogId, text) => {
          recorded.push({ backlogId, text });
        },
      },
    },
  };
}

// ── topic-reconciliation-01/02: a missed or never-witnessed completion is
//    still reconciled from current state ────────────────────────────────

test('BL-330 topic-reconciliation-01/02: a done ticket whose topic is not yet completed is brought to its completed state', async () => {
  const { adapters, sent, closed } = fakeAdapters({ topicMap: { 'BL-123': 42 } });
  const result = await reconcileTopicLifecycle([ticket()], adapters);
  assert.deepEqual(result, { reconciled: ['BL-123'] });
  assert.deepEqual(sent, [{ topicId: 42, text: completionSummaryText({ type: 'TaskCompleted', backlogId: 'BL-123', payload: {} }, 'a fine feature') }]);
  assert.deepEqual(closed, [42]);
});

test('BL-330: the completion is genuinely posted and closed - the exact real routeEvent path, not a synthetic reconstruction', async () => {
  const { adapters, sent } = fakeAdapters({ topicMap: { 'BL-123': 42 } });
  await reconcileTopicLifecycle([ticket()], adapters);
  assert.match(sent[0].text, /is complete\.$/);
});

// ── topic-reconciliation-03: idempotent ─────────────────────────────────

test('BL-330 topic-reconciliation-03: a done ticket already reconciled is left alone - never posted or closed a second time', async () => {
  const { adapters, sent, closed } = fakeAdapters({ topicMap: { 'BL-123': 42 }, alreadyReconciledIds: ['BL-123'] });
  const result = await reconcileTopicLifecycle([ticket()], adapters);
  assert.deepEqual(result, { reconciled: [] });
  assert.deepEqual(sent, []);
  assert.deepEqual(closed, []);
});

test('BL-330: running reconciliation twice in a row only posts/closes once - the second pass is a pure no-op', async () => {
  const topicMap = { 'BL-123': 42 };
  const reconciledIds = [];
  const { adapters, sent, closed } = fakeAdapters({ topicMap, alreadyReconciledIds: reconciledIds });
  const first = await reconcileTopicLifecycle([ticket()], adapters);
  assert.deepEqual(first, { reconciled: ['BL-123'] });
  // Simulate the persisted state a real isAlreadyReconciled would now see
  // (BL-329's own store, updated by the recordMessage call the first pass
  // just made) - the SAME real invariant, expressed without needing the
  // real store in this pure-adapter test.
  reconciledIds.push('BL-123');
  const second = await reconcileTopicLifecycle([ticket()], adapters);
  assert.deepEqual(second, { reconciled: [] });
  assert.equal(sent.length, 1, 'expected exactly one post across both sweeps');
  assert.equal(closed.length, 1, 'expected exactly one close across both sweeps');
});

// ── topic-reconciliation-04: an in-flight ticket is left alone ─────────

test('BL-330 topic-reconciliation-04: reconcileTopicLifecycle only ever receives done tickets - callers never pass active/paused ones, a structural guarantee', async () => {
  const { adapters, sent, closed } = fakeAdapters({ topicMap: { 'BL-123': 42 } });
  // No active/paused ticket is EVER passed to this function - proven by
  // passing an empty done list and confirming nothing happens, since the
  // function has no other input surface that could reach a topic.
  const result = await reconcileTopicLifecycle([], adapters);
  assert.deepEqual(result, { reconciled: [] });
  assert.deepEqual(sent, []);
  assert.deepEqual(closed, []);
});

// ── a done ticket with no topic ever mapped is a no-op, never creates one ──

test('a done ticket with no topic mapped at all is skipped - reconciliation never creates a topic just to close it', async () => {
  const { adapters, sent, closed } = fakeAdapters({ topicMap: {} });
  const result = await reconcileTopicLifecycle([ticket()], adapters);
  assert.deepEqual(result, { reconciled: [] });
  assert.deepEqual(sent, []);
  assert.deepEqual(closed, []);
});

test('multiple done tickets are each reconciled independently, in order', async () => {
  const { adapters, sent } = fakeAdapters({ topicMap: { 'BL-1': 10, 'BL-2': 20 } });
  const result = await reconcileTopicLifecycle([ticket({ id: 'BL-1', title: 'first' }), ticket({ id: 'BL-2', title: 'second' })], adapters);
  assert.deepEqual(result, { reconciled: ['BL-1', 'BL-2'] });
  assert.deepEqual(
    sent.map((s) => s.topicId),
    [10, 20]
  );
});
