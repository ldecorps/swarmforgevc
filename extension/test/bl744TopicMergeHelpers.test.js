const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  mergeTopicId,
  readCursorBridgeTopicIds,
  effectiveBubbleMirrorTopicId,
  bubbleMirrorTopicForPath,
} = require('../out/bridge/bubbleMirrorTopic');
const {
  readCursorBridgeStateRecord,
  appendPendingChoicePoll,
} = require('../out/bridge/bubbleMirrorState');
const { telegramMirrorEnv, sendBubbleMirrorChunks } = require('../out/bridge/bubbleMirrorDelivery');
const { mirrorLetsTalkTurnToBubble } = require('../out/bridge/bridgeServer');
const { parseCursorBridgeState } = require('../out/tools/telegramCursorBridgeCore');

function mkTmp() {
  const target = mkTmpDir('bl744-');
  fs.mkdirSync(path.join(target, '.swarmforge', 'operator'), { recursive: true });
  return target;
}

function writeState(target, body) {
  fs.writeFileSync(
    path.join(target, '.swarmforge', 'operator', 'cursor-bridge-state.json'),
    `${JSON.stringify(body, null, 2)}\n`
  );
}

function writeMap(target, body) {
  fs.writeFileSync(
    path.join(target, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json'),
    `${JSON.stringify(body, null, 2)}\n`
  );
}

test('BL-744 mergeTopicId prefers valid positive preferred id', () => {
  assert.equal(mergeTopicId(91, 9), 91);
});

test('BL-744 mergeTopicId falls back when preferred is invalid or absent', () => {
  assert.equal(mergeTopicId(0, 11810), 11810);
  assert.equal(mergeTopicId(-1, 11810), 11810);
  assert.equal(mergeTopicId(Number.NaN, 11810), 11810);
  assert.equal(mergeTopicId(Number.POSITIVE_INFINITY, 11810), 11810);
  assert.equal(mergeTopicId(undefined, 11810), 11810);
  assert.equal(mergeTopicId(undefined, undefined), undefined);
});

test('BL-744 readCursorBridgeTopicIds reads state-only ids', () => {
  const target = mkTmp();
  writeState(target, { updateOffset: 0, cursorTopicId: 9, bubbleTopicId: 91 });
  assert.deepEqual(readCursorBridgeTopicIds(target), { cursorTopicId: 9, bubbleTopicId: 91 });
});

test('BL-744 readCursorBridgeTopicIds merges map fallbacks and ignores bad files', () => {
  const target = mkTmp();
  writeState(target, '{ not-json');
  writeMap(target, { '11810': 'BUBBLE', '8435': 'CURSOR_REMOTE' });
  assert.deepEqual(readCursorBridgeTopicIds(target), { cursorTopicId: 8435, bubbleTopicId: 11810 });

  const target2 = mkTmp();
  writeState(target2, { updateOffset: 0, bubbleTopicId: 0 });
  writeMap(target2, { '11810': 'BUBBLE', '8435': 'CURSOR_REMOTE' });
  assert.deepEqual(readCursorBridgeTopicIds(target2), { bubbleTopicId: 11810, cursorTopicId: 8435 });

  const target3 = mkTmp();
  writeState(target3, { updateOffset: 0, cursorTopicId: 9, bubbleTopicId: 91 });
  writeMap(target3, '[]');
  assert.deepEqual(readCursorBridgeTopicIds(target3), { cursorTopicId: 9, bubbleTopicId: 91 });

  const target4 = mkTmp();
  writeMap(target4, { '11810': 'BUBBLE' });
  assert.equal(readCursorBridgeTopicIds(target4).bubbleTopicId, 11810);
});

test('BL-744 bubbleMirrorTopicForPath suppresses mirror when Bubble equals host topic', () => {
  const target = mkTmp();
  writeState(target, { updateOffset: 0, cursorTopicId: 9, bubbleTopicId: 9 });
  assert.equal(bubbleMirrorTopicForPath(target), undefined);
  assert.equal(effectiveBubbleMirrorTopicId({ cursorTopicId: 9, bubbleTopicId: 9 }), undefined);
});

test('BL-744 readCursorBridgeStateRecord and appendPendingChoicePoll tolerate corrupt snapshots', () => {
  const target = mkTmp();
  assert.deepEqual(readCursorBridgeStateRecord(target), {});

  writeState(target, '[]');
  assert.deepEqual(readCursorBridgeStateRecord(target), {});

  appendPendingChoicePoll(target, 'poll-2', { question: 'Q?', options: ['A', 'B'] }, 91);
  const state = JSON.parse(
    fs.readFileSync(path.join(target, '.swarmforge', 'operator', 'cursor-bridge-state.json'), 'utf8')
  );
  assert.equal(state.pendingChoicePolls[0].pollId, 'poll-2');
  assert.equal(state.pendingChoicePolls[0].originTopicId, 91);
});

test('BL-744 telegramMirrorEnv requires both token and chat id', () => {
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  const prevChat = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  assert.equal(telegramMirrorEnv(), undefined);
  process.env.TELEGRAM_BOT_TOKEN = 'tok';
  assert.equal(telegramMirrorEnv(), undefined);
  process.env.TELEGRAM_CHAT_ID = '123';
  assert.deepEqual(telegramMirrorEnv(), { botToken: 'tok', chatId: '123' });
  if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prevToken;
  if (prevChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
  else process.env.TELEGRAM_CHAT_ID = prevChat;
});

test('BL-744 mirror skips when credentials or topic are unavailable', async () => {
  const target = mkTmp();
  writeState(target, { updateOffset: 0, cursorTopicId: 9, bubbleTopicId: 9 });
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  const prevChat = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  let sent = 0;
  await mirrorLetsTalkTurnToBubble(target, 'hi', 'hello', {
    sendMessage: async () => {
      sent += 1;
      return { success: true, messageId: 1 };
    },
  });
  assert.equal(sent, 0);

  process.env.TELEGRAM_BOT_TOKEN = 'tok';
  process.env.TELEGRAM_CHAT_ID = '123';
  await mirrorLetsTalkTurnToBubble(target, '   ', '   ', {
    sendMessage: async () => {
      sent += 1;
      return { success: true, messageId: 1 };
    },
  });
  assert.equal(sent, 0);

  if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prevToken;
  if (prevChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
  else process.env.TELEGRAM_CHAT_ID = prevChat;
});

test('BL-744 extractLetsTalkChoicePoll rejects malformed numbered lists', async () => {
  const target = mkTmp();
  writeState(target, { updateOffset: 0, cursorTopicId: 9, bubbleTopicId: 91 });
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  const prevChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = 'tok';
  process.env.TELEGRAM_CHAT_ID = '123';
  try {
    await mirrorLetsTalkTurnToBubble(target, 'choose', 'not a numbered poll', {
      sendMessage: async () => ({ success: true, messageId: 1 }),
      sendPoll: async () => {
        throw new Error('poll send must not run for malformed choice text');
      },
    });
    await mirrorLetsTalkTurnToBubble(target, 'choose', '1) only one option', {
      sendMessage: async () => ({ success: true, messageId: 2 }),
      sendPoll: async () => {
        throw new Error('poll send must not run for single-option text');
      },
    });
  } finally {
    if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevToken;
    if (prevChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = prevChat;
  }
});

test('BL-744 mirror choice poll path records failed poll send without text mirror failure', async () => {
  const target = mkTmp();
  writeState(target, { updateOffset: 0, cursorTopicId: 9, bubbleTopicId: 91 });
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  const prevChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = 'tok';
  process.env.TELEGRAM_CHAT_ID = '123';
  try {
    await mirrorLetsTalkTurnToBubble(target, 'choose', 'Pick one:\n1) Alpha\n2) Beta', {
      sendMessage: async () => ({ success: true, messageId: 1 }),
      sendPoll: async () => ({ success: false, error: 'poll rejected' }),
    });
    await mirrorLetsTalkTurnToBubble(target, 'choose', 'Pick one:\n1) Alpha\n2) Beta', {
      sendMessage: async () => ({ success: true, messageId: 2 }),
      sendPoll: async () => ({ success: true }),
    });
    const state = JSON.parse(
      fs.readFileSync(path.join(target, '.swarmforge', 'operator', 'cursor-bridge-state.json'), 'utf8')
    );
    assert.equal(state.pendingChoicePolls, undefined);
  } finally {
    if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevToken;
    if (prevChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = prevChat;
  }
});

test('BL-744 sendBubbleMirrorChunks surfaces operator event on chunk failure', async () => {
  const target = mkTmp();
  const ok = await sendBubbleMirrorChunks(target, 'tok', '123', 91, 'hello', {
    sendMessage: async () => ({ success: false, error: 'rate limited' }),
  });
  assert.equal(ok, false);
  const eventsPath = path.join(target, '.swarmforge', 'operator', 'events.jsonl');
  assert.ok(fs.existsSync(eventsPath));
  const event = JSON.parse(fs.readFileSync(eventsPath, 'utf8').trim().split('\n').pop());
  assert.equal(event.type, 'bubble-talk-mirror-failed');
});

test('BL-744 buildPersistedState helpers cover choice polls and enqueue metadata', () => {
  const parsed = parseCursorBridgeState({
    updateOffset: 2,
    cursorTopicId: 9,
    bubbleTopicId: 91,
    supersededPromptPollIds: ['old-poll'],
    pendingChoicePolls: [
      { pollId: 'p1', question: 'Q?', options: ['A', 'B'], createdAtMs: 1, originTopicId: 91 },
      { pollId: '', question: 'bad', options: ['A'], createdAtMs: -1 },
    ],
    queuedWorkLivenessStatus: { queue: { topicId: 91, messageId: 1 } },
    enqueueNextPromptId: 'next-1',
  });
  assert.equal(parsed.bubbleTopicId, 91);
  assert.deepEqual(parsed.supersededPromptPollIds, ['old-poll']);
  assert.equal(parsed.pendingChoicePolls.length, 1);
  assert.equal(parsed.enqueueNextPromptId, 'next-1');
  assert.equal(parsed.queuedWorkLivenessStatus.queue.topicId, 91);
});
