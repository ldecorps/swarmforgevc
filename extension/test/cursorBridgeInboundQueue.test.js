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

test('inbound queue: drain still returns parsed updates even when its own best-effort unlink cleanup fails', () => {
  const opDir = tmpOpDir();
  appendCursorBridgeInboundUpdate(opDir, { update_id: 9 });
  const originalReadFileSync = fs.readFileSync;
  // Simulate a concurrent cleanup removing the renamed-aside "draining" file
  // out from under this drain, between its read and its own unlink below -
  // the unlink must be caught and swallowed (best-effort), never lose the
  // already-read result.
  fs.readFileSync = (filePath, encoding) => {
    const result = originalReadFileSync(filePath, encoding);
    fs.unlinkSync(filePath);
    return result;
  };
  try {
    const got = drainCursorBridgeInboundUpdates(opDir);
    assert.equal(got.length, 1);
    assert.equal(got[0].update_id, 9);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test('inbound queue: drain removes the renamed-aside "draining" file on the normal path (own cleanup runs, not left behind)', () => {
  const opDir = tmpOpDir();
  appendCursorBridgeInboundUpdate(opDir, { update_id: 1 });
  const originalRenameSync = fs.renameSync;
  let capturedDrainingPath;
  fs.renameSync = (src, dest) => {
    capturedDrainingPath = dest;
    return originalRenameSync(src, dest);
  };
  try {
    drainCursorBridgeInboundUpdates(opDir);
  } finally {
    fs.renameSync = originalRenameSync;
  }
  assert.ok(capturedDrainingPath, 'renameSync should have been called with the draining path');
  assert.equal(fs.existsSync(capturedDrainingPath), false);
  // Math.random().toString(36) always carries a leading "0." (Math.random()
  // is in [0, 1)) - the trailing random segment must have that prefix
  // sliced off, or the draining filename would embed a literal "0.".
  const randomSuffix = capturedDrainingPath.split('-').pop();
  assert.ok(
    !randomSuffix.startsWith('0.'),
    `expected the "0." toString(36) prefix to be sliced off the random suffix, got: ${randomSuffix}`
  );
});
