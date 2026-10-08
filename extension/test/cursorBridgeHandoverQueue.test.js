const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  cursorBridgeHandoverQueuePath,
  appendCursorBridgeHandoverUpdate,
  drainCursorBridgeHandoverUpdates,
  readAppliedHandoverIds,
  isHandoverUpdateApplied,
  recordAppliedHandoverId,
} = require('../out/tools/cursorBridgeHandoverQueue');

function tmpOpDir() {
  return mkTmpDir('cursor-bridge-handover-');
}

test('handover queue: append then drain returns updates in order and clears the file', () => {
  const opDir = tmpOpDir();
  appendCursorBridgeHandoverUpdate(opDir, { update_id: 1, message: { text: 'a' } });
  appendCursorBridgeHandoverUpdate(opDir, { update_id: 2, message: { text: 'b' } });
  assert.ok(fs.existsSync(cursorBridgeHandoverQueuePath(opDir)));
  const first = drainCursorBridgeHandoverUpdates(opDir);
  assert.equal(first.length, 2);
  assert.equal(first[0].update_id, 1);
  assert.equal(first[1].update_id, 2);
  assert.deepEqual(drainCursorBridgeHandoverUpdates(opDir), []);
});

test('handover queue: drain skips malformed lines without throwing', () => {
  const opDir = tmpOpDir();
  const file = cursorBridgeHandoverQueuePath(opDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not-json\n{"update_id":3}\n\n{"noUpdateId":true}\n');
  const got = drainCursorBridgeHandoverUpdates(opDir);
  assert.equal(got.length, 1);
  assert.equal(got[0].update_id, 3);
});

test('handover queue: drain on an empty/missing queue returns an empty array', () => {
  const opDir = tmpOpDir();
  assert.deepEqual(drainCursorBridgeHandoverUpdates(opDir), []);
});

test('applied handover ids: missing file reads as empty, unknown id is not applied', () => {
  const opDir = tmpOpDir();
  assert.deepEqual(readAppliedHandoverIds(opDir), new Set());
  assert.equal(isHandoverUpdateApplied(opDir, 1), false);
});

test('applied handover ids: malformed JSON reads as empty rather than throwing', () => {
  const opDir = tmpOpDir();
  const file = path.join(opDir, 'cursor-bridge-handover-applied.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not-json');
  assert.deepEqual(readAppliedHandoverIds(opDir), new Set());
});

test('applied handover ids: recording an id makes it read back as applied', () => {
  const opDir = tmpOpDir();
  recordAppliedHandoverId(opDir, 42);
  assert.equal(isHandoverUpdateApplied(opDir, 42), true);
  assert.equal(isHandoverUpdateApplied(opDir, 43), false);
});

test('applied handover ids: recording the same id twice does not duplicate it', () => {
  const opDir = tmpOpDir();
  recordAppliedHandoverId(opDir, 7);
  recordAppliedHandoverId(opDir, 7);
  assert.deepEqual(readAppliedHandoverIds(opDir), new Set([7]));
});

test('applied handover ids: growth is bounded - the oldest ids are dropped past the cap', () => {
  const opDir = tmpOpDir();
  for (let i = 0; i < 510; i += 1) {
    recordAppliedHandoverId(opDir, i);
  }
  const ids = readAppliedHandoverIds(opDir);
  assert.equal(ids.size, 500);
  assert.equal(ids.has(0), false, 'the oldest id must have been dropped');
  assert.equal(ids.has(509), true, 'the newest id must be kept');
});
