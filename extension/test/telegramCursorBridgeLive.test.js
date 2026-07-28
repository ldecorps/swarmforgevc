const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CursorAgentError } = require('@cursor/sdk');
const { mkTmpDir } = require('./helpers/tmpDir');
const { createMockCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');
const {
  bootstrapCursorBridgeState,
  ensureCursorTopic,
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
} = require('../out/tools/telegramCursorBridgeLive');

function mkRoot() {
  const root = mkTmpDir('sfvc-tg-bridge-live-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

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
    fromId: 9,
    chatId: -100,
    topicId: 5,
    text: 'hi',
    messageId: 42,
  });
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

test('handleInboundDecision prompt posts working indicator before agent reply', async () => {
  const ctx = mkCtx();
  const replyTargets = [];
  ctx.post = async (_t, _c, _topic, text, replyTo) => {
    ctx.posts.push(text);
    replyTargets.push(replyTo);
  };
  await handleInboundDecision(
    { action: 'prompt', text: 'remember the code word ZETA' },
    ctx,
    5,
    async () => {}
  );
  assert.ok(ctx.posts[0].includes('Agent started'));
  assert.ok(ctx.posts.some((text) => text.includes('ZETA')));
  assert.equal(replyTargets.filter((id) => id === 5).length, 1);
  assert.ok(replyTargets.slice(0, -1).every((id) => id === undefined));
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
    true,
    0
  );
  assert.ok(posts.some((text) => text.includes('Busy')));
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
  assert.equal(busy, false);
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
  const next = await runCursorBridgePollOnce(
    {
      ...deps,
      post: async () => {},
      getUpdates: async () => ({
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
      }),
    },
    { updateOffset: 0, cursorTopicId: 55 },
    false,
    0
  );
  assert.equal(next.busy, false);
});

test('runCursorBridgeApp starts idle so the first poll can accept prompts', async () => {
  const root = mkRoot();
  const topicMapPath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json');
  writeJsonFile(topicMapPath, { '9': 'CURSOR_REMOTE' });
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
      loopOverrides: {
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
  writeJsonFile(topicMapPath, { '9': 'CURSOR_REMOTE' });
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
      loopOverrides: {
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
  writeJsonFile(topicMapPath, { '9': 'CURSOR_REMOTE' });
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
      loopOverrides: {
        getUpdates: async () => ({ success: true, updates: [] }),
      },
      shouldContinue: () => false,
    },
    session
  );
  assert.ok(calls >= 2);
  assert.ok(resetCalls >= 1);
  assert.equal(loadJsonFile(statePath).agentId, session.readAgentId());
  assert.notEqual(loadJsonFile(statePath).agentId, 'stale-agent');
});

test('runCursorBridgeApp default shouldContinue falls back to endless polling hook', async () => {
  const root = mkRoot();
  const topicMapPath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json');
  writeJsonFile(topicMapPath, { '9': 'CURSOR_REMOTE' });
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
          shouldContinue: undefined,
          loopOverrides: {
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
  writeJsonFile(externalState, { updateOffset: 0, cursorTopicId: 88 });
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
  writeJsonFile(topicMapPath, { '88': 'CURSOR_REMOTE' });
  const state = await bootstrapCursorBridgeState(root, 'token', '-100', statePath, topicMapPath);
  assert.ok(fs.existsSync(path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json')));
  assert.deepEqual(loadJsonFile(path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json')), state);
  assert.equal(state.cursorTopicId, 88);
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

test('telegramCursorBridgeLive exports poll and file name constants', () => {
  const mod = require('../out/tools/telegramCursorBridgeLive');
  assert.equal(mod.POLL_TIMEOUT_SECONDS, 30);
  assert.equal(mod.STATE_FILE_NAME, 'cursor-bridge-state.json');
  assert.equal(mod.TOPIC_MAP_FILE_NAME, 'cursor-bridge-topic-map.json');
  assert.equal(mod.HEARTBEAT_FILE_NAME, 'cursor-bridge-heartbeat.json');
});
