const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CursorAgentError } = require('@cursor/sdk');
const { mkTmpDir } = require('./helpers/tmpDir');
const { createMockCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');
const {
  bootstrapCursorBridgeState,
  ensureCursorTopic,
  ensureBubbleTopic,
  handleInboundDecision,
  inboundEventOf,
  loadJsonFile,
  loadTopicMap,
  parseJsonOrUndefined,
  postChunks,
  promptWithHeartbeat,
  requiredEnv,
  runCursorBridgePollOnce,
  runCursorBridgeApp,
  runCursorBridgeLoop,
  runCursorBridgeBootIfConfigured,
  runPromptWithActiveRunRecovery,
  sleep,
  writeJsonFile,
  writePollHeartbeat,
  BRIDGE_READY_MESSAGE,
  QUEUED_PROMPT_TTL_MS,
} = require('../out/tools/telegramCursorBridgeLive');

function mkRoot() {
  const root = mkTmpDir('sfvc-tg-bridge-live-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

// Liveness sync's default postMessage/editMessage call sendTelegramMessage /
// editMessageText with no postFn override, which falls through to a real
// network call. Every test gets this no-op stub by default so the liveness
// cue never reaches api.telegram.org.
const NOOP_TELEGRAM_POST_FN = async () => ({ ok: true, status: 200, json: {} });

function mkCtx(overrides = {}) {
  const root = overrides.root ?? mkRoot();
  const posts = overrides.posts ?? [];
  const state = { updateOffset: 0 };
  if (Object.hasOwn(overrides, 'cursorTopicId')) {
    if (overrides.cursorTopicId !== undefined) {
      state.cursorTopicId = overrides.cursorTopicId;
    }
  } else {
    state.cursorTopicId = 1;
  }
  return {
    repoRoot: root,
    botToken: 't',
    chatId: '-100',
    state,
    busy: overrides.busy ?? false,
    agentSession: overrides.session ?? createMockCursorBridgeAgentSession(root),
    opDir: path.join(root, '.swarmforge', 'operator'),
    post: overrides.post ?? (async (_t, _c, _topic, text) => {
      posts.push(text);
    }),
    persistState: overrides.persistState ?? (() => {}),
    syncAgentIdFromSession: overrides.syncAgentIdFromSession ?? (() => {}),
    telegramPostFn: overrides.telegramPostFn ?? NOOP_TELEGRAM_POST_FN,
    root,
    posts,
  };
}

function mkPollDeps(root, overrides = {}) {
  const opDir = path.join(root, '.swarmforge', 'operator');
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  const topicMapPath = path.join(opDir, 'cursor-bridge-topic-map.json');
  writeJsonFile(statePath, { updateOffset: 0, cursorTopicId: overrides.cursorTopicId ?? 55 });
  return {
    repoRoot: root,
    botToken: 'token',
    chatId: '-100',
    principalUserId: '42',
    opDir,
    statePath,
    topicMapPath,
    agentSession: overrides.session ?? createMockCursorBridgeAgentSession(root),
    telegramPostFn: NOOP_TELEGRAM_POST_FN,
    ...overrides.deps,
  };
}

function mkMemoryOnlyAgentSession(initialAgentId = 'mock-agent-1') {
  let agentId = initialAgentId;
  return {
    readAgentId: () => agentId,
    resetSession: async () => {
      agentId = `mock-agent-${Date.now()}`;
      return { agentId };
    },
    promptAgent: async (prompt) => ({
      replyText: `echo: ${prompt}`,
      agentId,
    }),
  };
}

test('requiredEnv throws when unset', () => {
  const prev = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    assert.throws(() => requiredEnv('TELEGRAM_BOT_TOKEN'), /not set/);
  } finally {
    if (prev !== undefined) process.env.TELEGRAM_BOT_TOKEN = prev;
  }
});

test('loadJsonFile and writeJsonFile round-trip', () => {
  const root = mkRoot();
  const filePath = path.join(root, 'state.json');
  writeJsonFile(filePath, { updateOffset: 42 });
  assert.deepEqual(loadJsonFile(filePath), { updateOffset: 42 });
  assert.equal(loadJsonFile(path.join(root, 'missing.json')), undefined);
});

test('loadTopicMap returns empty object for invalid files', () => {
  const root = mkRoot();
  const filePath = path.join(root, 'map.json');
  writeJsonFile(filePath, 'not-an-object');
  assert.deepEqual(loadTopicMap(filePath), {});
});

test('inboundEventOf ignores updates without text or sender', () => {
  assert.equal(inboundEventOf({ update_id: 1 }), undefined);
  assert.equal(inboundEventOf({ update_id: 2, message: { chat: { id: 1 } } }), undefined);
  const event = inboundEventOf({
    update_id: 3,
    message: {
      text: 'hi',
      from: { id: 9 },
      chat: { id: -100 },
      message_thread_id: 5,
      message_id: 42,
    },
  });
  assert.deepEqual(event, {
    kind: 'text',
    fromId: 9,
    chatId: -100,
    topicId: 5,
    text: 'hi',
    messageId: 42,
  });
});

test('inboundEventOf accepts photo messages with optional caption', () => {
  const event = inboundEventOf({
    update_id: 4,
    message: {
      caption: 'what is this?',
      photo: [
        { file_id: 'small', width: 90, height: 90 },
        { file_id: 'large', width: 1280, height: 720 },
      ],
      from: { id: 9 },
      chat: { id: -100 },
      message_thread_id: 5,
      message_id: 43,
    },
  });
  assert.deepEqual(event, {
    kind: 'text',
    fromId: 9,
    chatId: -100,
    topicId: 5,
    text: 'what is this?',
    messageId: 43,
    photoFileId: 'large',
  });
});

test('BL-702: inboundEventOf accepts Confirm callback taps', () => {
  const event = inboundEventOf({
    update_id: 5,
    callback_query: {
      id: 'cb-1',
      data: 'op:confirm',
      from: { id: 9 },
      message: { chat: { id: -100 }, message_thread_id: 5, message_id: 99 },
    },
  });
  assert.deepEqual(event, {
    kind: 'callback',
    fromId: 9,
    chatId: -100,
    topicId: 5,
    text: '',
    callbackData: 'op:confirm',
    callbackQueryId: 'cb-1',
    messageId: 99,
  });
});

test('BL-702: pending operator confirm round-trips on disk', () => {
  const {
    writePendingOperatorConfirm,
    readPendingOperatorConfirm,
  } = require('../out/tools/telegramCursorBridgeLive');
  const root = mkTmpDir('bl702-pending-');
  assert.equal(readPendingOperatorConfirm(root), undefined);
  writePendingOperatorConfirm(root, { tier: 'hard', verb: '/bounce', args: 'extension' });
  assert.deepEqual(readPendingOperatorConfirm(root), {
    tier: 'hard',
    verb: '/bounce',
    args: 'extension',
  });
  writePendingOperatorConfirm(root, undefined);
  assert.equal(readPendingOperatorConfirm(root), undefined);
});

test('inboundEventOf ignores a message carrying neither text nor a photo', () => {
  assert.equal(
    inboundEventOf({
      update_id: 6,
      message: { from: { id: 9 }, chat: { id: -100 }, message_id: 44 },
    }),
    undefined
  );
});

test('postChunks splits and sends each chunk', async () => {
  const sent = [];
  await postChunks('token', '-100', 7, 'a\nb', undefined, async (_t, _c, chunk) => {
    sent.push(chunk);
    return { success: true };
  });
  assert.ok(sent.length >= 1);
});

test('postChunks sends a markdown grid as a rendered monospace block in HTML mode', async () => {
  const sent = [];
  await postChunks(
    'token',
    '-100',
    7,
    ['| Stage | Result |', '|--|--|', '| QA | **PASS** |'].join('\n'),
    undefined,
    async (_t, _c, chunk, _r, _p, _topic, _b, parseMode) => {
      sent.push({ chunk, parseMode });
      return { success: true };
    }
  );
  assert.deepEqual(sent, [
    {
      chunk: ['<pre>Stage | Result', '------+-------', 'QA    | PASS</pre>'].join('\n'),
      parseMode: 'HTML',
    },
  ]);
});

test('postChunks re-sends as plain text when Telegram refuses to parse the HTML', async () => {
  const sent = [];
  await postChunks('token', '-100', 7, 'ran **compile**', undefined, async (_t, _c, chunk, _r, _p, _topic, _b, parseMode) => {
    sent.push({ chunk, parseMode });
    return parseMode === 'HTML'
      ? { success: false, error: "Bad Request: can't parse entities" }
      : { success: true };
  });
  assert.deepEqual(sent, [
    { chunk: 'ran <b>compile</b>', parseMode: 'HTML' },
    { chunk: 'ran compile', parseMode: undefined },
  ]);
});

test('postChunks does not retry a transient failure as plain text', async () => {
  const sent = [];
  await assert.rejects(
    () =>
      postChunks('token', '-100', 7, 'hi', undefined, async (_t, _c, chunk, _r, _p, _topic, _b, parseMode) => {
        sent.push(parseMode);
        return parseMode === 'HTML' ? { success: false, error: 'Telegram API 429: retry after 3' } : { success: true };
      }),
    /429/
  );
  assert.deepEqual(sent, ['HTML']);
});

test('postChunks surfaces send failures', async () => {
  await assert.rejects(
    () =>
      postChunks('token', '-100', 7, 'fail', undefined, async () => ({
        success: false,
        error: 'network',
      })),
    /network/
  );
});

test('ensureCursorTopic reuses mapped topic id', async () => {
  const root = mkRoot();
  const mapPath = path.join(root, 'topic-map.json');
  writeJsonFile(mapPath, { '99': 'CURSOR_REMOTE' });
  const next = await ensureCursorTopic('token', '-100', mapPath, { updateOffset: 0 });
  assert.equal(next.cursorTopicId, 99);
});

test('ensureCursorTopic creates topic when map is empty', async () => {
  const root = mkRoot();
  const mapPath = path.join(root, 'topic-map.json');
  const next = await ensureCursorTopic(
    'token',
    '-100',
    mapPath,
    { updateOffset: 0 },
    async () => ({ success: true, messageThreadId: 123 })
  );
  assert.equal(next.cursorTopicId, 123);
  assert.deepEqual(loadTopicMap(mapPath), { '123': 'CURSOR_REMOTE' });
});

test('promptWithHeartbeat writes heartbeat before and after', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  const beats = [];
  const reply = await promptWithHeartbeat(
    opDir,
    async () => ({ replyText: 'ok', agentId: 'agent-1' }),
    'ping',
    (dir) => beats.push(dir)
  );
  assert.equal(reply, 'ok');
  assert.ok(beats.length >= 2);
});

test('runPromptWithActiveRunRecovery retries after active-run conflict', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  const session = createMockCursorBridgeAgentSession(root);
  let calls = 0;
  const original = session.promptAgent.bind(session);
  session.promptAgent = async (prompt) => {
    calls += 1;
    if (calls === 1) {
      throw new Error('Agent agent-xyz already has active run');
    }
    return original(prompt);
  };
  let synced = 0;
  const reply = await runPromptWithActiveRunRecovery(
    {
      agentSession: session,
      opDir,
      syncAgentIdFromSession: () => {
        synced += 1;
      },
    },
    'remember the code word ZETA',
    async () => {
      await session.resetSession();
    }
  );
  assert.match(reply, /ZETA/);
  assert.ok(calls >= 2);
  assert.ok(synced >= 1);
});

test('runPromptWithActiveRunRecovery retries after authentication error', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  const session = createMockCursorBridgeAgentSession(root);
  let calls = 0;
  const original = session.promptAgent.bind(session);
  session.promptAgent = async (prompt) => {
    calls += 1;
    if (calls === 1) {
      throw new Error(
        'Cursor run failed (run-f4100d8e): Authentication error If you are logged in, try logging out and back in.'
      );
    }
    return original(prompt);
  };
  const reply = await runPromptWithActiveRunRecovery(
    {
      agentSession: session,
      opDir,
      syncAgentIdFromSession: () => {},
    },
    'remember the code word ZETA',
    async () => {
      await session.resetSession();
    }
  );
  assert.match(reply, /ZETA/);
  assert.ok(calls >= 2);
});

test('runPromptWithActiveRunRecovery retries after repeated connection failures', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  const session = createMockCursorBridgeAgentSession(root);
  let calls = 0;
  const original = session.promptAgent.bind(session);
  session.promptAgent = async (prompt) => {
    calls += 1;
    if (calls === 1) {
      throw new Error('Cursor run failed (run-abcd1234): Connection failed repeatedly');
    }
    return original(prompt);
  };
  const reply = await runPromptWithActiveRunRecovery(
    {
      agentSession: session,
      opDir,
      syncAgentIdFromSession: () => {},
    },
    'remember the code word ZETA',
    async () => {
      await session.resetSession();
    }
  );
  assert.match(reply, /ZETA/);
  assert.ok(calls >= 2);
});

