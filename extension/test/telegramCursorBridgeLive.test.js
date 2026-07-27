const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { createMockCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');
const {
  bootstrapCursorBridgeState,
  ensureCursorTopic,
  handleInboundDecision,
  inboundEventOf,
  loadJsonFile,
  loadTopicMap,
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
} = require('../out/tools/telegramCursorBridgeLive');

function mkRoot() {
  const root = mkTmpDir('sfvc-tg-bridge-live-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
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
    message: { text: 'hi', from: { id: 9 }, chat: { id: -100 }, message_thread_id: 5 },
  });
  assert.deepEqual(event, { fromId: 9, chatId: -100, topicId: 5, text: 'hi' });
});

test('postChunks splits and sends each chunk', async () => {
  const sent = [];
  await postChunks('token', '-100', 7, 'a\nb', undefined, async (_t, _c, chunk) => {
    sent.push(chunk);
    return { success: true };
  });
  assert.ok(sent.length >= 1);
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

test('handleInboundDecision routes help and status without agent calls', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  const posts = [];
  const ctx = {
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
  assert.equal(next.busy, false);
  assert.ok(next.state.updateOffset >= 10);
});

test('bootstrapCursorBridgeState persists topic id', async () => {
  const root = mkRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  const topicMapPath = path.join(opDir, 'cursor-bridge-topic-map.json');
  writeJsonFile(topicMapPath, { '77': 'CURSOR_REMOTE' });
  const state = await bootstrapCursorBridgeState(root, 'token', '-100', statePath, topicMapPath);
  assert.equal(state.cursorTopicId, 77);
  assert.deepEqual(loadJsonFile(statePath), state);
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
  writeJsonFile(topicMapPath, { '9': 'CURSOR_REMOTE' });
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
      loopOverrides: {
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

test('runCursorBridgeBootIfConfigured is a no-op without boot prompt', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  const busy = await runCursorBridgeBootIfConfigured(
    { bootPrompt: undefined, botToken: 'tok', chatId: '-100' },
    {
      state: { updateOffset: 0, cursorTopicId: 1 },
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
