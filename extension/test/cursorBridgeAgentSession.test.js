const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const MODULE_PATH = require.resolve('../out/bridge/cursorBridgeAgentSession');

function loadCursorBridgeAgentSessionFresh() {
  delete require.cache[MODULE_PATH];
  return require(MODULE_PATH);
}

let createMockCursorBridgeAgentSession;
let isAbandonedAgentLock;
let runCursorAgentPrompt;
let buildAgentOptions;
let withAgentLock;
let resolveCursorApiKey;

beforeEach(() => {
  ({
    createMockCursorBridgeAgentSession,
    isAbandonedAgentLock,
    runCursorAgentPrompt,
    buildAgentOptions,
    withAgentLock,
    resolveCursorApiKey,
  } = loadCursorBridgeAgentSessionFresh());
});

function mkRoot() {
  const root = mkTmpDir('sfvc-cursor-session-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function statePath(root) {
  return path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json');
}

function lockPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'cursor-bridge-agent.lock');
}

test('cursorBridgeAgentSession: fresh require loads tsc interop exports', () => {
  const mod = loadCursorBridgeAgentSessionFresh();
  assert.equal(typeof mod.withAgentLock, 'function');
  assert.equal(typeof mod.createMockCursorBridgeAgentSession, 'function');
  assert.equal(typeof mod.isAbandonedAgentLock, 'function');
  assert.equal(typeof mod.buildAgentOptions, 'function');
  assert.equal(typeof mod.runCursorAgentPrompt, 'function');
  assert.equal(typeof mod.createLiveCursorBridgeAgentSession, 'function');
});

test('cursorBridgeAgentSession: mock session remembers and recalls code words', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  const first = await session.promptAgent('remember the code word GAMMA');
  assert.match(first.replyText, /GAMMA/);
  const second = await session.promptAgent('what was the code word');
  assert.match(second.replyText, /GAMMA/);
  assert.equal(first.agentId, second.agentId);
});

test('cursorBridgeAgentSession: resetSession clears remembered context', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  await session.promptAgent('remember the code word DELTA');
  const before = session.readAgentId();
  await session.resetSession();
  const after = await session.promptAgent('what was the code word');
  assert.notEqual(session.readAgentId(), before);
  assert.match(after.replyText, /do not have a code word/i);
});

test('cursorBridgeAgentSession: withAgentLock serializes concurrent holders', async () => {
  const root = mkRoot();
  let concurrent = 0;
  let maxConcurrent = 0;
  const hold = async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 30));
    concurrent -= 1;
  };
  await Promise.all([withAgentLock(root, hold), withAgentLock(root, hold)]);
  assert.equal(maxConcurrent, 1);
});