test('handleInboundDecision routes help and status without agent calls', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  const posts = [];
  const ctx = {
    repoRoot: root,
    botToken: 't',
    chatId: '-100',
    state: { updateOffset: 0, cursorTopicId: 1 },
    busy: false,
    agentSession: session,
    opDir: path.join(root, '.swarmforge', 'operator'),
    post: async (_t, _c, _topic, text) => {
      posts.push(text);
    },
    persistState: () => {},
    syncAgentIdFromSession: () => {},
  };
  await handleInboundDecision({ action: 'help' }, ctx, undefined, async () => {});
  await handleInboundDecision({ action: 'status' }, ctx, undefined, async () => {});
  assert.ok(posts.some((p) => p.includes('help') || p.includes('/help')));
  assert.ok(posts.some((p) => p.includes('Cursor bridge status')));
});

test('runCursorBridgePollOnce processes authorized prompt updates', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  const topicMapPath = path.join(opDir, 'cursor-bridge-topic-map.json');
  writeJsonFile(statePath, { updateOffset: 0, cursorTopicId: 55 });
  const session = createMockCursorBridgeAgentSession(root);
  const posts = [];
  const next = await runCursorBridgePollOnce(
    {
      repoRoot: root,
      botToken: 'token',
      chatId: '-100',
      principalUserId: '42',
      opDir,
      statePath,
      topicMapPath,
      agentSession: session,
      post: async (_t, _c, _topic, text) => {
        posts.push(text);
      },
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 10,
            message: {
              message_id: 1,
              text: 'remember the code word OMEGA',
              from: { id: 42 },
              chat: { id: -100 },
              message_thread_id: 55,
            },
          },
        ],
      }),
    },
    { updateOffset: 0, cursorTopicId: 55 },
    false,
    0
  );
  assert.equal(next.pollFailures, 0);
  assert.equal(next.busy, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(posts.some((p) => p.includes('OMEGA')));
  const settled = await runCursorBridgePollOnce(
    {
      repoRoot: root,
      botToken: 'token',
      chatId: '-100',
      principalUserId: '42',
      opDir,
      statePath,
      topicMapPath,
      agentSession: session,
      post: async () => {},
      getUpdates: async () => ({ success: true, updates: [] }),
    },
    next.state,
    false,
    0
  );
  assert.equal(settled.busy, false);
  assert.ok(next.state.updateOffset >= 10);
});

test('runCursorBridgePollOnce in inbound-queue mode drains forwarded Host updates without getUpdates', async () => {
  const { appendCursorBridgeInboundUpdate } = require('../out/tools/cursorBridgeInboundQueue');
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  const topicMapPath = path.join(opDir, 'cursor-bridge-topic-map.json');
  writeJsonFile(statePath, { updateOffset: 0, cursorTopicId: 55 });
  appendCursorBridgeInboundUpdate(opDir, {
    update_id: 77,
    message: {
      message_id: 9,
      text: 'advertise bubble base url on start',
      from: { id: 42 },
      chat: { id: -100 },
      message_thread_id: 55,
    },
  });
  const session = createMockCursorBridgeAgentSession(root);
  const posts = [];
  let getUpdatesCalls = 0;
  const next = await runCursorBridgePollOnce(
    {
      repoRoot: root,
      botToken: 'token',
      chatId: '-100',
      principalUserId: '42',
      opDir,
      statePath,
      topicMapPath,
      agentSession: session,
      useInboundQueue: true,
      post: async (_t, _c, _topic, text) => {
        posts.push(text);
      },
      getUpdates: async () => {
        getUpdatesCalls += 1;
        return { success: true, updates: [] };
      },
    },
    { updateOffset: 0, cursorTopicId: 55 },
    false,
    0
  );
  assert.equal(getUpdatesCalls, 0);
  assert.equal(next.pollFailures, 0);
  assert.equal(next.busy, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(posts.some((p) => /advertise bubble base url/i.test(p)));
});

test('runCursorBridgePollOnce in inbound-queue mode with an empty queue does not advance the offset or call getUpdates', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  const topicMapPath = path.join(opDir, 'cursor-bridge-topic-map.json');
  writeJsonFile(statePath, { updateOffset: 30, cursorTopicId: 55 });
  const session = createMockCursorBridgeAgentSession(root);
  let getUpdatesCalls = 0;
  const next = await runCursorBridgePollOnce(
    {
      repoRoot: root,
      botToken: 'token',
      chatId: '-100',
      principalUserId: '42',
      opDir,
      statePath,
      topicMapPath,
      agentSession: session,
      useInboundQueue: true,
      inboundQueueIdleMs: 5,
      post: async () => {},
      getUpdates: async () => {
        getUpdatesCalls += 1;
        return { success: true, updates: [] };
      },
    },
    { updateOffset: 30, cursorTopicId: 55 },
    false,
    0
  );
  assert.equal(getUpdatesCalls, 0);
  assert.equal(next.state.updateOffset, 30);
  assert.equal(next.pollFailures, 0);
});

test('runCursorBridgePollOnce in inbound-queue mode advances the offset past the HIGHEST drained update_id, not just the count', async () => {
  const { appendCursorBridgeInboundUpdate } = require('../out/tools/cursorBridgeInboundQueue');
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  const topicMapPath = path.join(opDir, 'cursor-bridge-topic-map.json');
  writeJsonFile(statePath, { updateOffset: 0, cursorTopicId: 55 });
  // Out-of-order ids on disk (append order is not id order) — the offset
  // must track the MAX id seen, not the last one appended or the count.
  appendCursorBridgeInboundUpdate(opDir, { update_id: 50, message: { message_id: 1, text: '/status', from: { id: 42 }, chat: { id: -100 }, message_thread_id: 55 } });
  appendCursorBridgeInboundUpdate(opDir, { update_id: 120, message: { message_id: 2, text: '/status', from: { id: 42 }, chat: { id: -100 }, message_thread_id: 55 } });
  appendCursorBridgeInboundUpdate(opDir, { update_id: 90, message: { message_id: 3, text: '/status', from: { id: 42 }, chat: { id: -100 }, message_thread_id: 55 } });
  const session = createMockCursorBridgeAgentSession(root);
  const next = await runCursorBridgePollOnce(
    {
      repoRoot: root,
      botToken: 'token',
      chatId: '-100',
      principalUserId: '42',
      opDir,
      statePath,
      topicMapPath,
      agentSession: session,
      useInboundQueue: true,
      post: async () => {},
      getUpdates: async () => ({ success: true, updates: [] }),
    },
    { updateOffset: 0, cursorTopicId: 55 },
    false,
    0
  );
  assert.equal(next.state.updateOffset, 121);
});

test('runCursorBridgePollOnce in inbound-queue mode never regresses the offset when drained ids are all below the current offset (redelivery)', async () => {
  const { appendCursorBridgeInboundUpdate } = require('../out/tools/cursorBridgeInboundQueue');
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  const topicMapPath = path.join(opDir, 'cursor-bridge-topic-map.json');
  writeJsonFile(statePath, { updateOffset: 500, cursorTopicId: 55 });
  appendCursorBridgeInboundUpdate(opDir, { update_id: 12, message: { message_id: 1, text: '/status', from: { id: 42 }, chat: { id: -100 }, message_thread_id: 55 } });
  const session = createMockCursorBridgeAgentSession(root);
  const next = await runCursorBridgePollOnce(
    {
      repoRoot: root,
      botToken: 'token',
      chatId: '-100',
      principalUserId: '42',
      opDir,
      statePath,
      topicMapPath,
      agentSession: session,
      useInboundQueue: true,
      post: async () => {},
      getUpdates: async () => ({ success: true, updates: [] }),
    },
    { updateOffset: 500, cursorTopicId: 55 },
    false,
    0
  );
  assert.equal(next.state.updateOffset, 500);
});

test('runCursorBridgePollOnce in inbound-queue mode, busy-queued reply acks the SPECIFIC inbound topic (Bubble), not always Cursor Remote', async () => {
  const { appendCursorBridgeInboundUpdate } = require('../out/tools/cursorBridgeInboundQueue');
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  const topicMapPath = path.join(opDir, 'cursor-bridge-topic-map.json');
  writeJsonFile(statePath, { updateOffset: 0, cursorTopicId: 55, bubbleTopicId: 91 });
  appendCursorBridgeInboundUpdate(opDir, {
    update_id: 200,
    message: {
      message_id: 4,
      text: 'another question while busy',
      from: { id: 42 },
      chat: { id: -100 },
      message_thread_id: 91,
    },
  });
  const session = createMockCursorBridgeAgentSession(root);
  const postCalls = [];
  await runCursorBridgePollOnce(
    {
      repoRoot: root,
      botToken: 'token',
      chatId: '-100',
      principalUserId: '42',
      opDir,
      statePath,
      topicMapPath,
      agentSession: session,
      useInboundQueue: true,
      post: async (_t, _c, topicId, text) => {
        postCalls.push({ topicId, text });
      },
      getUpdates: async () => ({ success: true, updates: [] }),
      telegramPostFn: async () => ({ ok: true, status: 200, json: { ok: true, result: { message_id: 777 } } }),
    },
    { updateOffset: 0, cursorTopicId: 55, bubbleTopicId: 91 },
    // Already busy — this update must be queued and acked in place, not run.
    true,
    0
  );
  assert.ok(postCalls.some((c) => c.topicId === 91 && c.text.includes('question queued (1 waiting)')));
  assert.ok(!postCalls.some((c) => c.topicId === 55));
  // The liveness cue for this queued-while-busy path must render as busy,
  // and its identity must actually reach disk (not a no-op persist).
  const persisted = loadJsonFile(statePath);
  assert.equal(persisted.livenessStatus?.renderedText, 'Bridge: busy · 1 waiting');
  // BL-767 scenario 03: the busy cue also follows the queued question into
  // its own origin topic (Bubble, 91), not only Cursor Remote (55).
  assert.equal(persisted.queuedWorkLivenessStatus?.['91']?.renderedText, 'Bridge: busy · 1 waiting');
});

test('bootstrapCursorBridgeState persists topic id', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  const topicMapPath = path.join(opDir, 'cursor-bridge-topic-map.json');
  writeJsonFile(topicMapPath, { '77': 'CURSOR_REMOTE', '7801': 'BUBBLE' });
  const state = await bootstrapCursorBridgeState(root, 'token', '-100', statePath, topicMapPath);
  assert.equal(state.cursorTopicId, 77);
  assert.equal(state.bubbleTopicId, 7801);
  assert.deepEqual(loadJsonFile(statePath), state);
});

test('ensureBubbleTopic creates topic when map is empty', async () => {
  const root = mkRoot();
  const mapPath = path.join(root, 'topic-map.json');
  const next = await ensureBubbleTopic(
    'token',
    '-100',
    mapPath,
    { updateOffset: 0 },
    async () => ({ success: true, messageThreadId: 456 })
  );
  assert.equal(next.bubbleTopicId, 456);
  assert.deepEqual(loadTopicMap(mapPath), { '456': 'BUBBLE' });
});

test('ensureBubbleTopic reuses mapped topic id', async () => {
  const root = mkRoot();
  const mapPath = path.join(root, 'topic-map.json');
  writeJsonFile(mapPath, { '99': 'BUBBLE' });
  const next = await ensureBubbleTopic('token', '-100', mapPath, { updateOffset: 0 });
  assert.equal(next.bubbleTopicId, 99);
});

test('writePollHeartbeat writes heartbeat json', () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  writePollHeartbeat(opDir, 12345);
  const raw = JSON.parse(fs.readFileSync(path.join(opDir, 'cursor-bridge-heartbeat.json'), 'utf8'));
  assert.equal(raw.lastHeartbeatMs, 12345);
});

test('runCursorBridgePollOnce backs off when polling fails', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  writeJsonFile(statePath, { updateOffset: 0, cursorTopicId: 1 });
  let backoff = 0;
  const next = await runCursorBridgePollOnce(
    {
      repoRoot: root,
      botToken: 'token',
      chatId: '-100',
      principalUserId: '1',
      opDir,
      statePath,
      topicMapPath: path.join(opDir, 'map.json'),
      agentSession: createMockCursorBridgeAgentSession(root),
      getUpdates: async () => ({ success: false, error: 'network' }),
      onPollFailure: async () => {
        backoff += 1;
      },
    },
    { updateOffset: 0, cursorTopicId: 1 },
    false,
    0
  );
  assert.equal(next.pollFailures, 1);
  assert.equal(backoff, 1);
});

