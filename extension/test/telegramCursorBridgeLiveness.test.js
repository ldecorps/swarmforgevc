const assert = require('node:assert/strict');
const {
  formatCursorBridgeLivenessLine,
  formatQueuedWorkLivenessLine,
  syncCursorBridgeLivenessStatus,
  syncQueuedWorkLivenessCues,
  applyLivenessSyncResult,
} = require('../out/tools/telegramCursorBridgeLiveness');
const { parseCursorBridgeState } = require('../out/tools/telegramCursorBridgeCore');

test('liveness line: idle and busy copy', () => {
  assert.equal(formatCursorBridgeLivenessLine(false, 0), 'Bridge: idle');
  // Idle cue stays plain — the queue selection poll is the "N waiting" surface.
  assert.equal(formatCursorBridgeLivenessLine(false, 2), 'Bridge: idle');
  assert.equal(formatCursorBridgeLivenessLine(true, 0), 'Bridge: busy');
  assert.equal(formatCursorBridgeLivenessLine(true, 1), 'Bridge: busy · 1 waiting');
});

test('liveness line: parseCursorBridgeState keeps livenessStatus', () => {
  const parsed = parseCursorBridgeState({
    updateOffset: 1,
    cursorTopicId: 99,
    livenessStatus: { topicId: 99, messageId: 42, renderedText: 'Bridge: idle' },
  });
  assert.deepEqual(parsed.livenessStatus, {
    topicId: 99,
    messageId: 42,
    renderedText: 'Bridge: idle',
  });
});

test('liveness sync: posts once then edits on busy flip', async () => {
  const state = { updateOffset: 0, cursorTopicId: 7 };
  const posts = [];
  const edits = [];
  let persisted = 0;

  await syncCursorBridgeLivenessStatus({
    botToken: 't',
    chatId: 'c',
    state,
    busy: false,
    persistState: () => {
      persisted += 1;
    },
    postMessage: async (topicId, text) => {
      posts.push({ topicId, text });
      return 1001;
    },
    editMessage: async (topicId, messageId, text) => {
      edits.push({ topicId, messageId, text });
      return true;
    },
  });

  assert.deepEqual(posts, [{ topicId: 7, text: 'Bridge: idle' }]);
  assert.equal(edits.length, 0);
  assert.equal(state.livenessStatus.messageId, 1001);
  assert.equal(persisted, 1);

  await syncCursorBridgeLivenessStatus({
    botToken: 't',
    chatId: 'c',
    state,
    busy: true,
    persistState: () => {
      persisted += 1;
    },
    postMessage: async () => {
      throw new Error('should edit, not post');
    },
    editMessage: async (topicId, messageId, text) => {
      edits.push({ topicId, messageId, text });
      return true;
    },
  });

  assert.equal(posts.length, 1);
  assert.deepEqual(edits, [{ topicId: 7, messageId: 1001, text: 'Bridge: busy' }]);
  assert.equal(state.livenessStatus.renderedText, 'Bridge: busy');
  assert.equal(persisted, 2);

  // Unchanged → no Telegram call
  await syncCursorBridgeLivenessStatus({
    botToken: 't',
    chatId: 'c',
    state,
    busy: true,
    persistState: () => {
      persisted += 1;
    },
    postMessage: async () => {
      throw new Error('no post');
    },
    editMessage: async () => {
      throw new Error('no edit');
    },
  });
  assert.equal(persisted, 2);
});

test('liveness sync: failed edit reposts a fresh line', async () => {
  const state = {
    updateOffset: 0,
    cursorTopicId: 3,
    livenessStatus: { topicId: 3, messageId: 9, renderedText: 'Bridge: idle' },
  };
  const posts = [];

  await syncCursorBridgeLivenessStatus({
    botToken: 't',
    chatId: 'c',
    state,
    busy: true,
    persistState: () => {},
    postMessage: async (topicId, text) => {
      posts.push({ topicId, text });
      return 55;
    },
    editMessage: async () => false,
  });

  assert.deepEqual(posts, [{ topicId: 3, text: 'Bridge: busy' }]);
  assert.equal(state.livenessStatus.messageId, 55);
});

test('liveness sync: no-op (never calls Telegram) when the state has no cursorTopicId yet', async () => {
  const state = { updateOffset: 0 };
  await syncCursorBridgeLivenessStatus({
    botToken: 't',
    chatId: 'c',
    state,
    busy: false,
    persistState: () => {
      throw new Error('should not persist');
    },
    postMessage: async () => {
      throw new Error('should not post');
    },
    editMessage: async () => {
      throw new Error('should not edit');
    },
  });
  assert.equal(state.livenessStatus, undefined);
});

