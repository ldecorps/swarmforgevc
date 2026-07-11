const assert = require('node:assert/strict');
const { decideTopicAction, routeEvent, topicNameForItem, messageTextForEvent, backlogForTopic, completionSummaryText } = require('../out/concierge/topicRouter');

function event(overrides = {}) {
  return { type: 'TaskStarted', backlogId: 'BL-123', payload: {}, ...overrides };
}

// ── decideTopicAction (pure) ──────────────────────────────────────────────

test('decideTopicAction creates a topic named "BL-### - <title>" when the item has no mapping yet', () => {
  const action = decideTopicAction(event(), {}, 'a fine feature');
  assert.deepEqual(action, { kind: 'create', topicName: 'BL-123 - a fine feature', text: 'TaskStarted: BL-123' });
});

test('decideTopicAction reuses the mapped topic id when one already exists', () => {
  const action = decideTopicAction(event(), { 'BL-123': 42 }, 'a fine feature');
  assert.deepEqual(action, { kind: 'reuse', topicId: 42, text: 'TaskStarted: BL-123' });
});

test('decideTopicAction only ever looks at ITS OWN backlogId entry, never another item\'s', () => {
  const action = decideTopicAction(event({ backlogId: 'BL-999' }), { 'BL-123': 42 }, 'unrelated title');
  assert.equal(action.kind, 'create');
});

test('topicNameForItem / messageTextForEvent are pure helpers', () => {
  assert.equal(topicNameForItem('BL-1', 'fix the thing'), 'BL-1 - fix the thing');
  assert.equal(messageTextForEvent(event({ type: 'NeedsApproval' })), 'NeedsApproval: BL-123');
});

// ── backlogForTopic (pure) — BL-298: the inverse of the forward map ───────

test('BL-298: backlogForTopic resolves a mapped topic id back to ITS OWN backlog item', () => {
  assert.equal(backlogForTopic({ 'BL-123': 42, 'BL-456': 43 }, 42), 'BL-123');
  assert.equal(backlogForTopic({ 'BL-123': 42, 'BL-456': 43 }, 43), 'BL-456');
});

test('BL-298: backlogForTopic returns undefined for an unmapped topic id (never a crash)', () => {
  assert.equal(backlogForTopic({ 'BL-123': 42 }, 999), undefined);
});

test('BL-298: backlogForTopic returns undefined for topicId undefined (a DM has no topic at all)', () => {
  assert.equal(backlogForTopic({ 'BL-123': 42 }, undefined), undefined);
});

// ── routeEvent (adapter-injected) — BL-297 topic-routing-01/02/03 ────────

function fakeAdapters(initialMap = {}) {
  const map = { ...initialMap };
  const created = [];
  const sent = [];
  const closed = [];
  return {
    map,
    created,
    sent,
    closed,
    adapters: {
      getTopicMap: () => map,
      createTopic: async (name) => {
        created.push(name);
        return { success: true, topicId: 500 + created.length };
      },
      recordTopicId: (backlogId, topicId) => {
        map[backlogId] = topicId;
      },
      sendMessage: async (topicId, text) => {
        sent.push({ topicId, text });
        return true;
      },
      closeTopic: async (topicId) => {
        closed.push(topicId);
        return true;
      },
    },
  };
}

test('topic-routing-01: the first event for an unmapped item creates a topic once and records the mapping', async () => {
  const { adapters, created, sent, map } = fakeAdapters();
  const result = await routeEvent(event(), 'a fine feature', adapters);
  assert.deepEqual(created, ['BL-123 - a fine feature']);
  assert.equal(map['BL-123'], 501);
  assert.deepEqual(sent, [{ topicId: 501, text: 'TaskStarted: BL-123' }]);
  assert.deepEqual(result, { posted: true, skipped: false });
});

test('topic-routing-01: a later (non-completion) event for the SAME item reuses the topic - no second create', async () => {
  const { adapters, created, sent } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters);
  await routeEvent(event({ type: 'NeedsApproval' }), 'a fine feature', adapters);
  assert.equal(created.length, 1, 'expected exactly one createTopic call across both events');
  assert.deepEqual(sent, [
    { topicId: 501, text: 'TaskStarted: BL-123' },
    { topicId: 501, text: 'NeedsApproval: BL-123' },
  ]);
});

test('topic-routing-02: every sendMessage call carries a concrete topicId - the adapter signature has no main-chat path at all', async () => {
  const { adapters, sent } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters);
  assert.equal(sent.length, 1);
  assert.equal(typeof sent[0].topicId, 'number');
});