test('handleInboundDecision refuses unauthorized callers', async () => {
  const root = mkRoot();
  const posts = [];
  const ctx = {
    repoRoot: root,
    botToken: 't',
    chatId: '-100',
    state: { updateOffset: 0, cursorTopicId: 1 },
    busy: false,
    agentSession: createMockCursorBridgeAgentSession(root),
    opDir: path.join(root, '.swarmforge', 'operator'),
    post: async (_t, _c, _topic, text) => posts.push(text),
    persistState: () => {},
    syncAgentIdFromSession: () => {},
  };
  await handleInboundDecision({ action: 'refuse' }, ctx, undefined, async () => {});
  assert.ok(posts.some((p) => p.includes('Unauthorized')));
});

test('handleInboundDecision surfaces agent errors to Telegram', async () => {
  const root = mkRoot();
  const posts = [];
  const session = createMockCursorBridgeAgentSession(root);
  session.promptAgent = async () => {
    throw new Error('model exploded');
  };
  const ctx = {
    repoRoot: root,
    botToken: 't',
    chatId: '-100',
    state: { updateOffset: 0, cursorTopicId: 1 },
    busy: false,
    agentSession: session,
    opDir: path.join(root, '.swarmforge', 'operator'),
    post: async (_t, _c, _topic, text) => posts.push(text),
    persistState: () => {},
    syncAgentIdFromSession: () => {},
  };
  await handleInboundDecision({ action: 'prompt', text: 'go' }, ctx, undefined, async () => {});
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(posts.some((p) => p.includes('model exploded')));
});

test('loadTopicMap treats JSON arrays as empty', () => {
  const root = mkRoot();
  const filePath = path.join(root, 'map.json');
  writeJsonFile(filePath, []);
  assert.deepEqual(loadTopicMap(filePath), {});
});

test('runCursorBridgeLoop stops when shouldContinue returns false', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  const topicMapPath = path.join(opDir, 'cursor-bridge-topic-map.json');
  writeJsonFile(statePath, { updateOffset: 0, cursorTopicId: 9 });
  let polls = 0;
  const result = await runCursorBridgeLoop(
    {
      repoRoot: root,
      botToken: 'tok',
      chatId: '-100',
      principalUserId: '42',
      opDir,
      statePath,
      topicMapPath,
      agentSession: createMockCursorBridgeAgentSession(root),
      getUpdates: async () => {
        polls += 1;
        return { success: true, updates: [] };
      },
    },
    { state: { updateOffset: 0, cursorTopicId: 9 }, busy: false, pollFailures: 0 },
    () => polls < 2
  );
  assert.equal(polls, 2);
  assert.equal(result.pollFailures, 0);
});

test('runCursorBridgeApp runs boot prompt and a single poll when configured', async () => {
  const root = mkRoot();
  const topicMapPath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json');
  writeJsonFile(topicMapPath, { '9': 'CURSOR_REMOTE', '91': 'BUBBLE' });
  const session = createMockCursorBridgeAgentSession(root);
  let getUpdateCalls = 0;
  await runCursorBridgeApp(
    {
      repoRoot: root,
      botToken: 'tok',
      chatId: '-100',
      principalUserId: '42',
      bootPrompt: 'wake',
      post: async () => {},
      telegramPostFn: NOOP_TELEGRAM_POST_FN,
      loopOverrides: {
        useInboundQueue: false,
        getUpdates: async () => {
          getUpdateCalls += 1;
          return { success: true, updates: [] };
        },
      },
      shouldContinue: () => getUpdateCalls < 1,
    },
    session
  );
  assert.equal(getUpdateCalls, 1);
});

test('runCursorBridgeApp posts a ready message on startup', async () => {
  const root = mkRoot();
  const topicMapPath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json');
  writeJsonFile(topicMapPath, { '9': 'CURSOR_REMOTE', '91': 'BUBBLE' });
  const posts = [];
  await runCursorBridgeApp(
    {
      repoRoot: root,
      botToken: 'tok',
      chatId: '-100',
      principalUserId: '42',
      post: async (_token, _chatId, _topicId, text) => {
        posts.push(text);
      },
      telegramPostFn: NOOP_TELEGRAM_POST_FN,
      shouldContinue: () => false,
    },
    createMockCursorBridgeAgentSession(root)
  );
  assert.ok(posts.includes(BRIDGE_READY_MESSAGE));
});

test('runCursorBridgeApp posts the boot liveness cue as idle (never busy) and persists its identity', async () => {
  const root = mkRoot();
  const statePath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json');
  const topicMapPath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json');
  writeJsonFile(topicMapPath, { '9': 'CURSOR_REMOTE', '91': 'BUBBLE' });
  const liveTexts = [];
  const telegramPostFn = async (url, body) => {
    const parsed = JSON.parse(body);
    if (/sendMessage$/.test(url)) {
      liveTexts.push(parsed.text);
      return { ok: true, status: 200, json: { ok: true, result: { message_id: 555 } } };
    }
    return { ok: true, status: 200, json: { ok: true, result: {} } };
  };
  await runCursorBridgeApp(
    {
      repoRoot: root,
      botToken: 'tok',
      chatId: '-100',
      principalUserId: '42',
      post: async () => {},
      telegramPostFn,
      shouldContinue: () => false,
    },
    createMockCursorBridgeAgentSession(root)
  );
  assert.ok(liveTexts.includes('Bridge: idle'));
  const persisted = loadJsonFile(statePath);
  assert.equal(persisted.livenessStatus.messageId, 555);
});

test('runCursorBridgeBootIfConfigured is a no-op without boot prompt', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  const busy = await runCursorBridgeBootIfConfigured(
    { bootPrompt: undefined, botToken: 'tok', chatId: '-100' },
    {
      state: { updateOffset: 0, cursorTopicId: 1 },
      repoRoot: root,
      busy: false,
      agentSession: session,
      opDir: path.join(root, '.swarmforge', 'operator'),
      persistState: () => {},
      syncAgentIdFromSession: () => {},
      resetAgent: async () => {},
    }
  );
  assert.equal(busy, false);
});

test('requiredEnv returns the env value when set', () => {
  process.env.SFVC_BRIDGE_TEST_VAR = 'present';
  try {
    assert.equal(requiredEnv('SFVC_BRIDGE_TEST_VAR'), 'present');
  } finally {
    delete process.env.SFVC_BRIDGE_TEST_VAR;
  }
});

test('loadJsonFile returns undefined without reading when the path is absent', () => {
  const existsSync = fs.existsSync;
  const readFileSync = fs.readFileSync;
  fs.existsSync = () => false;
  fs.readFileSync = () => {
    throw new Error('readFileSync must not run for missing paths');
  };
  try {
    assert.equal(loadJsonFile('/definitely-missing.json'), undefined);
  } finally {
    fs.existsSync = existsSync;
    fs.readFileSync = readFileSync;
  }
});

test('loadJsonFile reads with utf8 encoding', () => {
  const root = mkRoot();
  const filePath = path.join(root, 'encoded.json');
  fs.writeFileSync(filePath, '{"emoji":"⏳"}', 'utf8');
  const readFileSync = fs.readFileSync;
  fs.readFileSync = (targetPath, encoding) => {
    assert.equal(encoding, 'utf8');
    return readFileSync(targetPath, encoding);
  };
  try {
    assert.deepEqual(loadJsonFile(filePath), { emoji: '⏳' });
  } finally {
    fs.readFileSync = readFileSync;
  }
});

test('writeJsonFile writes with utf8 encoding', () => {
  const root = mkRoot();
  const filePath = path.join(root, 'out.json');
  const writeFileSync = fs.writeFileSync;
  fs.writeFileSync = (targetPath, data, encoding) => {
    assert.equal(encoding, 'utf8');
    return writeFileSync(targetPath, data, encoding);
  };
  try {
    writeJsonFile(filePath, { ok: true });
    assert.deepEqual(loadJsonFile(filePath), { ok: true });
  } finally {
    fs.writeFileSync = writeFileSync;
  }
});

test('parseJsonOrUndefined returns a parse-failure sentinel for corrupt JSON', () => {
  const result = parseJsonOrUndefined('{not-json');
  assert.notEqual(result, undefined);
  assert.equal(typeof result, 'symbol');
});

test('loadJsonFile returns undefined for corrupt JSON without throwing', () => {
  const root = mkRoot();
  const filePath = path.join(root, 'bad.json');
  fs.writeFileSync(filePath, '{not-json', 'utf8');
  assert.doesNotThrow(() => {
    assert.equal(loadJsonFile(filePath), undefined);
  });
});

test('loadJsonFile does not read when existsSync reports the path is missing', () => {
  const existsSync = fs.existsSync;
  const readFileSync = fs.readFileSync;
  fs.existsSync = () => false;
  fs.readFileSync = () => '{"would":"survive"}';
  try {
    assert.equal(loadJsonFile('/missing-path.json'), undefined);
  } finally {
    fs.existsSync = existsSync;
    fs.readFileSync = readFileSync;
  }
});

test('writeJsonFile round-trips unicode with utf8 encoding', () => {
  const root = mkRoot();
  const filePath = path.join(root, 'unicode.json');
  writeJsonFile(filePath, { label: '⏳ Working…' });
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.match(raw, /⏳ Working…/);
  assert.deepEqual(loadJsonFile(filePath), { label: '⏳ Working…' });
});

test('inboundEventOf rejects updates missing sender or chat id', () => {
  assert.equal(
    inboundEventOf({ update_id: 4, message: { text: 'hi', chat: { id: -100 } } }),
    undefined
  );
  assert.equal(
    inboundEventOf({ update_id: 5, message: { text: 'hi', from: { id: 42 } } }),
    undefined
  );
});

test('postChunks uses default error message when send fails without detail', async () => {
  await assert.rejects(
    () =>
      postChunks('token', '-100', 7, 'fail', undefined, async () => ({
        success: false,
      })),
    /sendTelegramMessage failed/
  );
});

test('postChunks forwards reply and topic ids to sendMessage', async () => {
  const calls = [];
  await postChunks(
    'tok',
    '-100',
    7,
    'hi',
    42,
    async (token, chatId, chunk, replyTo, _extra, topicId) => {
      calls.push({ token, chatId, chunk, replyTo, topicId });
      return { success: true };
    }
  );
  assert.deepEqual(calls[0], {
    token: 'tok',
    chatId: '-100',
    chunk: 'hi',
    replyTo: 42,
    topicId: 7,
  });
});

test('ensureCursorTopic returns state unchanged when topic id already set', async () => {
  const state = { updateOffset: 0, cursorTopicId: 42 };
  const next = await ensureCursorTopic(
    'token',
    '-100',
    '/nonexistent/topic-map.json',
    state,
    async () => {
      throw new Error('createForumTopic must not run');
    }
  );
  assert.equal(next.cursorTopicId, 42);
  assert.equal(next.updateOffset, 0);
});

test('ensureCursorTopic throws when topic creation fails', async () => {
  const root = mkRoot();
  const mapPath = path.join(root, 'topic-map.json');
  await assert.rejects(
    () =>
      ensureCursorTopic('token', '-100', mapPath, { updateOffset: 0 }, async () => ({
        success: false,
        error: 'api down',
      })),
    /api down/
  );
});

test('ensureCursorTopic throws when create succeeds without thread id', async () => {
  const root = mkRoot();
  const mapPath = path.join(root, 'topic-map.json');
  await assert.rejects(
    () =>
      ensureCursorTopic('token', '-100', mapPath, { updateOffset: 0 }, async () => ({
        success: true,
      })),
    /createForumTopic failed/
  );
});

test('promptWithHeartbeat writes periodic heartbeats during long prompts', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  const beats = [];
  await promptWithHeartbeat(
    opDir,
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { replyText: 'done', agentId: 'agent-1' };
    },
    'slow',
    (dir) => beats.push(dir),
    10
  );
  assert.ok(beats.length >= 3, `expected multiple heartbeats, got ${beats.length}`);
});

test('runPromptWithActiveRunRecovery does not retry CursorAgentError for non-conflict failures', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  const session = createMockCursorBridgeAgentSession(root);
  let calls = 0;
  session.promptAgent = async () => {
    calls += 1;
    throw new CursorAgentError('billing failure');
  };
  await assert.rejects(
    () =>
      runPromptWithActiveRunRecovery(
        {
          agentSession: session,
          opDir,
          syncAgentIdFromSession: () => {},
        },
        'go',
        async () => {}
      ),
    /billing failure/
  );
  assert.equal(calls, 1);
});

test('runPromptWithActiveRunRecovery rethrows CursorAgentError when not a conflict', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  const session = createMockCursorBridgeAgentSession(root);
  session.promptAgent = async () => {
    throw new CursorAgentError('billing failure', { cause: new Error('billing failure') });
  };
  await assert.rejects(
    () =>
      runPromptWithActiveRunRecovery(
        {
          agentSession: session,
          opDir,
          syncAgentIdFromSession: () => {},
        },
        'go',
        async () => {}
      ),
    /billing failure/
  );
});