test('liveness sync: idle stays a plain cue even when pendingPrompts exist (poll is the queue surface)', async () => {
  const state = { updateOffset: 0, cursorTopicId: 7, pendingPrompts: ['a', 'b', 'c'] };
  const posts = [];
  await syncCursorBridgeLivenessStatus({
    botToken: 't',
    chatId: 'c',
    state,
    busy: false,
    persistState: () => {},
    postMessage: async (topicId, text) => {
      posts.push({ topicId, text });
      return 1;
    },
    editMessage: async () => true,
  });
  assert.deepEqual(posts, [{ topicId: 7, text: 'Bridge: idle' }]);
});

test('liveness sync: busy line still includes the queued-prompt count', async () => {
  const state = { updateOffset: 0, cursorTopicId: 7, pendingPrompts: ['a', 'b'] };
  const posts = [];
  await syncCursorBridgeLivenessStatus({
    botToken: 't',
    chatId: 'c',
    state,
    busy: true,
    persistState: () => {},
    postMessage: async (topicId, text) => {
      posts.push({ topicId, text });
      return 1;
    },
    editMessage: async () => true,
  });
  assert.deepEqual(posts, [{ topicId: 7, text: 'Bridge: busy · 2 waiting' }]);
});

test('liveness sync: default postMessage/editMessage go through the injected telegramPostFn transport seam, never a real network call', async () => {
  const state = { updateOffset: 0, cursorTopicId: 11 };
  const calls = [];
  const telegramPostFn = async (url, body) => {
    calls.push({ url, body: JSON.parse(body) });
    return { ok: true, status: 200, json: { ok: true, result: { message_id: 321 } } };
  };

  await syncCursorBridgeLivenessStatus({
    botToken: 'tok',
    chatId: 'chat',
    state,
    busy: false,
    persistState: () => {},
    telegramPostFn,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /sendMessage$/);
  assert.equal(calls[0].body.message_thread_id, 11);
  assert.equal(calls[0].body.text, 'Bridge: idle');
  assert.equal(state.livenessStatus.messageId, 321);

  await syncCursorBridgeLivenessStatus({
    botToken: 'tok',
    chatId: 'chat',
    state,
    busy: true,
    persistState: () => {},
    telegramPostFn,
  });

  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /editMessageText$/);
  assert.equal(calls[1].body.message_id, 321);
  assert.equal(calls[1].body.text, 'Bridge: busy');
});

// ── applyLivenessSyncResult (extracted so each persist decision is
// independently testable) ────────────────────────────────────────────────

function depsWithState(livenessStatus) {
  let persisted = 0;
  const state = { updateOffset: 0, cursorTopicId: 1, livenessStatus };
  return {
    deps: {
      botToken: 't',
      chatId: 'c',
      state,
      busy: false,
      persistState: () => {
        persisted += 1;
      },
    },
    state,
    persistedCount: () => persisted,
  };
}

test('applyLivenessSyncResult persists on a posted outcome', () => {
  const { deps, state, persistedCount } = depsWithState(undefined);
  applyLivenessSyncResult(deps, { outcome: 'posted', state: { topicId: 1, messageId: 5, renderedText: 'x' } });
  assert.deepEqual(state.livenessStatus, { topicId: 1, messageId: 5, renderedText: 'x' });
  assert.equal(persistedCount(), 1);
});

test('applyLivenessSyncResult persists on an edited outcome', () => {
  const { deps, state, persistedCount } = depsWithState({ topicId: 1, messageId: 5, renderedText: 'old' });
  applyLivenessSyncResult(deps, { outcome: 'edited', state: { topicId: 1, messageId: 5, renderedText: 'new' } });
  assert.equal(state.livenessStatus.renderedText, 'new');
  assert.equal(persistedCount(), 1);
});

test('applyLivenessSyncResult does not persist a skipped-unchanged outcome when an identity is already recorded', () => {
  const prior = { topicId: 1, messageId: 5, renderedText: 'x' };
  const { deps, state, persistedCount } = depsWithState(prior);
  applyLivenessSyncResult(deps, { outcome: 'skipped-unchanged', state: prior });
  assert.equal(state.livenessStatus, prior);
  assert.equal(persistedCount(), 0);
});