test('cursorBridgeAgentSession: withAgentLock waits for a contended lock to clear', async () => {
  const root = mkRoot();
  let releaseFirst;
  const firstHold = withAgentLock(root, async () => {
    await new Promise((resolve) => {
      releaseFirst = resolve;
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const waitStarted = Date.now();
  const second = withAgentLock(root, async () => 'second');
  await new Promise((resolve) => setTimeout(resolve, 900));
  releaseFirst();
  assert.equal(await firstHold, undefined);
  assert.equal(await second, 'second');
  assert.ok(Date.now() - waitStarted >= 800);
}, 10000);

test('cursorBridgeAgentSession: withAgentLock uses strict less-than maxAttempts', async () => {
  vi.useFakeTimers();
  const ceilSpy = vi.spyOn(Math, 'ceil').mockReturnValue(2);
  const root = mkRoot();
  let releaseHold;
  const holding = withAgentLock(root, async () => {
    await new Promise((resolve) => {
      releaseHold = resolve;
    });
  });
  await Promise.resolve();
  let polls = 0;
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (handler, delay, ...args) => {
    if (delay === 25) {
      polls += 1;
    }
    return originalSetTimeout(handler, delay, ...args);
  };
  try {
    const pending = withAgentLock(root, async () => 'ok');
    const rejection = assert.rejects(pending, /cursor bridge agent lock timeout/);
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    assert.equal(polls, 2);
  } finally {
    global.setTimeout = originalSetTimeout;
    ceilSpy.mockRestore();
    releaseHold();
    await holding;
    vi.useRealTimers();
  }
});

test('cursorBridgeAgentSession: acquireAgentLock computes maxAttempts with division', async () => {
  const ceilSpy = vi.spyOn(Math, 'ceil');
  try {
    const root = mkRoot();
    let releaseHold;
    const holding = withAgentLock(root, async () => {
      await new Promise((resolve) => {
        releaseHold = resolve;
      });
    });
    await Promise.resolve();
    const pending = withAgentLock(root, async () => 'ok');
    releaseHold();
    await pending;
    await holding;
    assert.ok(ceilSpy.mock.calls.some(([value]) => value === (10 * 60 * 1000) / 25));
  } finally {
    ceilSpy.mockRestore();
  }
});

test('cursorBridgeAgentSession: isAbandonedAgentLock uses strict greater-than stale comparison', () => {
  const root = mkRoot();
  const file = lockPath(root);
  fs.writeFileSync(file, `${process.pid}\n`);
  const fixedNow = Date.now();
  const originalNow = Date.now;
  const originalStat = fs.statSync;
  Date.now = () => fixedNow;
  fs.statSync = (target) => {
    const stat = originalStat(target);
    if (target === file) {
      return { ...stat, mtimeMs: fixedNow - 5 * 60 * 1000 };
    }
    return stat;
  };
  try {
    assert.equal(isAbandonedAgentLock(file), false);
  } finally {
    Date.now = originalNow;
    fs.statSync = originalStat;
  }
});

test('cursorBridgeAgentSession: loadState reads state files as utf8', async () => {
  const root = mkRoot();
  fs.writeFileSync(statePath(root), `${JSON.stringify({ updateOffset: 0 })}\n`, 'utf8');
  const originalRead = fs.readFileSync;
  let seenEncoding;
  fs.readFileSync = (filePath, encoding) => {
    if (String(filePath).endsWith('cursor-bridge-state.json')) {
      seenEncoding = encoding;
    }
    return originalRead(filePath, encoding);
  };
  try {
    const session = createMockCursorBridgeAgentSession(root);
    await session.promptAgent('hello');
    assert.equal(seenEncoding, 'utf8');
  } finally {
    fs.readFileSync = originalRead;
  }
});

test('cursorBridgeAgentSession: readLockHolderPid trims lock file contents', () => {
  const root = mkRoot();
  const file = lockPath(root);
  fs.writeFileSync(file, ' 999999999 \n');
  let trimmed = false;
  const originalTrim = String.prototype.trim;
  String.prototype.trim = function lockTrimSpy() {
    if (String(this).includes('999999999')) {
      trimmed = true;
    }
    return originalTrim.call(this);
  };
  try {
    assert.equal(isAbandonedAgentLock(file), true);
    assert.equal(trimmed, true);
  } finally {
    String.prototype.trim = originalTrim;
  }
});

test('cursorBridgeAgentSession: isAbandonedAgentLock skips process.kill when pid is missing', () => {
  const root = mkRoot();
  const file = lockPath(root);
  fs.writeFileSync(file, 'abc\n');
  let killCalled = false;
  const originalKill = process.kill;
  process.kill = (pid, signal) => {
    killCalled = true;
    return originalKill.call(process, pid, signal);
  };
  try {
    assert.equal(isAbandonedAgentLock(file), true);
    assert.equal(killCalled, false);
  } finally {
    process.kill = originalKill;
  }
});

test('cursorBridgeAgentSession: isAbandonedAgentLock clears locks from dead processes', () => {
  const root = mkRoot();
  const lockPath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-agent.lock');
  fs.writeFileSync(lockPath, '999999999\n');
  assert.equal(isAbandonedAgentLock(lockPath), true);
});

test('cursorBridgeAgentSession: acquireAgentLock recovers an abandoned lock file', async () => {
  const root = mkRoot();
  const lockPath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-agent.lock');
  fs.writeFileSync(lockPath, '999999999\n');
  let acquired = false;
  await withAgentLock(root, async () => {
    acquired = true;
  });
  assert.equal(acquired, true);
  assert.equal(fs.existsSync(lockPath), false);
});

test('cursorBridgeAgentSession: buildAgentOptions includes model and local cwd', () => {
  const opts = buildAgentOptions('/repo', 'key-1', 'auto');
  assert.equal(opts.model.id, 'auto');
  assert.equal(opts.local.cwd, '/repo');
  assert.equal(opts.apiKey, 'key-1');
});

test('cursorBridgeAgentSession: runCursorAgentPrompt collects assistant text', async () => {
  const agent = {
    async send() {
      return {
        async *stream() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } };
        },
        async wait() {
          return { status: 'success', id: 'run-1' };
        },
      };
    },
  };
  const text = await runCursorAgentPrompt(agent, 'ping');
  assert.equal(text, 'hello');
});

test('cursorBridgeAgentSession: runCursorAgentPrompt throws on error status', async () => {
  const agent = {
    async send() {
      return {
        async *stream() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } };
        },
        async wait() {
          return { status: 'error', id: 'run-err', error: { message: 'boom' } };
        },
      };
    },
  };
  await assert.rejects(() => runCursorAgentPrompt(agent, 'ping'), /boom/);
});