test('runPromptWithActiveRunRecovery rethrows non-conflict errors', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  const session = createMockCursorBridgeAgentSession(root);
  session.promptAgent = async () => {
    throw new Error('network down');
  };
  await assert.rejects(
    () =>
      runPromptWithActiveRunRecovery(
        {
          agentSession: session,
          opDir,
          syncAgentIdFromSession: () => {},
        },
        'go',
        async () => {}
      ),
    /network down/
  );
});

test('handleInboundDecision posts busy message and preserves busy flag', async () => {
  const ctx = mkCtx({ busy: true });
  const stillBusy = await handleInboundDecision({ action: 'busy' }, ctx, 99, async () => {});
  assert.ok(ctx.posts.some((text) => text.includes('Busy')));
  assert.ok(ctx.posts.some((text) => text.includes('wait for the current run')));
  assert.equal(stillBusy, true);
});

test('handleInboundDecision returns busy unchanged for ignore or missing topic', async () => {
  const ctx = mkCtx({ busy: true });
  assert.equal(
    await handleInboundDecision({ action: 'ignore' }, ctx, undefined, async () => {}),
    true
  );
  assert.equal(ctx.posts.length, 0);

  const noTopic = mkCtx({ busy: false, cursorTopicId: undefined });
  assert.equal(
    await handleInboundDecision({ action: 'help' }, noTopic, undefined, async () => {}),
    false
  );
  assert.equal(noTopic.posts.length, 0);
});

test('handleInboundDecision new-session resets agent and posts confirmation', async () => {
  const ctx = mkCtx();
  let resetCalls = 0;
  const busy = await handleInboundDecision({ action: 'new-session' }, ctx, undefined, async () => {
    resetCalls += 1;
  });
  assert.equal(resetCalls, 1);
  assert.ok(ctx.posts.some((text) => text.includes('fresh Cursor session')));
  assert.equal(busy, false);
});

test('handleInboundDecision status reflects busy state', async () => {
  const ctx = mkCtx({ busy: true });
  await handleInboundDecision({ action: 'status' }, ctx, undefined, async () => {});
  assert.ok(ctx.posts.some((text) => text.includes('busy (run in flight)')));
});

test('handleInboundDecision queue posts a selection poll for pending prompts', async () => {
  const telegramClient = require('../out/notify/telegramClient');
  const originalSendPoll = telegramClient.sendTelegramPoll;
  const sentPolls = [];
  telegramClient.sendTelegramPoll = async (_token, _chatId, question, options) => {
    sentPolls.push({ question, options });
    return { success: true, pollId: 'poll-queue-cmd' };
  };
  try {
    const ctx = mkCtx();
    ctx.state.pendingPrompts = [
      { id: 'qp-1', text: 'first', createdAtMs: 1 },
      { id: 'qp-2', text: 'second', createdAtMs: 2 },
    ];
    ctx.state.pendingPromptPoll = { pollId: 'stale-poll', itemIds: ['qp-1', 'qp-2'] };
    await handleInboundDecision({ action: 'queue' }, ctx, 30, async () => {});
    assert.equal(sentPolls.length, 1);
    assert.match(sentPolls[0].question, /choose next queued question/);
    assert.ok(sentPolls[0].options.some((opt) => opt.includes('first')));
    assert.ok(sentPolls[0].options.some((opt) => opt.includes('second')));
    assert.ok(sentPolls[0].options.includes('Clear all queued questions'));
    assert.equal(ctx.state.pendingPromptPoll.pollId, 'poll-queue-cmd');
    assert.ok(!ctx.posts.some((text) => text.includes('Queued questions: 2')));
  } finally {
    telegramClient.sendTelegramPoll = originalSendPoll;
  }
});

test('handleInboundDecision queue reports empty without posting a poll', async () => {
  const telegramClient = require('../out/notify/telegramClient');
  const originalSendPoll = telegramClient.sendTelegramPoll;
  let pollCalls = 0;
  telegramClient.sendTelegramPoll = async () => {
    pollCalls += 1;
    return { success: true, pollId: 'should-not-fire' };
  };
  try {
    const ctx = mkCtx();
    ctx.state.pendingPrompts = [];
    await handleInboundDecision({ action: 'queue' }, ctx, 30, async () => {});
    assert.equal(pollCalls, 0);
    assert.ok(ctx.posts.some((text) => text.includes('Queue is empty.')));
  } finally {
    telegramClient.sendTelegramPoll = originalSendPoll;
  }
});

test('handleInboundDecision dequeue removes by index and persists state', async () => {
  let persisted = 0;
  const ctx = mkCtx({
    persistState: () => {
      persisted += 1;
    },
  });
  ctx.state.pendingPrompts = [
    { id: 'qp-1', text: 'first', createdAtMs: 1 },
    { id: 'qp-2', text: 'second', createdAtMs: 2 },
  ];
  ctx.state.pendingPromptPoll = { pollId: 'poll-1', itemIds: ['qp-1', 'qp-2'] };
  await handleInboundDecision({ action: 'dequeue', position: 1 }, ctx, 31, async () => {});
  assert.equal((ctx.state.pendingPrompts ?? []).length, 1);
  assert.equal(ctx.state.pendingPrompts[0].id, 'qp-2');
  assert.equal(ctx.state.pendingPromptPoll, undefined);
  assert.ok(ctx.posts.some((text) => text.includes('Dequeued #1')));
  assert.ok(persisted >= 1);
});

test('handleInboundDecision prompt posts working indicator before agent reply', async () => {
  const ctx = mkCtx();
  const replyTargets = [];
  ctx.post = async (_t, _c, _topic, text, replyTo) => {
    ctx.posts.push(text);
    replyTargets.push(replyTo);
  };
  const busy = await handleInboundDecision(
    { action: 'prompt', text: 'remember the code word ZETA' },
    ctx,
    5,
    async () => {}
  );
  assert.equal(busy, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(ctx.posts[0].includes('Agent started'));
  assert.ok(ctx.posts.some((text) => text.includes('ZETA')));
  assert.equal(replyTargets.filter((id) => id === 5).length, 1);
  assert.ok(replyTargets.slice(0, -1).every((id) => id === undefined));
});

test('handleInboundDecision forwards Telegram photos to the Cursor agent', async () => {
  const media = require('../out/bridge/cursorBridgeTelegramMedia');
  const originalDownload = media.downloadTelegramPhotoAsSdkImage;
  media.downloadTelegramPhotoAsSdkImage = async () => ({
    data: Buffer.from('jpeg-bytes').toString('base64'),
    mimeType: 'image/jpeg',
  });
  try {
    const ctx = mkCtx();
    let capturedPrompt;
    ctx.agentSession.promptAgent = async (prompt) => {
      capturedPrompt = prompt;
      return { replyText: 'looks like a screenshot', agentId: ctx.agentSession.readAgentId() };
    };
    const busy = await handleInboundDecision(
      { action: 'prompt', text: 'what is this?', photoFileIds: ['photo-1'] },
      ctx,
      9,
      async () => {}
    );
    assert.equal(busy, true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(capturedPrompt, {
      text: 'what is this?',
      images: [{ data: Buffer.from('jpeg-bytes').toString('base64'), mimeType: 'image/jpeg' }],
    });
    assert.ok(ctx.posts.some((text) => text.includes('Downloading photo')));
    assert.ok(ctx.posts.some((text) => text.includes('started with photo')));
    assert.ok(ctx.posts.some((text) => text.includes('looks like a screenshot')));
  } finally {
    media.downloadTelegramPhotoAsSdkImage = originalDownload;
  }
});

test('handleInboundDecision reports a failed photo download and starts no agent run', async () => {
  const media = require('../out/bridge/cursorBridgeTelegramMedia');
  const originalDownload = media.downloadTelegramPhotoAsSdkImage;
  media.downloadTelegramPhotoAsSdkImage = async () => {
    throw new Error('getFile 404');
  };
  try {
    const ctx = mkCtx();
    let prompted = false;
    ctx.agentSession.promptAgent = async () => {
      prompted = true;
      return { replyText: 'never', agentId: ctx.agentSession.readAgentId() };
    };
    const busy = await handleInboundDecision(
      { action: 'prompt', text: 'what is this?', photoFileIds: ['photo-1'] },
      ctx,
      11,
      async () => {}
    );
    assert.equal(busy, false);
    assert.equal(prompted, false);
    assert.ok(ctx.posts.some((text) => text.includes('Error: getFile 404')));
  } finally {
    media.downloadTelegramPhotoAsSdkImage = originalDownload;
  }
});

test('handleInboundDecision update works while agent run is in flight', async () => {
  const ctx = mkCtx();
  const session = ctx.agentSession;
  let release;
  session.promptAgent = () =>
    new Promise((resolve) => {
      release = () => resolve({ replyText: 'done', agentId: session.readAgentId() });
    });
  const busy = await handleInboundDecision({ action: 'prompt', text: 'long task' }, ctx, undefined, async () => {});
  assert.equal(busy, true);
  const posts = [];
  ctx.post = async (_t, _c, _topic, text) => {
    posts.push(text);
  };
  await handleInboundDecision({ action: 'update' }, ctx, undefined, async () => {});
  assert.ok(posts.some((text) => text.includes('Agent run in progress')));
  assert.ok(posts.some((text) => text.includes('long task')));
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test('handleInboundDecision returns busy for unrecognized actions', async () => {
  const ctx = mkCtx({ busy: true });
  assert.equal(
    await handleInboundDecision({ action: 'weird' }, ctx, undefined, async () => {}),
    true
  );
});

test('runCursorBridgePollOnce sleeps on poll failure without custom handler', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root, { cursorTopicId: 1 });
  const started = Date.now();
  const next = await runCursorBridgePollOnce(
    {
      ...deps,
      getUpdates: async () => ({ success: false, error: 'network' }),
    },
    { updateOffset: 0, cursorTopicId: 1 },
    false,
    0
  );
  assert.ok(Date.now() - started >= 900);
  assert.equal(next.pollFailures, 1);
});

test('runCursorBridgePollOnce passes incremented failure count to onPollFailure', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root, { cursorTopicId: 1 });
  let captured;
  await runCursorBridgePollOnce(
    {
      ...deps,
      getUpdates: async () => ({ success: false, error: 'network' }),
      onPollFailure: async (failures) => {
        captured = failures;
      },
    },
    { updateOffset: 0, cursorTopicId: 1 },
    false,
    2
  );
  assert.equal(captured, 3);
});

test('runCursorBridgePollOnce forwards custom poll timeout to getUpdates', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  let timeout;
  await runCursorBridgePollOnce(
    {
      ...deps,
      pollTimeoutSeconds: 7,
      getUpdates: async (_token, _offset, seconds) => {
        timeout = seconds;
        return { success: true, updates: [] };
      },
    },
    { updateOffset: 0, cursorTopicId: 55 },
    false,
    0
  );
  assert.equal(timeout, 7);
});

test('runCursorBridgePollOnce skips updates without inbound events', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const posts = [];
  await runCursorBridgePollOnce(
    {
      ...deps,
      post: async (_t, _c, _topic, text) => {
        posts.push(text);
      },
      getUpdates: async () => ({
        success: true,
        updates: [
          { update_id: 1 },
          {
            update_id: 2,
            message: {
              message_id: 9,
              text: '/help',
              from: { id: 42 },
              chat: { id: -100 },
              message_thread_id: 55,
            },
          },
        ],
      }),
    },
    { updateOffset: 0, cursorTopicId: 55 },
    false,
    0
  );
  assert.equal(posts.length, 1);
  assert.ok(posts[0].includes('/help') || posts[0].toLowerCase().includes('help'));
});