test('applyLivenessSyncResult backfills a skipped-unchanged outcome that carries an identity when none was recorded yet', () => {
  const { deps, state, persistedCount } = depsWithState(undefined);
  applyLivenessSyncResult(deps, {
    outcome: 'skipped-unchanged',
    state: { topicId: 1, messageId: 9, renderedText: 'x' },
  });
  assert.deepEqual(state.livenessStatus, { topicId: 1, messageId: 9, renderedText: 'x' });
  assert.equal(persistedCount(), 1);
});

test('applyLivenessSyncResult does not persist a skipped-unchanged outcome with no identity at all', () => {
  const { deps, state, persistedCount } = depsWithState(undefined);
  applyLivenessSyncResult(deps, { outcome: 'skipped-unchanged', state: {} });
  assert.equal(state.livenessStatus, undefined);
  assert.equal(persistedCount(), 0);
});

test('applyLivenessSyncResult never persists a failure outcome', () => {
  const { deps, state, persistedCount } = depsWithState(undefined);
  applyLivenessSyncResult(deps, { outcome: 'failed-no-topic', state: {} });
  applyLivenessSyncResult(deps, { outcome: 'failed-post', state: { topicId: 1 } });
  applyLivenessSyncResult(deps, { outcome: 'failed-edit', state: { topicId: 1, messageId: 5, renderedText: 'x' } });
  assert.equal(state.livenessStatus, undefined);
  assert.equal(persistedCount(), 0);
});

// ── BL-767: formatQueuedWorkLivenessLine / syncQueuedWorkLivenessCues ─────
// The busy cue follows a queued question into its own origin topic, not
// only Cursor Remote. See approval_context bullet 1 / feature scenario 03.

test('queued-work liveness line: always states its count, even 0', () => {
  assert.equal(formatQueuedWorkLivenessLine(0), 'Bridge: idle · 0 waiting');
  assert.equal(formatQueuedWorkLivenessLine(1), 'Bridge: busy · 1 waiting');
  assert.equal(formatQueuedWorkLivenessLine(3), 'Bridge: busy · 3 waiting');
});

test('syncQueuedWorkLivenessCues posts a cue in the Bubble topic reporting 1 waiting, then edits it to 0 waiting on drain', async () => {
  const state = {
    updateOffset: 0,
    cursorTopicId: 55,
    bubbleTopicId: 91,
    pendingPrompts: [{ id: 'qp-1', text: 'from bubble', createdAtMs: 1, originTopicId: 91 }],
  };
  const posts = [];
  const edits = [];
  let persisted = 0;

  await syncQueuedWorkLivenessCues({
    botToken: 't',
    chatId: 'c',
    state,
    persistState: () => {
      persisted += 1;
    },
    postMessage: async (topicId, text) => {
      posts.push({ topicId, text });
      return 2001;
    },
    editMessage: async (topicId, messageId, text) => {
      edits.push({ topicId, messageId, text });
      return true;
    },
  });

  assert.deepEqual(posts, [{ topicId: 91, text: 'Bridge: busy · 1 waiting' }]);
  assert.equal(persisted, 1);
  assert.equal(state.queuedWorkLivenessStatus['91'].messageId, 2001);

  // Drain: the queue is now empty, but the prior message identity survives
  // in state so this edits the same message in place, in the same topic.
  state.pendingPrompts = [];
  await syncQueuedWorkLivenessCues({
    botToken: 't',
    chatId: 'c',
    state,
    persistState: () => {
      persisted += 1;
    },
    postMessage: async () => {
      throw new Error('should edit, not post');
    },
    editMessage: async (topicId, messageId, text) => {
      edits.push({ topicId, messageId, text });
      return true;
    },
  });

  assert.deepEqual(edits, [{ topicId: 91, messageId: 2001, text: 'Bridge: idle · 0 waiting' }]);
  assert.equal(persisted, 2);
});

test('syncQueuedWorkLivenessCues is a no-op when nothing is queued off Cursor Remote and no prior cue exists', async () => {
  const state = { updateOffset: 0, cursorTopicId: 55, pendingPrompts: [{ id: 'qp-1', text: 'x', createdAtMs: 1, originTopicId: 55 }] };
  await syncQueuedWorkLivenessCues({
    botToken: 't',
    chatId: 'c',
    state,
    persistState: () => {
      throw new Error('should not persist');
    },
    postMessage: async () => {
      throw new Error('should not post');
    },
    editMessage: async () => {
      throw new Error('should not edit');
    },
  });
  assert.equal(state.queuedWorkLivenessStatus, undefined);
});