function mockSdkAgent(replyText = 'live reply') {
  return {
    agentId: 'agent-live-99',
    close: async () => {},
    async send() {
      return {
        async *stream() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: replyText }] } };
        },
        async wait() {
          return { status: 'success', id: 'run-live' };
        },
      };
    },
  };
}

test('cursorBridgeAgentSession: live session prompts through SDK agent', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const originalResume = sdk.Agent.resume;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  sdk.Agent.create = async () => mockSdkAgent('remember the code word LIVE');
  sdk.Agent.resume = async () => mockSdkAgent('resumed');
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    const first = await session.promptAgent('remember the code word LIVE');
    assert.match(first.replyText, /LIVE/);
    assert.equal(first.agentId, 'agent-live-99');
    const second = await session.resetSession();
    assert.equal(second.agentId, undefined);
  } finally {
    sdk.Agent.create = originalCreate;
    sdk.Agent.resume = originalResume;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live session recovers when resumed agentId is gone', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const originalResume = sdk.Agent.resume;
  let creates = 0;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json'),
    `${JSON.stringify({ updateOffset: 0, agentId: 'agent-47f26e41-65e8-459a-96f0-4a6a8e7bbfb0' }, null, 2)}\n`,
    'utf8'
  );
  sdk.Agent.resume = async () => {
    throw new Error('Agent agent-47f26e41-65e8-459a-96f0-4a6a8e7bbfb0 not found.');
  };
  sdk.Agent.create = async () => {
    creates += 1;
    return mockSdkAgent('after gone-agent reset');
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    const reply = await session.promptAgent('ping');
    assert.match(reply.replyText, /after gone-agent reset/);
    assert.equal(creates, 1);
    assert.equal(session.readAgentId(), 'agent-live-99');
  } finally {
    sdk.Agent.create = originalCreate;
    sdk.Agent.resume = originalResume;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live session recovers from authentication error', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const originalResume = sdk.Agent.resume;
  let creates = 0;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json'),
    `${JSON.stringify({ updateOffset: 0, agentId: 'stale-agent' }, null, 2)}\n`,
    'utf8'
  );
  sdk.Agent.resume = async () => {
    throw new Error('Authentication error If you are logged in, try logging out and back in.');
  };
  sdk.Agent.create = async () => {
    creates += 1;
    return mockSdkAgent('after auth reset');
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    const reply = await session.promptAgent('ping');
    assert.match(reply.replyText, /after auth reset/);
    assert.equal(creates, 1);
    assert.equal(session.readAgentId(), 'agent-live-99');
  } finally {
    sdk.Agent.create = originalCreate;
    sdk.Agent.resume = originalResume;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live session recovers from active-run conflict', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  let calls = 0;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  sdk.Agent.create = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        agentId: 'agent-conflict',
        close: async () => {},
        async send() {
          throw new sdk.CursorAgentError('Agent agent-conflict already has active run');
        },
      };
    }
    return mockSdkAgent('after reset');
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    const reply = await session.promptAgent('ping');
    assert.match(reply.replyText, /after reset/);
    assert.ok(calls >= 2);
  } finally {
    sdk.Agent.create = originalCreate;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: isAbandonedAgentLock treats stale mtime as abandoned', () => {
  const root = mkRoot();
  const file = lockPath(root);
  fs.writeFileSync(file, `${process.pid}\n`);
  const staleMs = Date.now() - 6 * 60 * 1000;
  fs.utimesSync(file, new Date(staleMs), new Date(staleMs));
  assert.equal(isAbandonedAgentLock(file), true);
});