test('runCursorBridgePollOnce gates prompt to busy when already busy', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const session = deps.agentSession;
  let release;
  session.promptAgent = () =>
    new Promise((resolve) => {
      release = () => resolve({ replyText: 'done', agentId: session.readAgentId() });
    });
  const posts = [];
  const first = await runCursorBridgePollOnce(
    {
      ...deps,
      post: async (_t, _c, _topic, text) => {
        posts.push(text);
      },
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 11,
            message: {
              message_id: 2,
              text: 'remember the code word BETA',
              from: { id: 42 },
              chat: { id: -100 },
              message_thread_id: 55,
            },
          },
        ],
      }),
    },
    { updateOffset: 0, cursorTopicId: 55 },
    false,
    0
  );
  assert.equal(first.busy, true);
  await runCursorBridgePollOnce(
    {
      ...deps,
      post: async (_t, _c, _topic, text) => {
        posts.push(text);
      },
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 12,
            message: {
              message_id: 3,
              text: 'remember the code word GAMMA',
              from: { id: 42 },
              chat: { id: -100 },
              message_thread_id: 55,
            },
          },
        ],
      }),
    },
    first.state,
    first.busy,
    0
  );
  assert.ok(posts.some((text) => text.includes('Busy')));
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test('runCursorBridgePollOnce queues busy prompts and raises a selection poll when idle', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const session = deps.agentSession;
  let release;
  session.promptAgent = () =>
    new Promise((resolve) => {
      release = () => resolve({ replyText: 'done', agentId: session.readAgentId() });
    });
  const posts = [];
  await runCursorBridgePollOnce(
    {
      ...deps,
      post: async (_t, _c, _topic, text) => {
        posts.push(text);
      },
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 71,
            message: {
              message_id: 2,
              text: 'first long task',
              from: { id: 42 },
              chat: { id: -100 },
              message_thread_id: 55,
            },
          },
        ],
      }),
    },
    { updateOffset: 0, cursorTopicId: 55 },
    false,
    0
  );
  await runCursorBridgePollOnce(
    {
      ...deps,
      post: async (_t, _c, _topic, text) => {
        posts.push(text);
      },
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 72,
            message: {
              message_id: 3,
              text: 'second queued task',
              from: { id: 42 },
              chat: { id: -100 },
              message_thread_id: 55,
            },
          },
        ],
      }),
    },
    { updateOffset: 71, cursorTopicId: 55 },
    true,
    0
  );
  const queuedState = loadJsonFile(deps.statePath);
  assert.equal(queuedState.pendingPrompts.length, 1);
  assert.match(queuedState.pendingPrompts[0].text, /second queued task/);
  const telegramClient = require('../out/notify/telegramClient');
  const originalSendPoll = telegramClient.sendTelegramPoll;
  const sentPolls = [];
  telegramClient.sendTelegramPoll = async (_token, _chatId, question, options) => {
    sentPolls.push({ question, options });
    return { success: true, pollId: 'poll-queue-1' };
  };
  try {
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runCursorBridgePollOnce(
      {
        ...deps,
        post: async () => {},
        getUpdates: async () => ({ success: true, updates: [] }),
      },
      { updateOffset: 72, cursorTopicId: 55, pendingPrompts: queuedState.pendingPrompts },
      false,
      0
    );
  } finally {
    telegramClient.sendTelegramPoll = originalSendPoll;
  }
  const polledState = loadJsonFile(deps.statePath);
  assert.equal(sentPolls.length, 1);
  assert.equal(polledState.pendingPromptPoll.pollId, 'poll-queue-1');
  assert.equal(polledState.pendingPrompts.length, 1);
  assert.ok(posts.some((text) => text.includes('question queued')));
});

test('runCursorBridgePollOnce runs selected queued prompt from poll_answer', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const posts = [];
  const initialState = {
    updateOffset: 80,
    cursorTopicId: 55,
    pendingPrompts: [
      { id: 'qp-1', text: 'queued follow-up', createdAtMs: Date.now(), replyToMessageId: 45 },
    ],
    pendingPromptPoll: { pollId: 'poll-queue-1', itemIds: ['qp-1'] },
  };
  const next = await runCursorBridgePollOnce(
    {
      ...deps,
      post: async (_t, _c, _topic, text) => {
        posts.push(text);
      },
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 81,
            poll_answer: {
              poll_id: 'poll-queue-1',
              option_ids: [0],
              user: { id: 42 },
            },
          },
        ],
      }),
    },
    initialState,
    false,
    0
  );
  assert.equal(next.busy, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const persisted = loadJsonFile(deps.statePath);
  assert.equal((persisted.pendingPrompts ?? []).length, 0);
  assert.equal(persisted.pendingPromptPoll, undefined);
  assert.ok(posts.some((text) => text.includes('Agent started')));
  assert.ok(posts.some((text) => text.includes('queued follow-up')));
});

test('runCursorBridgePollOnce clear-all poll option empties queue without starting a run', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const posts = [];
  let prompted = false;
  deps.agentSession.promptAgent = async () => {
    prompted = true;
    return { replyText: 'should not run', agentId: deps.agentSession.readAgentId() };
  };
  const initialState = {
    updateOffset: 80,
    cursorTopicId: 55,
    pendingPrompts: [
      { id: 'qp-1', text: 'queued first', createdAtMs: Date.now() },
      { id: 'qp-2', text: 'queued second', createdAtMs: Date.now() },
    ],
    pendingPromptPoll: { pollId: 'poll-queue-1', itemIds: ['qp-1', 'qp-2'], clearAllOptionIndex: 2 },
  };
  const next = await runCursorBridgePollOnce(
    {
      ...deps,
      post: async (_t, _c, _topic, text) => {
        posts.push(text);
      },
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 81,
            poll_answer: {
              poll_id: 'poll-queue-1',
              option_ids: [2],
              user: { id: 42 },
            },
          },
        ],
      }),
    },
    initialState,
    false,
    0
  );
  assert.equal(next.busy, false);
  const persisted = loadJsonFile(deps.statePath);
  assert.equal((persisted.pendingPrompts ?? []).length, 0);
  assert.equal(persisted.pendingPromptPoll, undefined);
  assert.equal(prompted, false);
  assert.ok(posts.some((text) => text.includes('Cleared 2 queued questions')));
});

// BL-811 D1 regression, at the integration level (not just the pure
// decideQueuedPollAnswerAction unit/property coverage): a poll persisted by
// a pre-hotfix build has no clearAllOptionIndex field. Telegram sends
// option_ids: [] on a vote retraction, so selectedIndex is undefined too —
// before the fix, undefined === undefined cleared the whole queue. This
// drives the full runCursorBridgePollOnce -> processQueuedPollAnswer path
// with a real persisted "legacy" poll shape and asserts the queue and poll
// both survive untouched, and no "Cleared" receipt is posted.
test('runCursorBridgePollOnce ignores a vote retraction against a legacy poll with no clearAllOptionIndex field, leaving the queue and poll untouched', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const posts = [];
  let prompted = false;
  deps.agentSession.promptAgent = async () => {
    prompted = true;
    return { replyText: 'should not run', agentId: deps.agentSession.readAgentId() };
  };
  const legacyPoll = { pollId: 'poll-legacy-1', itemIds: ['qp-1'] }; // no clearAllOptionIndex — pre-hotfix shape
  const initialState = {
    updateOffset: 80,
    cursorTopicId: 55,
    pendingPrompts: [{ id: 'qp-1', text: 'queued first', createdAtMs: Date.now() }],
    pendingPromptPoll: legacyPoll,
  };
  writeJsonFile(deps.statePath, initialState);
  const next = await runCursorBridgePollOnce(
    {
      ...deps,
      post: async (_t, _c, _topic, text) => {
        posts.push(text);
      },
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 81,
            poll_answer: {
              poll_id: 'poll-legacy-1',
              option_ids: [], // retraction
              user: { id: 42 },
            },
          },
        ],
      }),
    },
    initialState,
    false,
    0
  );
  assert.equal(next.busy, false);
  const persisted = loadJsonFile(deps.statePath);
  assert.equal((persisted.pendingPrompts ?? []).length, 1, 'the retraction must not wipe the queue');
  assert.equal(persisted.pendingPrompts[0].id, 'qp-1');
  assert.deepEqual(persisted.pendingPromptPoll, legacyPoll, 'the poll itself is untouched by an ignored vote');
  assert.equal(prompted, false);
  assert.ok(!posts.some((text) => text.includes('Cleared')), 'no clear-all receipt for an ignored retraction');
});

test('runCursorBridgePollOnce reposts selection poll when outstanding poll is missing newer queued items', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const telegramClient = require('../out/notify/telegramClient');
  const originalSendPoll = telegramClient.sendTelegramPoll;
  const sentPolls = [];
  telegramClient.sendTelegramPoll = async (_token, _chatId, question, options) => {
    sentPolls.push({ question, options });
    return { success: true, pollId: 'poll-queue-refreshed' };
  };
  try {
    const initialState = {
      updateOffset: 90,
      cursorTopicId: 55,
      pendingPrompts: [
        { id: 'qp-1', text: 'first queued', createdAtMs: Date.now() },
        { id: 'qp-2', text: 'second queued', createdAtMs: Date.now() },
      ],
      // Stale outstanding poll from before the second question arrived — the
      // prior anyAlive guard starved a refresh here.
      pendingPromptPoll: { pollId: 'poll-queue-stale', itemIds: ['qp-1'], clearAllOptionIndex: 1 },
    };
    writeJsonFile(deps.statePath, initialState);
    await runCursorBridgePollOnce(
      {
        ...deps,
        post: async () => {},
        getUpdates: async () => ({ success: true, updates: [] }),
      },
      initialState,
      false,
      0
    );
  } finally {
    telegramClient.sendTelegramPoll = originalSendPoll;
  }
  assert.equal(sentPolls.length, 1);
  assert.match(sentPolls[0].question, /2 queued/);
  assert.equal(sentPolls[0].options.length, 3); // two questions + clear-all
  assert.equal(sentPolls[0].options[2], 'Clear all queued questions');
  const persisted = loadJsonFile(deps.statePath);
  assert.equal(persisted.pendingPromptPoll.pollId, 'poll-queue-refreshed');
  assert.deepEqual(persisted.pendingPromptPoll.itemIds, ['qp-1', 'qp-2']);
  assert.equal(persisted.pendingPromptPoll.clearAllOptionIndex, 2);
});

test('runCursorBridgePollOnce sweeps queued prompts older than 72h and posts a receipt', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const posts = [];
  const now = Date.now();
  const initialState = {
    updateOffset: 80,
    cursorTopicId: 55,
    pendingPrompts: [
      { id: 'qp-old', text: 'stale prompt', createdAtMs: now - QUEUED_PROMPT_TTL_MS - 1 },
      { id: 'qp-fresh', text: 'fresh prompt', createdAtMs: now - 1_000 },
    ],
  };
  await runCursorBridgePollOnce(
    {
      ...deps,
      post: async (_t, _c, _topic, text) => {
        posts.push(text);
      },
      getUpdates: async () => ({ success: true, updates: [] }),
    },
    initialState,
    false,
    0
  );
  const persisted = loadJsonFile(deps.statePath);
  assert.deepEqual((persisted.pendingPrompts ?? []).map((p) => p.id), ['qp-fresh']);
  assert.ok(posts.some((text) => text.includes('Dropped 1 queued question older than 72h')));
  assert.ok(posts.some((text) => text.includes('stale prompt')));
});

// BL-767: the reply must follow the poll's OWN recorded origin topic, never
// a hardcoded "Bubble first" guess — bubbleTopicId (91) is bound here but the
// poll was posted in a different topic (77), so the reply must land in 77.
test('runCursorBridgePollOnce routes a choice-poll answer reply to the topic the poll was posted in, not the bound Bubble topic', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const postCalls = [];
  const initialState = {
    updateOffset: 80,
    cursorTopicId: 55,
    bubbleTopicId: 91,
    pendingChoicePolls: [
      { pollId: 'poll-choice-1', question: 'Which one?', options: ['a', 'b'], createdAtMs: Date.now(), originTopicId: 77 },
    ],
  };
  const next = await runCursorBridgePollOnce(
    {
      ...deps,
      post: async (_t, _c, topicId, text) => {
        postCalls.push({ topicId, text });
      },
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 81,
            poll_answer: {
              poll_id: 'poll-choice-1',
              option_ids: [0],
              user: { id: 42 },
            },
          },
        ],
      }),
    },
    initialState,
    false,
    0
  );
  assert.equal(next.busy, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(postCalls.some((c) => c.topicId === 77 && c.text.includes('Agent started')));
  assert.ok(!postCalls.some((c) => c.topicId === 91));
  assert.ok(!postCalls.some((c) => c.topicId === 55));
});

// BL-767 invariant: "answered in exactly one topic: the one it was asked in,
// or the Cursor Remote topic when no origin was recorded" — never Bubble as
// a silent default. bubbleTopicId (91) is bound but the poll predates origin
// recording, so the reply must fall back to Cursor Remote (55), not Bubble.
test('runCursorBridgePollOnce routes a choice-poll answer reply to Cursor Remote when the poll has no recorded origin, even with a Bubble topic bound', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const postCalls = [];
  const initialState = {
    updateOffset: 80,
    cursorTopicId: 55,
    bubbleTopicId: 91,
    pendingChoicePolls: [
      { pollId: 'poll-choice-2', question: 'Which one?', options: ['a', 'b'], createdAtMs: Date.now() },
    ],
  };
  const next = await runCursorBridgePollOnce(
    {
      ...deps,
      post: async (_t, _c, topicId, text) => {
        postCalls.push({ topicId, text });
      },
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 81,
            poll_answer: {
              poll_id: 'poll-choice-2',
              option_ids: [0],
              user: { id: 42 },
            },
          },
        ],
      }),
    },
    initialState,
    false,
    0
  );
  assert.equal(next.busy, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(postCalls.some((c) => c.topicId === 55 && c.text.includes('Agent started')));
  assert.ok(!postCalls.some((c) => c.topicId === 91));
});

