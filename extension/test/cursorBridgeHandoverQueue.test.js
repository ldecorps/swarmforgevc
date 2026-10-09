const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  cursorBridgeHandoverQueuePath,
  appendCursorBridgeHandoverUpdate,
  drainCursorBridgeHandoverUpdates,
  drainCursorBridgeHandoverUpdatesDurable,
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

// ── durable drain — BL-2061 D3 (QA bounce 2026-10-09, "kill mid-apply loses drained hand-overs") ──

test('handover queue (durable drain): commit() removes the draining file; without it, the file is left behind', () => {
  const opDir = tmpOpDir();
  appendCursorBridgeHandoverUpdate(opDir, { update_id: 1 });
  const { updates, commit } = drainCursorBridgeHandoverUpdatesDurable(opDir);
  assert.equal(updates.length, 1);
  assert.equal(fs.existsSync(cursorBridgeHandoverQueuePath(opDir)), false, 'the live queue file must be gone the instant it is drained');
  const leftoverBefore = fs.readdirSync(opDir).filter((n) => n.includes('.draining-'));
  assert.equal(leftoverBefore.length, 1, 'the draining file must still exist until commit() is called - this is what a kill mid-apply leaves behind');
  commit();
  const leftoverAfter = fs.readdirSync(opDir).filter((n) => n.includes('.draining-'));
  assert.equal(leftoverAfter.length, 0, 'commit() must remove the draining file');
});

test('handover queue (durable drain): an uncommitted drain is recovered by the next durable drain, merged ahead of anything freshly appended', () => {
  const opDir = tmpOpDir();
  appendCursorBridgeHandoverUpdate(opDir, { update_id: 1 });
  appendCursorBridgeHandoverUpdate(opDir, { update_id: 2 });
  const killed = drainCursorBridgeHandoverUpdatesDurable(opDir);
  assert.deepEqual(killed.updates.map((u) => u.update_id), [1, 2]);
  // killed.commit() is deliberately never called - simulating the process
  // dying before it got a chance to apply or requeue either entry.

  // A new entry arrives (the bridge appending another hand-over) before
  // the next drain runs.
  appendCursorBridgeHandoverUpdate(opDir, { update_id: 3 });

  const recovered = drainCursorBridgeHandoverUpdatesDurable(opDir);
  assert.deepEqual(
    recovered.updates.map((u) => u.update_id),
    [1, 2, 3],
    'the next durable drain must recover the uncommitted entries ahead of the freshly appended one, losing none'
  );
  recovered.commit();
  const finalLeftover = fs.readdirSync(opDir).filter((n) => n.includes('.draining-'));
  assert.equal(finalLeftover.length, 0, 'commit() on the recovering drain must clean up every draining file it read, including the recovered one');
});

test('handover queue (durable drain): a committed drain leaves nothing for the next drain to recover', () => {
  const opDir = tmpOpDir();
  appendCursorBridgeHandoverUpdate(opDir, { update_id: 1 });
  const first = drainCursorBridgeHandoverUpdatesDurable(opDir);
  first.commit();
  const second = drainCursorBridgeHandoverUpdatesDurable(opDir);
  assert.deepEqual(second.updates, []);
  second.commit();
});

test('handover queue (durable drain): drain on an empty/missing queue returns an empty array and a no-op commit', () => {
  const opDir = tmpOpDir();
  const { updates, commit } = drainCursorBridgeHandoverUpdatesDurable(opDir);
  assert.deepEqual(updates, []);
  assert.doesNotThrow(() => commit());
});

test('handover queue (durable drain): skips malformed lines without throwing, same as the non-durable drain', () => {
  const opDir = tmpOpDir();
  const file = cursorBridgeHandoverQueuePath(opDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not-json\n{"update_id":3}\n\n{"noUpdateId":true}\n');
  const { updates, commit } = drainCursorBridgeHandoverUpdatesDurable(opDir);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].update_id, 3);
  commit();
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

test('applied handover ids: a well-formed array with non-number entries keeps only the numbers', () => {
  const opDir = tmpOpDir();
  const file = path.join(opDir, 'cursor-bridge-handover-applied.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([1, 'not-a-number', null, 2, { update_id: 3 }]));
  assert.deepEqual(readAppliedHandoverIds(opDir), new Set([1, 2]));
  assert.equal(isHandoverUpdateApplied(opDir, 'not-a-number'), false);
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