test('cursorBridgeAgentSession: isAbandonedAgentLock keeps a fresh lock inside the stale window', () => {
  const root = mkRoot();
  const file = lockPath(root);
  fs.writeFileSync(file, `${process.pid}\n`);
  const twoMinAgo = Date.now() - 2 * 60 * 1000;
  fs.utimesSync(file, new Date(twoMinAgo), new Date(twoMinAgo));
  assert.equal(isAbandonedAgentLock(file), false);
});

test('cursorBridgeAgentSession: isAbandonedAgentLock treats nearly five minute old locks as fresh', () => {
  const root = mkRoot();
  const file = lockPath(root);
  fs.writeFileSync(file, `${process.pid}\n`);
  const almostFiveMinAgo = Date.now() - (5 * 60 * 1000 - 250);
  fs.utimesSync(file, new Date(almostFiveMinAgo), new Date(almostFiveMinAgo));
  assert.equal(isAbandonedAgentLock(file), false);
});

test('cursorBridgeAgentSession: isAbandonedAgentLock keeps a live pid lock', () => {
  const root = mkRoot();
  const file = lockPath(root);
  fs.writeFileSync(file, `${process.pid}\n`);
  assert.equal(isAbandonedAgentLock(file), false);
});

test('cursorBridgeAgentSession: isAbandonedAgentLock rejects invalid pid values', () => {
  const root = mkRoot();
  const cases = [
    ['lock-zero.lock', '0\n'],
    ['lock-abc.lock', 'abc\n'],
    ['lock-empty.lock', '\n'],
    ['lock-space.lock', '  42  \n'],
    ['lock-null-padded.lock', '\u0000999999999\n'],
  ];
  for (const [name, raw] of cases) {
    const file = path.join(root, '.swarmforge', 'operator', name);
    fs.writeFileSync(file, raw);
    assert.equal(isAbandonedAgentLock(file), true, `expected abandoned for ${JSON.stringify(raw)}`);
  }
});

test('cursorBridgeAgentSession: isAbandonedAgentLock treats EPERM from process.kill as a live holder', () => {
  const root = mkRoot();
  const file = lockPath(root);
  const targetPid = 424242;
  fs.writeFileSync(file, `${targetPid}\n`);
  const originalKill = process.kill;
  process.kill = (pid, signal) => {
    if (pid === targetPid) {
      const err = new Error('operation not permitted');
      err.code = 'EPERM';
      throw err;
    }
    return originalKill.call(process, pid, signal);
  };
  try {
    assert.equal(isAbandonedAgentLock(file), false);
  } finally {
    process.kill = originalKill;
  }
});

test('cursorBridgeAgentSession: buildAgentOptions omits apiKey and keeps empty settingSources', () => {
  const opts = buildAgentOptions('/repo', undefined, 'auto');
  assert.equal('apiKey' in opts, false);
  assert.deepEqual(opts.local.settingSources, []);
  assert.equal(opts.local.cwd, '/repo');
});

test('cursorBridgeAgentSession: runCursorAgentPrompt returns placeholder for empty assistant stream', async () => {
  const agent = {
    async send() {
      return {
        async *stream() {},
        async wait() {
          return { status: 'success', id: 'run-empty' };
        },
      };
    },
  };
  assert.equal(await runCursorAgentPrompt(agent, 'ping'), '(no text reply)');
});

test('cursorBridgeAgentSession: runCursorAgentPrompt throws unknown error when message missing', async () => {
  const agent = {
    async send() {
      return {
        async *stream() {},
        async wait() {
          return { status: 'error', id: 'run-err', error: {} };
        },
      };
    },
  };
  await assert.rejects(() => runCursorAgentPrompt(agent, 'ping'), /unknown error/);
});