// BL-767: a choice-poll answer arriving while the bridge is busy must queue
// with the poll's origin topic preserved, not drop it — otherwise the later
// drain answers on Cursor Remote regardless of where the poll was posted.
test('runCursorBridgePollOnce queues a choice-poll answer with its origin topic preserved when the bridge is busy', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const initialState = {
    updateOffset: 80,
    cursorTopicId: 55,
    bubbleTopicId: 91,
    pendingChoicePolls: [
      { pollId: 'poll-choice-3', question: 'Which one?', options: ['a', 'b'], createdAtMs: Date.now(), originTopicId: 91 },
    ],
  };
  const next = await runCursorBridgePollOnce(
    {
      ...deps,
      post: async () => {},
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 81,
            poll_answer: {
              poll_id: 'poll-choice-3',
              option_ids: [0],
              user: { id: 42 },
            },
          },
        ],
      }),
    },
    initialState,
    true, // busy
    0
  );
  assert.equal(next.busy, true, 'busy is untouched — nothing new was started');
  const persisted = loadJsonFile(deps.statePath);
  assert.equal((persisted.pendingPrompts ?? []).length, 1);
  assert.equal(persisted.pendingPrompts[0].originTopicId, 91);
  assert.ok(persisted.pendingPrompts[0].text.includes('I choose option 1'));
  assert.equal((persisted.pendingChoicePolls ?? []).length, 0, 'the answered poll is cleared');
});

// BL-767 feature scenario 03, full drain path: a question queued from Bubble
// carries a standing "N waiting" cue in Bubble (posted earlier, message id
// 3001 already on disk); once the selection poll picks it and the run
// completes, that same cue must be EDITED to "0 waiting" in place — not left
// stuck at 1, and not a fresh message in some other topic.
test('runCursorBridgePollOnce edits the Bubble queued-work cue to 0 waiting once the drained question finishes', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const telegramCalls = [];
  const telegramPostFn = async (url, body) => {
    const parsedBody = JSON.parse(body);
    telegramCalls.push({ url, body: parsedBody });
    if (url.endsWith('/sendMessage')) {
      return { ok: true, status: 200, json: { ok: true, result: { message_id: 9000 + telegramCalls.length } } };
    }
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };
  let promptedText;
  deps.agentSession.promptAgent = async (prompt) => {
    promptedText = prompt;
    return { replyText: 'done', agentId: deps.agentSession.readAgentId() };
  };
  const initialState = {
    updateOffset: 80,
    cursorTopicId: 55,
    bubbleTopicId: 91,
    pendingPrompts: [{ id: 'qp-1', text: 'from bubble', createdAtMs: Date.now(), originTopicId: 91 }],
    pendingPromptPoll: { pollId: 'poll-drain-1', itemIds: ['qp-1'], clearAllOptionIndex: 1 },
    queuedWorkLivenessStatus: { '91': { topicId: 91, messageId: 3001, renderedText: 'Bridge: busy · 1 waiting' } },
  };
  writeJsonFile(deps.statePath, initialState);
  await runCursorBridgePollOnce(
    {
      ...deps,
      telegramPostFn,
      post: async () => {},
      getUpdates: async () => ({
        success: true,
        updates: [{ update_id: 81, poll_answer: { poll_id: 'poll-drain-1', option_ids: [0], user: { id: 42 } } }],
      }),
    },
    initialState,
    false,
    0
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(promptedText, 'from bubble');
  const persisted = loadJsonFile(deps.statePath);
  assert.equal((persisted.pendingPrompts ?? []).length, 0);
  const editsToBubbleCue = telegramCalls.filter(
    (c) => c.url.endsWith('/editMessageText') && c.body.message_id === 3001
  );
  assert.ok(
    editsToBubbleCue.some((c) => c.body.text === 'Bridge: idle · 0 waiting'),
    `expected an edit of message 3001 to "0 waiting"; got ${JSON.stringify(editsToBubbleCue)}`
  );
});

test('runCursorBridgePollOnce uses default postChunks when post override is omitted', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const telegramClient = require('../out/notify/telegramClient');
  const previous = telegramClient.sendTelegramMessageWithRateLimitRetry;
  const sent = [];
  telegramClient.sendTelegramMessageWithRateLimitRetry = async (
    token,
    chatId,
    chunk,
    replyTo,
    _extra,
    topicId
  ) => {
    sent.push({ token, chatId, chunk, replyTo, topicId });
    return { success: true };
  };
  try {
    await runCursorBridgePollOnce(
      {
        ...deps,
        getUpdates: async () => ({
          success: true,
          updates: [
            {
              update_id: 20,
              message: {
                message_id: 3,
                text: '/status',
                from: { id: 42 },
                chat: { id: -100 },
                message_thread_id: 55,
              },
            },
          ],
        }),
      },
      { updateOffset: 0, cursorTopicId: 55 },
      false,
      0
    );
    assert.ok(sent.some((call) => call.chunk.includes('Cursor bridge status')));
  } finally {
    telegramClient.sendTelegramMessageWithRateLimitRetry = previous;
  }
});

test('runCursorBridgePollOnce clears busy after help command', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const next = await runCursorBridgePollOnce(
    {
      ...deps,
      post: async () => {},
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 40,
            message: {
              message_id: 8,
              text: '/help',
              from: { id: 42 },
              chat: { id: -100 },
              message_thread_id: 55,
            },
          },
        ],
      }),
    },
    { updateOffset: 0, cursorTopicId: 55 },
    false,
    0
  );
  assert.equal(next.busy, false);
});

test('runCursorBridgePollOnce persists reset state via persistState', async () => {
  const root = mkRoot();
  const session = mkMemoryOnlyAgentSession('old-agent');
  const deps = mkPollDeps(root, { session });
  writeJsonFile(deps.statePath, { updateOffset: 0, cursorTopicId: 55, agentId: 'old-agent' });
  await runCursorBridgePollOnce(
    {
      ...deps,
      post: async () => {},
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 31,
            message: {
              message_id: 4,
              text: '/new',
              from: { id: 42 },
              chat: { id: -100 },
              message_thread_id: 55,
            },
          },
        ],
      }),
    },
    { updateOffset: 0, cursorTopicId: 55, agentId: 'old-agent' },
    false,
    0
  );
  const persisted = loadJsonFile(deps.statePath);
  assert.equal(persisted.agentId, session.readAgentId());
});

test('runCursorBridgePollOnce forwards reply-to message id to post', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const replyTargets = [];
  await runCursorBridgePollOnce(
    {
      ...deps,
      post: async (_t, _c, _topic, _text, replyTo) => {
        replyTargets.push(replyTo);
      },
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 41,
            message: {
              message_id: 77,
              text: '/help',
              from: { id: 42 },
              chat: { id: -100 },
              message_thread_id: 55,
            },
          },
        ],
      }),
    },
    { updateOffset: 0, cursorTopicId: 55 },
    false,
    0
  );
  assert.deepEqual(replyTargets, [77]);
});

test('runCursorBridgePollOnce persists agent id after reset via new-session', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  const deps = mkPollDeps(root, { session });
  await runCursorBridgePollOnce(
    {
      ...deps,
      post: async () => {},
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 30,
            message: {
              message_id: 4,
              text: '/new',
              from: { id: 42 },
              chat: { id: -100 },
              message_thread_id: 55,
            },
          },
        ],
      }),
    },
    { updateOffset: 0, cursorTopicId: 55, agentId: 'old-agent' },
    false,
    0
  );
  const persisted = loadJsonFile(deps.statePath);
  assert.equal(persisted.agentId, session.readAgentId());
  assert.notEqual(persisted.agentId, 'old-agent');
});

test('runCursorBridgeBootIfConfigured runs boot prompt when configured', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  const posts = [];
  let prompted;
  const original = session.promptAgent.bind(session);
  session.promptAgent = async (prompt) => {
    prompted = prompt;
    return original(prompt);
  };
  const busy = await runCursorBridgeBootIfConfigured(
    {
      bootPrompt: 'wake',
      botToken: 'tok',
      chatId: '-100',
      post: async (_t, _c, _topic, text) => {
        posts.push(text);
      },
    },
    {
      state: { updateOffset: 0, cursorTopicId: 5 },
      repoRoot: root,
      busy: false,
      agentSession: session,
      opDir: path.join(root, '.swarmforge', 'operator'),
      persistState: () => {},
      syncAgentIdFromSession: () => {},
      resetAgent: async () => {},
    }
  );
  assert.ok(posts.some((text) => text.includes('Boot test prompt: wake')));
  assert.equal(prompted, 'wake');
  assert.equal(busy, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test('runCursorBridgeBootIfConfigured skips when cursor topic is unbound', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  const posts = [];
  const busy = await runCursorBridgeBootIfConfigured(
    {
      bootPrompt: 'wake',
      botToken: 'tok',
      chatId: '-100',
      post: async (_t, _c, _topic, text) => {
        posts.push(text);
      },
    },
    {
      state: { updateOffset: 0 },
      repoRoot: root,
      busy: false,
      agentSession: session,
      opDir: path.join(root, '.swarmforge', 'operator'),
      persistState: () => {},
      syncAgentIdFromSession: () => {},
      resetAgent: async () => {},
    }
  );
  assert.equal(posts.length, 0);
  assert.equal(busy, false);
});

test('handleInboundDecision ignore with bound topic returns busy without posting', async () => {
  const ctx = mkCtx({ busy: true });
  const stillBusy = await handleInboundDecision({ action: 'ignore' }, ctx, undefined, async () => {});
  assert.equal(stillBusy, true);
  assert.equal(ctx.posts.length, 0);
});

test('handleInboundDecision prompt skips persistState when ctx not busy', async () => {
  let persistCalls = 0;
  const ctx = mkCtx({
    busy: false,
    persistState: () => {
      persistCalls += 1;
    },
  });
  await handleInboundDecision({ action: 'prompt', text: 'remember ZETA' }, ctx, 5, async () => {});
  assert.equal(persistCalls, 0);
});

test('handleInboundDecision prompt persistState when ctx busy at entry', async () => {
  let persistCalls = 0;
  const ctx = mkCtx({
    busy: true,
    persistState: () => {
      persistCalls += 1;
    },
  });
  await handleInboundDecision({ action: 'prompt', text: 'remember ZETA' }, ctx, 5, async () => {});
  assert.ok(persistCalls >= 1);
});

test('runCursorBridgePollOnce persistState when prompt marks ctx busy', async () => {
  const root = mkRoot();
  const session = mkMemoryOnlyAgentSession();
  const deps = mkPollDeps(root, { session });
  const statePath = deps.statePath;
  let stateWrites = 0;
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = (filePath, ...args) => {
    if (filePath === statePath) {
      stateWrites += 1;
    }
    return originalWrite(filePath, ...args);
  };
  try {
    await runCursorBridgePollOnce(
      {
        ...deps,
        post: async () => {},
        getUpdates: async () => ({
          success: true,
          updates: [
            {
              update_id: 60,
              message: {
                message_id: 88,
                text: 'remember the code word IOTA',
                from: { id: 42 },
                chat: { id: -100 },
                message_thread_id: 55,
              },
            },
          ],
        }),
      },
      { updateOffset: 0, cursorTopicId: 55 },
      false,
      0
    );
    assert.ok(stateWrites >= 2, 'poll write plus prompt busy persistState');
  } finally {
    fs.writeFileSync = originalWrite;
  }
});

test('runCursorBridgePollOnce writes holder agent id only via persistState on reset', async () => {
  const root = mkRoot();
  const session = mkMemoryOnlyAgentSession('old-agent');
  const deps = mkPollDeps(root, { session });
  writeJsonFile(deps.statePath, { updateOffset: 0, cursorTopicId: 55, agentId: 'old-agent' });
  await runCursorBridgePollOnce(
    {
      ...deps,
      post: async () => {},
      getUpdates: async () => ({
        success: true,
        updates: [
          {
            update_id: 32,
            message: {
              message_id: 4,
              text: '/new',
              from: { id: 42 },
              chat: { id: -100 },
              message_thread_id: 55,
            },
          },
        ],
      }),
    },
    { updateOffset: 0, cursorTopicId: 55, agentId: 'old-agent' },
    false,
    0
  );
  const persisted = loadJsonFile(deps.statePath);
  assert.equal(persisted.agentId, session.readAgentId());
  assert.notEqual(persisted.agentId, 'old-agent');
});

test('runCursorBridgePollOnce leaves busy false after prompt completes', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root);
  const updates = async () => ({
    success: true,
    updates: [
      {
        update_id: 42,
        message: {
          message_id: 12,
          text: 'remember the code word GAMMA',
          from: { id: 42 },
          chat: { id: -100 },
          message_thread_id: 55,
        },
      },
    ],
  });
  const next = await runCursorBridgePollOnce(
    {
      ...deps,
      post: async () => {},
      getUpdates: updates,
    },
    { updateOffset: 0, cursorTopicId: 55 },
    false,
    0
  );
  assert.equal(next.busy, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const settled = await runCursorBridgePollOnce(
    {
      ...deps,
      post: async () => {},
      getUpdates: async () => ({ success: true, updates: [] }),
    },
    next.state,
    false,
    0
  );
  assert.equal(settled.busy, false);
});

