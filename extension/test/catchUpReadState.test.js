const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  catchUpReadStatePath,
  messageReadKey,
  readCatchUpReadState,
  isMessageRead,
  withMessageMarkedRead,
  markMessageRead,
} = require('../out/bridge/catchUpReadState');

function mkTmp() {
  return mkTmpDir('sfvc-catch-up-read-');
}

test('messageReadKey encodes topic id and seq', () => {
  assert.equal(messageReadKey('BL-528', 3), 'BL-528:3');
});

test('readCatchUpReadState returns empty readKeys when the file is missing', () => {
  const root = mkTmp();
  assert.deepEqual(readCatchUpReadState(root), { readKeys: [] });
});

test('readCatchUpReadState tolerates corrupt JSON', () => {
  const root = mkTmp();
  fs.mkdirSync(path.dirname(catchUpReadStatePath(root)), { recursive: true });
  fs.writeFileSync(catchUpReadStatePath(root), 'not json');
  assert.deepEqual(readCatchUpReadState(root), { readKeys: [] });
});

test('withMessageMarkedRead is idempotent', () => {
  const once = withMessageMarkedRead({ readKeys: [] }, 'BL-1', 0);
  const twice = withMessageMarkedRead(once, 'BL-1', 0);
  assert.deepEqual(once, twice);
  assert.equal(isMessageRead(once, 'BL-1', 0), true);
});

test('markMessageRead persists to .swarmforge/catch-up-read-state.json', () => {
  const root = mkTmp();
  markMessageRead(root, 'AGENT_QUESTIONS', 2);
  const state = readCatchUpReadState(root);
  assert.deepEqual(state.readKeys, ['AGENT_QUESTIONS:2']);
});