test('cursorBridgeAgentSession: runCursorAgentPrompt handles missing error object via optional chaining', async () => {
  const agent = {
    async send() {
      return {
        async *stream() {},
        async wait() {
          return { status: 'error', id: 'run-err' };
        },
      };
    },
  };
  await assert.rejects(() => runCursorAgentPrompt(agent, 'ping'), /unknown error/);
});

test('cursorBridgeAgentSession: runCursorAgentPrompt forwards only streamed messages to collector', async () => {
  const core = require('../out/tools/telegramCursorBridgeCore');
  const originalCollect = core.collectAssistantTextFromMessages;
  let captured;
  core.collectAssistantTextFromMessages = (messages) => {
    captured = messages;
    return originalCollect(messages);
  };
  const agent = {
    async send() {
      return {
        async *stream() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } };
        },
        async wait() {
          return { status: 'success', id: 'run-1' };
        },
      };
    },
  };
  try {
    assert.equal(await runCursorAgentPrompt(agent, 'ping'), 'hello');
    assert.equal(captured.length, 1);
  } finally {
    core.collectAssistantTextFromMessages = originalCollect;
  }
});

test('cursorBridgeAgentSession: runCursorAgentPrompt trims assistant whitespace', async () => {
  const agent = {
    async send() {
      return {
        async *stream() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: '  padded  ' }] } };
        },
        async wait() {
          return { status: 'success', id: 'run-trim' };
        },
      };
    },
  };
  assert.equal(await runCursorAgentPrompt(agent, 'ping'), 'padded');
});

test('cursorBridgeAgentSession: mock session exposes rememberedCodeWord helper', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  assert.equal(session.readAgentId(), 'mock-agent-1');
  assert.equal(session.rememberedCodeWord(), undefined);
  await session.promptAgent('remember the code word ZETA');
  assert.equal(session.rememberedCodeWord(), 'ZETA');
});

test('cursorBridgeAgentSession: mock session ignores prompts without a code word token', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  await session.promptAgent('remember the code word ZETA');
  await session.promptAgent('remember the code word ');
  assert.equal(session.rememberedCodeWord(), 'ZETA');
  const recall = await session.promptAgent('what was the code word');
  assert.match(recall.replyText, /ZETA/);
});

test('cursorBridgeAgentSession: mock session leaves rememberedCodeWord unset for ordinary prompts', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  await session.promptAgent('just chatting');
  assert.equal(session.rememberedCodeWord(), undefined);
});

test('cursorBridgeAgentSession: mock resetSession returns agentId and persists state', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  const reset = await session.resetSession();
  assert.ok(Object.hasOwn(reset, 'agentId'));
  assert.match(reset.agentId, /^mock-agent-/);
  const persisted = JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
  assert.equal(persisted.agentId, reset.agentId);
  assert.equal(persisted.updateOffset, 0);
});

test('cursorBridgeAgentSession: mock promptAgent persists agentId under operator state path', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  const reply = await session.promptAgent('hello');
  const persisted = JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
  assert.equal(persisted.agentId, reply.agentId);
  assert.equal(persisted.updateOffset, 0);
  assert.equal(session.readAgentId(), reply.agentId);
});