test('runCursorBridgeApp starts idle so the first poll can accept prompts', async () => {
  const root = mkRoot();
  const topicMapPath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json');
  writeJsonFile(topicMapPath, { '9': 'CURSOR_REMOTE', '91': 'BUBBLE' });
  const session = createMockCursorBridgeAgentSession(root);
  let polls = 0;
  let prompted = false;
  const original = session.promptAgent.bind(session);
  session.promptAgent = async (prompt) => {
    prompted = true;
    return original(prompt);
  };
  await runCursorBridgeApp(
    {
      repoRoot: root,
      botToken: 'tok',
      chatId: '-100',
      principalUserId: '42',
      telegramPostFn: NOOP_TELEGRAM_POST_FN,
      loopOverrides: {
        useInboundQueue: false,
        post: async () => {},
        getUpdates: async () => {
          polls += 1;
          return {
            success: true,
            updates: [
              {
                update_id: 50,
                message: {
                  message_id: 1,
                  text: 'remember the code word EPSILON',
                  from: { id: 42 },
                  chat: { id: -100 },
                  message_thread_id: 9,
                },
              },
            ],
          };
        },
      },
      shouldContinue: () => polls < 1,
    },
    session
  );
  assert.equal(prompted, true);
  assert.equal(polls, 1);
});

test('runCursorBridgeApp resetAgent during poll persists session state', async () => {
  const root = mkRoot();
  const topicMapPath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json');
  const statePath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json');
  writeJsonFile(topicMapPath, { '9': 'CURSOR_REMOTE', '91': 'BUBBLE' });
  writeJsonFile(statePath, { updateOffset: 0, cursorTopicId: 9, agentId: 'old-agent' });
  const session = mkMemoryOnlyAgentSession('old-agent');
  let polls = 0;
  await runCursorBridgeApp(
    {
      repoRoot: root,
      botToken: 'tok',
      chatId: '-100',
      principalUserId: '42',
      post: async () => {},
      telegramPostFn: NOOP_TELEGRAM_POST_FN,
      loopOverrides: {
        useInboundQueue: false,
        post: async () => {},
        getUpdates: async () => {
          polls += 1;
          return {
            success: true,
            updates: [
              {
                update_id: 51,
                message: {
                  message_id: 2,
                  text: '/new',
                  from: { id: 42 },
                  chat: { id: -100 },
                  message_thread_id: 9,
                },
              },
            ],
          };
        },
      },
      shouldContinue: () => polls < 1,
    },
    session
  );
  assert.equal(loadJsonFile(statePath).agentId, session.readAgentId());
});

test('runCursorBridgeApp boot persists state after active-run recovery reset', async () => {
  const root = mkRoot();
  const topicMapPath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json');
  const statePath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json');
  writeJsonFile(topicMapPath, { '9': 'CURSOR_REMOTE', '91': 'BUBBLE' });
  const session = mkMemoryOnlyAgentSession('mock-agent-1');
  let calls = 0;
  session.promptAgent = async (prompt) => {
    calls += 1;
    if (calls === 1) {
      throw new Error('Agent mock-agent-1 already has active run');
    }
    return { replyText: `echo: ${prompt}`, agentId: session.readAgentId() };
  };
  let resetCalls = 0;
  const originalReset = session.resetSession;
  session.resetSession = async () => {
    resetCalls += 1;
    return originalReset();
  };
  writeJsonFile(statePath, { updateOffset: 0, cursorTopicId: 9, agentId: 'stale-agent' });
  await runCursorBridgeApp(
    {
      repoRoot: root,
      botToken: 'tok',
      chatId: '-100',
      principalUserId: '42',
      bootPrompt: 'remember the code word THETA',
      post: async () => {},
      telegramPostFn: NOOP_TELEGRAM_POST_FN,
      loopOverrides: {
        getUpdates: async () => ({ success: true, updates: [] }),
      },
      shouldContinue: () => false,
    },
    session
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(calls >= 2);
  assert.ok(resetCalls >= 1);
  assert.equal(loadJsonFile(statePath).agentId, session.readAgentId());
  assert.notEqual(loadJsonFile(statePath).agentId, 'stale-agent');
});

test('runCursorBridgeApp default shouldContinue falls back to endless polling hook', async () => {
  const root = mkRoot();
  const topicMapPath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json');
  writeJsonFile(topicMapPath, { '9': 'CURSOR_REMOTE', '91': 'BUBBLE' });
  const session = createMockCursorBridgeAgentSession(root);
  let polls = 0;
  await assert.rejects(
    () =>
      runCursorBridgeApp(
        {
          repoRoot: root,
          botToken: 'tok',
          chatId: '-100',
          principalUserId: '42',
          post: async () => {},
          telegramPostFn: NOOP_TELEGRAM_POST_FN,
          shouldContinue: undefined,
          loopOverrides: {
            useInboundQueue: false,
            post: async () => {},
            getUpdates: async () => {
              polls += 1;
              throw new Error('stop-after-first-poll');
            },
          },
        },
        session
      ),
    /stop-after-first-poll/
  );
  assert.equal(polls, 1);
});

test('bootstrapCursorBridgeState mkdirSync uses .swarmforge/operator not repo-root operator', async () => {
  const root = mkTmpDir('sfvc-bootstrap-mkdir-');
  const externalState = path.join(root, 'external-state.json');
  writeJsonFile(externalState, { updateOffset: 0, cursorTopicId: 88, bubbleTopicId: 89 });
  await bootstrapCursorBridgeState(
    root,
    'token',
    '-100',
    externalState,
    path.join(root, 'unused-topic-map.json')
  );
  assert.ok(fs.existsSync(path.join(root, '.swarmforge', 'operator')));
  assert.equal(fs.existsSync(path.join(root, 'operator')), false);
});

test('bootstrapCursorBridgeState writes state under .swarmforge/operator', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  const topicMapPath = path.join(opDir, 'cursor-bridge-topic-map.json');
  writeJsonFile(topicMapPath, { '88': 'CURSOR_REMOTE', '8901': 'BUBBLE' });
  const state = await bootstrapCursorBridgeState(root, 'token', '-100', statePath, topicMapPath);
  assert.ok(fs.existsSync(path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json')));
  assert.deepEqual(loadJsonFile(path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json')), state);
  assert.equal(state.cursorTopicId, 88);
  assert.equal(state.bubbleTopicId, 8901);
});

test('handleInboundDecision starts expedite and posts confirmation', async () => {
  const root = mkRoot();
  const script = path.join(root, 'swarmforge', 'scripts', 'expedite_with_progress.sh');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  const posts = [];
  const ctx = mkCtx({ root, posts });
  const { startExpediteRun } = require('../out/tools/telegramCursorBridgeExpedite');
  const original = startExpediteRun;
  const restore = () => {
    require('../out/tools/telegramCursorBridgeExpedite').startExpediteRun = original;
  };
  require('../out/tools/telegramCursorBridgeExpedite').startExpediteRun = (...args) =>
    original(args[0], args[1], () => ({ pid: 9001, unref: () => {} }));
  try {
    const busy = await handleInboundDecision({ action: 'expedite', ticket: 'BL-696' }, ctx, 12, async () => {});
    assert.equal(busy, false);
    assert.ok(posts.some((p) => p.includes('Expedite BL-696 started')));
  } finally {
    restore();
  }
});

test('handleInboundDecision /pilot prompts the Cursor agent as offline expeditor', async () => {
  const ctx = mkCtx();
  let captured;
  ctx.agentSession.promptAgent = async (prompt) => {
    captured = prompt;
    return { replyText: 'piloting', agentId: ctx.agentSession.readAgentId() };
  };
  const busy = await handleInboundDecision({ action: 'pilot', ticket: 'BL-700' }, ctx, 15, async () => {});
  assert.equal(busy, true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(ctx.posts.some((p) => p.includes('Pilot BL-700 started')));
  assert.match(String(captured), /OFFLINE EXPEDITION for BL-700/);
  assert.match(String(captured), /Do NOT spawn/);
});

test('handleInboundDecision /pilot refuses while automated expedite is running', async () => {
  const root = mkRoot();
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'expedite-bridge.lock'),
    `${JSON.stringify({ ticket: 'BL-696', pid: process.pid })}\n`,
    'utf8'
  );
  const posts = [];
  const ctx = mkCtx({ root, posts });
  let prompted = false;
  ctx.agentSession.promptAgent = async () => {
    prompted = true;
    return { replyText: 'nope', agentId: ctx.agentSession.readAgentId() };
  };
  const busy = await handleInboundDecision({ action: 'pilot', ticket: 'BL-700' }, ctx, 15, async () => {});
  assert.equal(busy, false);
  assert.equal(prompted, false);
  assert.ok(posts.some((p) => p.includes('Cannot pilot BL-700')));
});

// BL-722: writes a paused defect ticket matching (or, via overrides, failing)
// the safe pilot filter used by pilotSafeDefects.ts.
function writeSafePilotTicket(root, id, overrides = {}) {
  const dir = path.join(root, 'backlog', 'paused');
  fs.mkdirSync(dir, { recursive: true });
  const fields = {
    title: id,
    type: 'defect',
    status: 'todo',
    severity: 'high',
    priority: 1,
    human_approval: 'approved',
    mutation_cost: 'low',
    ...overrides,
  };
  const body = [
    `id: ${id}`,
    `title: "${fields.title}"`,
    `type: ${fields.type}`,
    `status: ${fields.status}`,
    `severity: ${fields.severity}`,
    `priority: ${fields.priority}`,
    `human_approval: ${fields.human_approval}`,
    `mutation_cost: ${fields.mutation_cost}`,
    `acceptance: specs/features/${id}-x.feature`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, `${id}.yaml`), body);
  const featDir = path.join(root, 'specs', 'features');
  fs.mkdirSync(featDir, { recursive: true });
  fs.writeFileSync(path.join(featDir, `${id}-x.feature`), `Feature: ${id}\n`);
}

test('handleInboundDecision /pilot safe --list posts the ranked safe pool', async () => {
  const root = mkRoot();
  writeSafePilotTicket(root, 'BL-910', { severity: 'high', priority: 1 });
  writeSafePilotTicket(root, 'BL-911', { severity: 'low', priority: 1 });
  const posts = [];
  const ctx = mkCtx({ root, posts });
  const busy = await handleInboundDecision({ action: 'pilot-safe-list' }, ctx, 15, async () => {});
  assert.equal(busy, false);
  assert.ok(posts.some((p) => p.includes('BL-910') && p.includes('BL-911')));
});

test('handleInboundDecision /pilot safe --list on an empty pool says so without starting a pilot', async () => {
  const root = mkRoot();
  const posts = [];
  const ctx = mkCtx({ root, posts });
  const busy = await handleInboundDecision({ action: 'pilot-safe-list' }, ctx, 15, async () => {});
  assert.equal(busy, false);
  assert.ok(posts.some((p) => /Safe pilot pool empty/.test(p)));
});

test('handleInboundDecision /pilot safe picks and starts the top-ranked ticket', async () => {
  const root = mkRoot();
  writeSafePilotTicket(root, 'BL-910', { severity: 'low', priority: 1 });
  writeSafePilotTicket(root, 'BL-911', { severity: 'high', priority: 1 });
  const posts = [];
  const ctx = mkCtx({ root, posts });
  let captured;
  ctx.agentSession.promptAgent = async (prompt) => {
    captured = prompt;
    return { replyText: 'piloting', agentId: ctx.agentSession.readAgentId() };
  };
  const busy = await handleInboundDecision({ action: 'pilot-safe-start' }, ctx, 15, async () => {});
  assert.equal(busy, true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(posts.some((p) => /Safe filter matched 2/.test(p) && p.includes('BL-911')));
  assert.ok(posts.some((p) => p.includes('Pilot BL-911 started')));
  assert.match(String(captured), /OFFLINE EXPEDITION for BL-911/);
});

test('handleInboundDecision /pilot safe on an empty pool does not start a pilot', async () => {
  const root = mkRoot();
  const posts = [];
  const ctx = mkCtx({ root, posts });
  let prompted = false;
  ctx.agentSession.promptAgent = async () => {
    prompted = true;
    return { replyText: 'nope', agentId: ctx.agentSession.readAgentId() };
  };
  const busy = await handleInboundDecision({ action: 'pilot-safe-start' }, ctx, 15, async () => {});
  assert.equal(busy, false);
  assert.equal(prompted, false);
  assert.ok(posts.some((p) => /Safe pilot pool empty/.test(p)));
});

test('handleInboundDecision /update posts an operational summary', async () => {
  const root = mkRoot();
  const progressDir = path.join(root, '.swarmforge', 'expedite', 'BL-696');
  fs.mkdirSync(progressDir, { recursive: true });
  fs.writeFileSync(
    path.join(progressDir, 'progress.json'),
    JSON.stringify({
      ticket: 'BL-696',
      stage: 'specifier',
      status: 'running',
      detail: 'stage 1/7',
      line: '[BL-696] 📝 specifier — running\nstage 1/7',
      'updated-at-ms': Date.now(),
    }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'expedite-bridge.lock'),
    `${JSON.stringify({ ticket: 'BL-696', pid: process.pid })}\n`,
    'utf8'
  );
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-696.yaml'),
    'id: BL-696\ntitle: "Lets Talk"\nassigned_to: specifier\n',
    'utf8'
  );
  const posts = [];
  const ctx = mkCtx({ root, posts });
  const busy = await handleInboundDecision({ action: 'update' }, ctx, 12, async () => {});
  assert.equal(busy, false);
  assert.ok(posts.some((p) => p.includes('Expedite BL-696')));
  assert.ok(posts.some((p) => p.includes('Swarm: working')));
  assert.ok(posts.some((p) => p.includes('BL-696 @ specifier')));
});

test('handleInboundDecision starts WIP checkpoint reexpedite and posts confirmation', async () => {
  const root = mkRoot();
  const script = path.join(root, 'swarmforge', 'scripts', 'reexpedite_from_wip.sh');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  const posts = [];
  const ctx = mkCtx({ root, posts });
  const expediteModule = require('../out/tools/telegramCursorBridgeExpedite');
  const original = expediteModule.startReexpediteRun;
  expediteModule.startReexpediteRun = (...args) =>
    original(args[0], args[1], () => ({ pid: 9002, unref: () => {} }));
  try {
    const busy = await handleInboundDecision({ action: 'reexpedite', ticket: 'BL-696' }, ctx, 12, async () => {});
    assert.equal(busy, false);
    assert.ok(posts.some((p) => p.includes('checkpoint and restart for BL-696 started')));
  } finally {
    expediteModule.startReexpediteRun = original;
  }
});

test('handleInboundDecision status includes running expedite lock', async () => {
  const root = mkRoot();
  const lockPath = path.join(root, '.swarmforge', 'operator', 'expedite-bridge.lock');
  fs.writeFileSync(lockPath, `${JSON.stringify({ ticket: 'BL-696', pid: process.pid })}\n`, 'utf8');
  const posts = [];
  const ctx = mkCtx({ root, posts });
  await handleInboundDecision({ action: 'status' }, ctx, undefined, async () => {});
  assert.ok(posts.some((p) => p.includes('Expedite: BL-696 running')));
});

test('handleInboundDecision redeploy posts confirmation', async () => {
  const root = mkRoot();
  const script = path.join(root, 'swarmforge', 'scripts', 'redeploy_cursor_bridge.sh');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  const posts = [];
  const ctx = mkCtx({ root, posts });
  const { startRedeployRun } = require('../out/tools/telegramCursorBridgeRedeploy');
  const original = startRedeployRun;
  require('../out/tools/telegramCursorBridgeRedeploy').startRedeployRun = (...args) =>
    original(args[0], () => ({ pid: 9002, unref: () => {} }));
  try {
    const busy = await handleInboundDecision({ action: 'redeploy' }, ctx, 13, async () => {});
    assert.equal(busy, false);
    assert.ok(posts.some((p) => p.includes('Redeploy started')));
  } finally {
    require('../out/tools/telegramCursorBridgeRedeploy').startRedeployRun = original;
  }
});

test('handleInboundDecision redeploy-miniapp posts confirmation', async () => {
  const root = mkRoot();
  const script = path.join(root, 'swarmforge', 'scripts', 'bounce_bridge_headless.sh');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  const posts = [];
  const ctx = mkCtx({ root, posts });
  const mod = require('../out/tools/telegramCursorBridgeMiniAppRedeploy');
  const original = mod.startMiniAppRedeployRun;
  mod.startMiniAppRedeployRun = (...args) =>
    original(args[0], () => ({ pid: 9003, unref: () => {} }));
  try {
    const busy = await handleInboundDecision({ action: 'redeploy-miniapp' }, ctx, 14, async () => {});
    assert.equal(busy, false);
    assert.ok(posts.some((p) => p.includes('Mini app redeploy started')));
  } finally {
    mod.startMiniAppRedeployRun = original;
  }
});

test('handleInboundDecision log posts tail without reply quote', async () => {
  const root = mkRoot();
  const logPath = path.join(root, '.swarmforge', 'operator', 'expedite-BL-696.log');
  fs.writeFileSync(logPath, 'alpha\nbravo\n', 'utf8');
  const posts = [];
  const replyTargets = [];
  const ctx = mkCtx({
    root,
    posts,
    post: async (_t, _c, _topic, text, replyTo) => {
      posts.push(text);
      replyTargets.push(replyTo);
    },
  });
  await handleInboundDecision({ action: 'log', target: { kind: 'expedite', ticket: 'BL-696' } }, ctx, 99, async () => {});
  assert.ok(posts.some((p) => p.includes('bravo')));
  assert.deepEqual(replyTargets, [undefined]);
});

// BL-894 P3: /queue must never adopt wherever it was sent from as the
// permanent Host topic — only ensureCursorTopic's own canonical binding may
// set cursorTopicId. Drives handleQueueInboundAction directly (via the same
// handleInboundDecision entry point production uses) so the assertion holds
// regardless of which caller reaches it.
test('handleInboundDecision queue never adopts the arrival topic as the permanent Host topic', async () => {
  const root = mkRoot();
  const posts = [];
  const ctx = mkCtx({ root, posts, cursorTopicId: undefined });
  ctx.state.pendingPrompts = [
    { id: 'qp-1', text: 'first', createdAtMs: Date.now() },
    { id: 'qp-2', text: 'second', createdAtMs: Date.now() },
  ];
  const busy = await handleInboundDecision({ action: 'queue' }, ctx, undefined, async () => {}, 999);
  assert.equal(busy, false);
  assert.equal(
    ctx.state.cursorTopicId,
    undefined,
    'the /queue arrival topic (999) must never become the permanent Host topic'
  );
  assert.equal(posts.length, 0, 'no poll (or any post) is possible without a bound Host topic');
});

// BL-894 P2: a vote on a poll this bridge itself superseded (a fresh /queue
// repost) must tell the human, not vanish in silence.
test('runCursorBridgePollOnce tells the human a vote landed on a superseded queue poll, and leaves the queue untouched', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root, { cursorTopicId: 55 });
  const telegramClient = require('../out/notify/telegramClient');
  const originalSendPoll = telegramClient.sendTelegramPoll;
  const sentPolls = [];
  telegramClient.sendTelegramPoll = async (_token, _chatId, question, options) => {
    sentPolls.push({ question, options });
    return { success: true, pollId: 'poll-fresh' };
  };
  const posts = [];
  try {
    const initialState = {
      updateOffset: 0,
      cursorTopicId: 55,
      pendingPrompts: [
        { id: 'qp-1', text: 'first queued', createdAtMs: Date.now() },
        { id: 'qp-2', text: 'second queued', createdAtMs: Date.now() },
      ],
      pendingPromptPoll: { pollId: 'poll-old', itemIds: ['qp-1', 'qp-2'], clearAllOptionIndex: 2 },
    };
    writeJsonFile(deps.statePath, initialState);

    const first = await runCursorBridgePollOnce(
      {
        ...deps,
        post: async (_t, _c, _topic, text) => {
          posts.push(text);
        },
        getUpdates: async () => ({
          success: true,
          updates: [
            {
              update_id: 1,
              message: { message_id: 1, text: '/queue', from: { id: 42 }, chat: { id: -100 }, message_thread_id: 55 },
            },
          ],
        }),
      },
      initialState,
      false,
      0
    );
    assert.equal(sentPolls.length, 1, 'expected the repost to send a fresh poll');
    const afterRepost = loadJsonFile(deps.statePath);
    assert.equal(afterRepost.pendingPromptPoll.pollId, 'poll-fresh');
    assert.deepEqual(afterRepost.supersededPromptPollIds, ['poll-old']);

    await runCursorBridgePollOnce(
      {
        ...deps,
        post: async (_t, _c, _topic, text) => {
          posts.push(text);
        },
        getUpdates: async () => ({
          success: true,
          updates: [{ update_id: 2, poll_answer: { poll_id: 'poll-old', option_ids: [0], user: { id: 42 } } }],
        }),
      },
      first.state,
      first.busy,
      0
    );
  } finally {
    telegramClient.sendTelegramPoll = originalSendPoll;
  }
  assert.ok(
    posts.some((t) => /no longer live/i.test(t)),
    `expected a reply telling the human the poll is stale; posts:\n${posts.join('\n---\n')}`
  );
  const finalState = loadJsonFile(deps.statePath);
  assert.equal((finalState.pendingPrompts ?? []).length, 2, 'a vote on a superseded poll must never change the queue');
  assert.equal(finalState.pendingPromptPoll.pollId, 'poll-fresh', 'the live poll is untouched by a vote on the superseded one');
});

