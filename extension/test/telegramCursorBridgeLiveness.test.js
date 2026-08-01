const assert = require('node:assert/strict');
const {
  formatCursorBridgeLivenessLine,
  syncCursorBridgeLivenessStatus,
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
