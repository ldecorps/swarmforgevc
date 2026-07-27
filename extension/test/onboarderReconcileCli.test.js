const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { reconcileOnce, writeOnboarderHeartbeat, main } = require('../out/tools/onboarder-reconcile');

function mkTmpRoot() {
  return mkTmpDir('sfvc-onboarding-reconcile-');
}

function heartbeatPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'onboarder-heartbeat.json');
}

function topicMapPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json');
}

function readTopicMapFixture(root) {
  return JSON.parse(fs.readFileSync(topicMapPath(root), 'utf8'));
}

function fakeCreateOk(threadId) {
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: threadId, name: 'Onboarding' } } };
  };
  return { postFn, calls };
}

test('BL-590: writeOnboarderHeartbeat writes the shared {lastHeartbeatMs} shape', () => {
  const root = mkTmpRoot();
  writeOnboarderHeartbeat(root, () => 12345);
  assert.deepEqual(JSON.parse(fs.readFileSync(heartbeatPath(root), 'utf8')), { lastHeartbeatMs: 12345 });
});

test('BL-590: reconcileOnce ensures the Onboarding topic and writes a heartbeat in one call', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeCreateOk(42);
  const topicId = await reconcileOnce(root, 'fake-token', 'fake-chat', postFn, () => 999);
  assert.equal(topicId, 42);
  assert.equal(calls.length, 1);
  assert.equal(readTopicMapFixture(root)['42'], 'ONBOARDING');
  assert.deepEqual(JSON.parse(fs.readFileSync(heartbeatPath(root), 'utf8')), { lastHeartbeatMs: 999 });
});

test('BL-590: reconcileOnce reuses an already-bound topic without creating another, still refreshing the heartbeat', async () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.dirname(topicMapPath(root)), { recursive: true });
  fs.writeFileSync(topicMapPath(root), JSON.stringify({ '42': 'ONBOARDING' }));
  const { postFn, calls } = fakeCreateOk(999);
  const topicId = await reconcileOnce(root, 'fake-token', 'fake-chat', postFn, () => 555);
  assert.equal(topicId, 42);
  assert.equal(calls.length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(heartbeatPath(root), 'utf8')), { lastHeartbeatMs: 555 });
});

test('BL-590: main() reconcile-once mode succeeds with valid env vars', async () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.dirname(topicMapPath(root)), { recursive: true });
  fs.writeFileSync(topicMapPath(root), JSON.stringify({ '42': 'ONBOARDING' }));
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_CHAT_ID;
  const originalLog = console.log;
  const logs = [];
  console.log = (msg) => logs.push(msg);
  try {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = 'test-chat';
    // Pre-existing topic map allows reconcileOnce to succeed without calling Telegram
    await main([root, 'reconcile-once']);
    assert(logs.length > 0);
    assert(logs[0].includes('ok'));
  } finally {
    console.log = originalLog;
    if (originalToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = originalToken;
    if (originalChatId !== undefined) process.env.TELEGRAM_CHAT_ID = originalChatId;
    if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    if (originalChatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
  }
});

test('BL-590: main() requires TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID and a valid mode, never crashes with a raw stack trace', async () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_CHAT_ID;
  const originalExit = process.exit;
  const originalError = console.error;
  const exits = [];
  const errors = [];
  process.exit = (code) => {
    exits.push(code);
    throw new Error('__exit__');
  };
  console.error = (msg) => errors.push(msg);
  try {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    await assert.rejects(() => main(['/tmp/whatever', 'bogus-mode']), /__exit__/);
    assert.deepEqual(exits, [1]);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
    if (originalToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = originalToken;
    if (originalChatId !== undefined) process.env.TELEGRAM_CHAT_ID = originalChatId;
  }
});