// BL-894 D1 (hardener bounce 2026-08-14): supersededPromptPollId was a
// single scalar, so a SECOND /queue repost overwrote the first repost's id
// and a vote on the now-doubly-superseded poll fell through silently (no
// post, no queue change). Reproduces two reposts before voting on the very
// first (generation-0) poll.
test('runCursorBridgePollOnce tells the human a vote landed on a poll superseded by TWO reposts, not just one', async () => {
  const root = mkRoot();
  const deps = mkPollDeps(root, { cursorTopicId: 55 });
  const telegramClient = require('../out/notify/telegramClient');
  const originalSendPoll = telegramClient.sendTelegramPoll;
  let freshCounter = 0;
  telegramClient.sendTelegramPoll = async () => ({ success: true, pollId: `poll-fresh-${++freshCounter}` });
  const posts = [];
  function queueUpdate(updateId) {
    return {
      update_id: updateId,
      message: { message_id: updateId, text: '/queue', from: { id: 42 }, chat: { id: -100 }, message_thread_id: 55 },
    };
  }
  try {
    const initialState = {
      updateOffset: 0,
      cursorTopicId: 55,
      pendingPrompts: [
        { id: 'qp-1', text: 'first queued', createdAtMs: Date.now() },
        { id: 'qp-2', text: 'second queued', createdAtMs: Date.now() },
      ],
      pendingPromptPoll: { pollId: 'poll-gen0', itemIds: ['qp-1', 'qp-2'], clearAllOptionIndex: 2 },
    };
    writeJsonFile(deps.statePath, initialState);

    const first = await runCursorBridgePollOnce(
      { ...deps, post: async (_t, _c, _topic, text) => posts.push(text), getUpdates: async () => ({ success: true, updates: [queueUpdate(1)] }) },
      initialState,
      false,
      0
    );
    const second = await runCursorBridgePollOnce(
      { ...deps, post: async (_t, _c, _topic, text) => posts.push(text), getUpdates: async () => ({ success: true, updates: [queueUpdate(2)] }) },
      first.state,
      first.busy,
      0
    );
    assert.equal(freshCounter, 2, 'expected two reposts to each send a fresh poll');
    const afterSecondRepost = loadJsonFile(deps.statePath);
    assert.equal(afterSecondRepost.pendingPromptPoll.pollId, 'poll-fresh-2');

    await runCursorBridgePollOnce(
      {
        ...deps,
        post: async (_t, _c, _topic, text) => posts.push(text),
        getUpdates: async () => ({
          success: true,
          updates: [{ update_id: 3, poll_answer: { poll_id: 'poll-gen0', option_ids: [0], user: { id: 42 } } }],
        }),
      },
      second.state,
      second.busy,
      0
    );
  } finally {
    telegramClient.sendTelegramPoll = originalSendPoll;
  }
  assert.ok(
    posts.some((t) => /no longer live/i.test(t)),
    `expected a reply telling the human the doubly-superseded poll is stale, not silence; posts:\n${posts.join('\n---\n')}`
  );
  const finalState = loadJsonFile(deps.statePath);
  assert.equal((finalState.pendingPrompts ?? []).length, 2, 'a vote on a doubly-superseded poll must never change the queue');
});

test('telegramCursorBridgeLive exports poll and file name constants', () => {
  const mod = require('../out/tools/telegramCursorBridgeLive');
  assert.equal(mod.POLL_TIMEOUT_SECONDS, 30);
  assert.equal(mod.STATE_FILE_NAME, 'cursor-bridge-state.json');
  assert.equal(mod.TOPIC_MAP_FILE_NAME, 'cursor-bridge-topic-map.json');
  assert.equal(mod.HEARTBEAT_FILE_NAME, 'cursor-bridge-heartbeat.json');
});
