const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  cursorBridgeInboundQueuePath,
  appendCursorBridgeInboundUpdate,
  drainCursorBridgeInboundUpdates,
} = require('../out/tools/cursorBridgeInboundQueue');

function tmpOpDir() {
  return mkTmpDir('cursor-bridge-inbound-');
}

test('inbound queue: append then drain returns updates in order and clears the file', () => {
  const opDir = tmpOpDir();
  appendCursorBridgeInboundUpdate(opDir, { update_id: 1, message: { text: 'a' } });
  appendCursorBridgeInboundUpdate(opDir, { update_id: 2, message: { text: 'b' } });
  assert.ok(fs.existsSync(cursorBridgeInboundQueuePath(opDir)));
  const first = drainCursorBridgeInboundUpdates(opDir);
  assert.equal(first.length, 2);
  assert.equal(first[0].update_id, 1);
  assert.equal(first[1].update_id, 2);
  assert.deepEqual(drainCursorBridgeInboundUpdates(opDir), []);
});

test('inbound queue: drain skips malformed lines without throwing', () => {
  const opDir = tmpOpDir();
  const file = cursorBridgeInboundQueuePath(opDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not-json\n{"update_id":3}\n\n{"noUpdateId":true}\n');
  const got = drainCursorBridgeInboundUpdates(opDir);
  assert.equal(got.length, 1);
  assert.equal(got[0].update_id, 3);
});