test('cursorBridgeAgentSession: live session resumes agentId from persisted state', async () => {
  const root = mkRoot();
  fs.writeFileSync(statePath(root), `${JSON.stringify({ updateOffset: 3, agentId: 'existing-agent' }, null, 2)}\n`);
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const originalResume = sdk.Agent.resume;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  let resumedId;
  sdk.Agent.create = async () => {
    throw new Error('create must not run when state carries agentId');
  };
  sdk.Agent.resume = async (agentId, opts) => {
    resumedId = agentId;
    assert.equal(opts.model.id, 'auto');
    return mockSdkAgent('resumed reply');
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    const reply = await session.promptAgent('ping');
    assert.equal(resumedId, 'existing-agent');
    assert.match(reply.replyText, /resumed reply/);
    assert.equal(session.readAgentId(), 'agent-live-99');
    assert.equal(JSON.parse(fs.readFileSync(statePath(root), 'utf8')).updateOffset, 3);
  } finally {
    sdk.Agent.create = originalCreate;
    sdk.Agent.resume = originalResume;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live session honors CURSOR_BRIDGE_MODEL override', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const prevModel = process.env.CURSOR_BRIDGE_MODEL;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  process.env.CURSOR_BRIDGE_MODEL = 'custom-model';
  let capturedModel;
  sdk.Agent.create = async (opts) => {
    capturedModel = opts.model.id;
    return mockSdkAgent('model check');
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    await session.promptAgent('ping');
    assert.equal(capturedModel, 'custom-model');
  } finally {
    sdk.Agent.create = originalCreate;
    if (prevModel === undefined) delete process.env.CURSOR_BRIDGE_MODEL;
    else process.env.CURSOR_BRIDGE_MODEL = prevModel;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live session reuses cached agent across prompts', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  let creates = 0;
  sdk.Agent.create = async () => {
    creates += 1;
    return mockSdkAgent('cached');
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    await session.promptAgent('one');
    await session.promptAgent('two');
    assert.equal(creates, 1);
    assert.equal(session.readAgentId(), 'agent-live-99');
  } finally {
    sdk.Agent.create = originalCreate;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live session propagates non-conflict agent errors without recovery', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  let creates = 0;
  sdk.Agent.create = async () => {
    creates += 1;
    return {
      agentId: 'agent-fail',
      close: async () => {},
      async send() {
        throw new Error('quota exceeded');
      },
    };
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    await assert.rejects(() => session.promptAgent('ping'), /quota exceeded/);
    assert.equal(creates, 1);
  } finally {
    sdk.Agent.create = originalCreate;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live session recovers active-run conflict from plain Error', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  let calls = 0;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  sdk.Agent.create = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        agentId: 'agent-plain-conflict',
        close: async () => {},
        async send() {
          throw new Error('Agent agent-plain-conflict already has active run');
        },
      };
    }
    return mockSdkAgent('plain recovery');
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    const reply = await session.promptAgent('ping');
    assert.match(reply.replyText, /plain recovery/);
    assert.ok(calls >= 2);
  } finally {
    sdk.Agent.create = originalCreate;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live resetSession clears persisted agentId', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  sdk.Agent.create = async () => mockSdkAgent('persist me');
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    await session.resetSession();
    await session.promptAgent('ping');
    assert.equal(JSON.parse(fs.readFileSync(statePath(root), 'utf8')).agentId, 'agent-live-99');
    const reset = await session.resetSession();
    assert.ok(Object.hasOwn(reset, 'agentId'));
    assert.equal(reset.agentId, undefined);
    assert.equal(session.readAgentId(), undefined);
    const persisted = JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
    assert.equal(persisted.agentId, undefined);
    assert.equal(persisted.updateOffset, 0);
  } finally {
    sdk.Agent.create = originalCreate;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: loadState reads utf8 state files with non-ascii agent ids', async () => {
  const root = mkRoot();
  const raw = `${JSON.stringify({ updateOffset: 7, agentId: 'mock-☃' }, null, 2)}\n`;
  fs.writeFileSync(statePath(root), raw, 'utf8');
  assert.equal(fs.readFileSync(statePath(root), 'utf8'), raw);
  const session = createMockCursorBridgeAgentSession(root);
  await session.promptAgent('hello');
  const persisted = JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
  assert.equal(persisted.updateOffset, 7);
  assert.equal(persisted.agentId, session.readAgentId());
});

test('cursorBridgeAgentSession: resolveCursorApiKey reads swarm.env when process env is empty', () => {
  const root = mkRoot();
  const envPath = path.join(root, '.swarmforge', 'swarm.env');
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, 'export CURSOR_API_KEY="key-from-swarm-env"\n', 'utf8');
  const prev = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    assert.equal(resolveCursorApiKey(root), 'key-from-swarm-env');
  } finally {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
});

test('cursorBridgeAgentSession: resolveCursorApiKey fails with actionable message when missing everywhere', () => {
  const root = mkRoot();
  const prev = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    assert.throws(() => resolveCursorApiKey(root), /CURSOR_API_KEY is not set/);
    assert.throws(() => resolveCursorApiKey(root), /swarm\.env/);
  } finally {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
});
