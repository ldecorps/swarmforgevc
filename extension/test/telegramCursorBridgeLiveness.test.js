const assert = require('node:assert/strict');
const {
  formatCursorBridgeLivenessLine,
  syncCursorBridgeLivenessStatus,
  applyLivenessSyncResult,
} = require('../out/tools/telegramCursorBridgeLiveness');
const { parseCursorBridgeState } = require('../out/tools/telegramCursorBridgeCore');

test('liveness line: idle and busy copy', () => {
  assert.equal(formatCursorBridgeLivenessLine(false, 0), 'Bridge: idle');
  assert.equal(formatCursorBridgeLivenessLine(false, 2), 'Bridge: idle · 2 waiting');
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

test('liveness sync: includes the queued-prompt count from state.pendingPrompts in the posted text', async () => {
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
  assert.deepEqual(posts, [{ topicId: 7, text: 'Bridge: idle · 3 waiting' }]);
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