test('syncQueuedWorkLivenessCues counts per topic independently when two topics both hold queued work', async () => {
  const state = {
    updateOffset: 0,
    cursorTopicId: 55,
    bubbleTopicId: 91,
    pendingPrompts: [
      { id: 'qp-1', text: 'a', createdAtMs: 1, originTopicId: 91 },
      { id: 'qp-2', text: 'b', createdAtMs: 2, originTopicId: 91 },
      { id: 'qp-3', text: 'c', createdAtMs: 3, originTopicId: 77 },
    ],
  };
  const posts = [];
  await syncQueuedWorkLivenessCues({
    botToken: 't',
    chatId: 'c',
    state,
    persistState: () => {},
    postMessage: async (topicId, text) => {
      posts.push({ topicId, text });
      return posts.length;
    },
    editMessage: async () => true,
  });
  assert.ok(posts.some((p) => p.topicId === 91 && p.text === 'Bridge: busy · 2 waiting'));
  assert.ok(posts.some((p) => p.topicId === 77 && p.text === 'Bridge: busy · 1 waiting'));
});

test('parseCursorBridgeState keeps queuedWorkLivenessStatus and still parses a file that predates it', () => {
  const withStatus = parseCursorBridgeState({
    updateOffset: 1,
    cursorTopicId: 55,
    queuedWorkLivenessStatus: { '91': { topicId: 91, messageId: 7, renderedText: 'Bridge: busy · 1 waiting' } },
  });
  assert.deepEqual(withStatus.queuedWorkLivenessStatus, {
    '91': { topicId: 91, messageId: 7, renderedText: 'Bridge: busy · 1 waiting' },
  });

  // Pre-BL-767 state file: field absent entirely — must still parse cleanly.
  const legacy = parseCursorBridgeState({ updateOffset: 1, cursorTopicId: 55 });
  assert.equal(legacy.queuedWorkLivenessStatus, undefined);
});

test('parseCursorBridgeState drops a present-but-malformed queuedWorkLivenessStatus (array or scalar) rather than defaulting it silently to garbage', () => {
  // An array is typeof 'object' in JS — without an explicit guard it would
  // pass the object check and its indices ('0', '1', ...) would be read as
  // topic ids, silently fabricating bogus per-topic cues.
  assert.equal(
    parseCursorBridgeState({
      updateOffset: 1,
      queuedWorkLivenessStatus: [{ topicId: 91, messageId: 7, renderedText: 'Bridge: busy · 1 waiting' }],
    }).queuedWorkLivenessStatus,
    undefined
  );
  assert.equal(
    parseCursorBridgeState({ updateOffset: 1, queuedWorkLivenessStatus: 'not-an-object' }).queuedWorkLivenessStatus,
    undefined
  );
  assert.equal(
    parseCursorBridgeState({ updateOffset: 1, queuedWorkLivenessStatus: 42 }).queuedWorkLivenessStatus,
    undefined
  );
  assert.equal(
    parseCursorBridgeState({ updateOffset: 1, queuedWorkLivenessStatus: null }).queuedWorkLivenessStatus,
    undefined
  );
});

test('parseCursorBridgeState keeps only the well-formed entries of a partially-malformed queuedWorkLivenessStatus map', () => {
  const state = parseCursorBridgeState({
    updateOffset: 1,
    queuedWorkLivenessStatus: {
      '91': { topicId: 91, messageId: 2001, renderedText: 'Bridge: busy · 1 waiting' },
      '77': 'garbage',
      '55': { topicId: 'nope', messageId: 'nope', renderedText: '' },
    },
  });
  assert.deepEqual(state.queuedWorkLivenessStatus, {
    '91': { topicId: 91, messageId: 2001, renderedText: 'Bridge: busy · 1 waiting' },
  });
  assert.equal('77' in state.queuedWorkLivenessStatus, false);
  assert.equal('55' in state.queuedWorkLivenessStatus, false);
});

test('parseCursorBridgeState omits queuedWorkLivenessStatus entirely when every entry in the map is invalid', () => {
  const state = parseCursorBridgeState({
    updateOffset: 1,
    queuedWorkLivenessStatus: { '91': 'garbage', '77': { topicId: 'nope' } },
  });
  assert.equal('queuedWorkLivenessStatus' in state, false);
});
