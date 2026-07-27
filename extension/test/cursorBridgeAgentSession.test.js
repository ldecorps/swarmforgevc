const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  createMockCursorBridgeAgentSession,
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
