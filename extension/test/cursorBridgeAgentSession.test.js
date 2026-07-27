const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  createMockCursorBridgeAgentSession,
  isAbandonedAgentLock,
  runCursorAgentPrompt,
  buildAgentOptions,
  withAgentLock,
} = require('../out/bridge/cursorBridgeAgentSession');

function mkRoot() {
  const root = mkTmpDir('sfvc-cursor-session-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

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
  const opts = buildAgentOptions('/repo', 'key-1', 'auto-smart');
  assert.equal(opts.model.id, 'auto-smart');
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
    const { createLiveCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');
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

test('cursorBridgeAgentSession: live session recovers from active-run conflict', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  let calls = 0;
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
    const { createLiveCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');
    const session = createLiveCursorBridgeAgentSession(root);
    const reply = await session.promptAgent('ping');
    assert.match(reply.replyText, /after reset/);
    assert.ok(calls >= 2);
  } finally {
    sdk.Agent.create = originalCreate;
    delete process.env.CURSOR_API_KEY;
  }
});