test('topic-routing-03: the posted message states the event\'s type', async () => {
  const { adapters, sent } = fakeAdapters();
  await routeEvent(event({ type: 'NeedsApproval' }), 'a fine feature', adapters);
  assert.match(sent[0].text, /NeedsApproval/);
});

test('a topic-create failure skips the event - never a fallback post', async () => {
  const map = {};
  const sent = [];
  const adapters = {
    getTopicMap: () => map,
    createTopic: async () => ({ success: false }),
    recordTopicId: () => {
      throw new Error('recordTopicId should never be called when create fails');
    },
    sendMessage: async (topicId, text) => {
      sent.push({ topicId, text });
      return true;
    },
  };
  const result = await routeEvent(event(), 'a fine feature', adapters);
  assert.deepEqual(result, { posted: false, skipped: true });
  assert.deepEqual(sent, []);
  assert.deepEqual(map, {});
});

test('a topic-create success with no topicId also skips (never posts with an undefined thread)', async () => {
  const sent = [];
  const adapters = {
    getTopicMap: () => ({}),
    createTopic: async () => ({ success: true }),
    recordTopicId: () => {
      throw new Error('recordTopicId should never be called with no topicId');
    },
    sendMessage: async (topicId, text) => {
      sent.push({ topicId, text });
      return true;
    },
  };
  const result = await routeEvent(event(), 'a fine feature', adapters);
  assert.deepEqual(result, { posted: false, skipped: true });
  assert.deepEqual(sent, []);
});

test('a failed sendMessage reports posted:false but is not itself a skip (the topic exists, delivery just failed)', async () => {
  const { adapters, map } = fakeAdapters({ 'BL-123': 42 });
  adapters.sendMessage = async () => false;
  const result = await routeEvent(event(), 'a fine feature', adapters);
  assert.deepEqual(result, { posted: false, skipped: false });
  assert.equal(map['BL-123'], 42);
});

// ── completionSummaryText (pure) — BL-299 ──────────────────────────────────

test('completionSummaryText names the item and states it is complete', () => {
  assert.equal(completionSummaryText(event({ type: 'TaskCompleted' }), 'a fine feature'), 'BL-123 - a fine feature is complete.');
});

// ── routeEvent completion path (adapter-injected) — BL-299 topic-complete-01 ──

test('topic-complete-01 [completion, has a topic]: posts a completion summary naming the item, then closes the topic', async () => {
  const { adapters, sent, closed } = fakeAdapters({ 'BL-123': 42 });
  const result = await routeEvent(event({ type: 'TaskCompleted' }), 'a fine feature', adapters);
  assert.deepEqual(sent, [{ topicId: 42, text: 'BL-123 - a fine feature is complete.' }]);
  assert.deepEqual(closed, [42]);
  assert.deepEqual(result, { posted: true, skipped: false });
});

test('topic-complete-01: the summary is posted BEFORE the topic closes (order matters - a closed topic cannot be posted into)', async () => {
  const order = [];
  const { adapters } = fakeAdapters({ 'BL-123': 42 });
  adapters.sendMessage = async (topicId, text) => {
    order.push('sendMessage');
    return true;
  };
  adapters.closeTopic = async (topicId) => {
    order.push('closeTopic');
    return true;
  };
  await routeEvent(event({ type: 'TaskCompleted' }), 'a fine feature', adapters);
  assert.deepEqual(order, ['sendMessage', 'closeTopic']);
});

test('topic-complete-01 [progress, has a topic]: a non-completion event posts its line and leaves the topic open (no close call)', async () => {
  const { adapters, sent, closed } = fakeAdapters({ 'BL-123': 42 });
  const result = await routeEvent(event({ type: 'TaskStarted' }), 'a fine feature', adapters);
  assert.deepEqual(sent, [{ topicId: 42, text: 'TaskStarted: BL-123' }]);
  assert.deepEqual(closed, []);
  assert.deepEqual(result, { posted: true, skipped: false });
});

test('topic-complete-01 [completion, has no topic]: posts nothing and closes no topic (a no-op, never creates a topic just to close it)', async () => {
  const { adapters, sent, closed, created } = fakeAdapters();
  const result = await routeEvent(event({ type: 'TaskCompleted' }), 'a fine feature', adapters);
  assert.deepEqual(sent, []);
  assert.deepEqual(closed, []);
  assert.deepEqual(created, []);
  assert.deepEqual(result, { posted: false, skipped: true });
});

test('a completed item whose summary post fails is never closed', async () => {
  const { adapters, closed } = fakeAdapters({ 'BL-123': 42 });
  adapters.sendMessage = async () => false;
  const result = await routeEvent(event({ type: 'TaskCompleted' }), 'a fine feature', adapters);
  assert.deepEqual(closed, []);
  assert.deepEqual(result, { posted: false, skipped: false });
});
