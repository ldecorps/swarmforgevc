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

test('handover queue: a successful drain removes its own renamed-aside draining file (no leftover litter)', () => {
  const opDir = tmpOpDir();
  appendCursorBridgeHandoverUpdate(opDir, { update_id: 1 });
  assert.deepEqual(drainCursorBridgeHandoverUpdates(opDir).map((u) => u.update_id), [1]);
  const leftover = fs.readdirSync(opDir).filter((n) => n.includes('.draining-'));
  assert.deepEqual(leftover, [], 'the non-durable drain must unlink its draining file once read - it never commits later like the durable drain');
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

test('handover queue (durable drain): the fresh draining filename embeds a millisecond timestamp first, not the pid - leftover recovery sorts on it', () => {
  const opDir = tmpOpDir();
  appendCursorBridgeHandoverUpdate(opDir, { update_id: 1 });
  const originalRenameSync = fs.renameSync;
  let capturedDrainingPath;
  fs.renameSync = (src, dest) => {
    capturedDrainingPath = dest;
    return originalRenameSync(src, dest);
  };
  let commit;
  try {
    ({ commit } = drainCursorBridgeHandoverUpdatesDurable(opDir));
  } finally {
    fs.renameSync = originalRenameSync;
  }
  assert.ok(capturedDrainingPath, 'renameSync should have been called with the draining path');
  const base = cursorBridgeHandoverQueuePath(opDir);
  const suffix = capturedDrainingPath.slice(`${base}.draining-`.length);
  const firstField = suffix.split('-')[0];
  // A millisecond epoch stamp is ~1.7e12 right now; a pid is a small
  // integer, nowhere near Date.now() - if leftoverDrainingFiles ever sorted
  // on this field expecting it to be the pid instead, this would catch it.
  assert.ok(/^\d{13}$/.test(firstField), `expected the first field to be a 13-digit millisecond timestamp, got "${firstField}"`);
  assert.ok(
    Math.abs(Date.now() - Number(firstField)) < 10_000,
    `expected the first field to be close to Date.now(), got "${firstField}" vs now ${Date.now()}`
  );
  commit();
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

test('handover queue (durable drain): recovery order comes from sorting the names, not from whatever order readdirSync happens to hand back', () => {
  // On this host (and most Linux filesystems) readdirSync already returns
  // directory entries in creation/alphabetical order, so writing the two
  // leftover files in either order on real disk cannot tell a dropped
  // `.sort()` apart from a kept one - the fixture would already be sorted
  // before the code ever touched it (the "a fixture that already satisfies
  // the property under test" trap). Mock readdirSync to hand back the
  // SAME two names in the WRONG (reverse-chronological) order regardless of
  // what is really on disk, so only the code's own `.sort()` can put them
  // right.
  const opDir = tmpOpDir();
  const base = cursorBridgeHandoverQueuePath(opDir);
  const earlierName = 'cursor-bridge-handover.jsonl.draining-1700000000000-99999-aaa';
  const laterName = 'cursor-bridge-handover.jsonl.draining-1700000000500-5-bbb';
  fs.writeFileSync(path.join(opDir, earlierName), `${JSON.stringify({ update_id: 1 })}\n`);
  fs.writeFileSync(path.join(opDir, laterName), `${JSON.stringify({ update_id: 2 })}\n`);
  const originalReaddirSync = fs.readdirSync;
  fs.readdirSync = (dir, ...rest) => {
    const real = originalReaddirSync(dir, ...rest);
    if (dir === opDir || dir === path.dirname(base)) {
      return [laterName, earlierName, ...real.filter((n) => n !== laterName && n !== earlierName)];
    }
    return real;
  };
  let result;
  try {
    result = drainCursorBridgeHandoverUpdatesDurable(opDir);
  } finally {
    fs.readdirSync = originalReaddirSync;
  }
  assert.deepEqual(
    result.updates.map((u) => u.update_id),
    [1, 2],
    'recovery must follow the sorted (chronological) name order, not the order readdirSync happened to return'
  );
  result.commit();
});

test('handover queue (durable drain): a leftover file that vanishes/becomes unreadable between listing and reading is skipped, not thrown - its siblings still recover', () => {
  // leftoverDrainingFiles lists a name, then readAndParseDrainingFile reads
  // it separately - a TOCTOU window (another process's own commit() racing
  // in, a permission change) can make the read fail even though the listing
  // just saw the file. No fixture reaches this via real disk races
  // reliably, so mock fs.readFileSync to fail for exactly one of two
  // leftover files and confirm the other still recovers and nothing throws.
  const opDir = tmpOpDir();
  const base = cursorBridgeHandoverQueuePath(opDir);
  const unreadableName = `${base}.draining-1700000000000-99999-aaa`;
  const readableName = `${base}.draining-1700000000500-5-bbb`;
  fs.writeFileSync(unreadableName, `${JSON.stringify({ update_id: 1 })}\n`);
  fs.writeFileSync(readableName, `${JSON.stringify({ update_id: 2 })}\n`);
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = (p, ...rest) => {
    if (p === unreadableName) {
      throw new Error('simulated: vanished or unreadable between listing and reading');
    }
    return originalReadFileSync(p, ...rest);
  };
  let result;
  try {
    result = drainCursorBridgeHandoverUpdatesDurable(opDir);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
  assert.deepEqual(
    result.updates.map((u) => u.update_id),
    [2],
    'the unreadable leftover contributes no entries, but its readable sibling must still recover'
  );
  assert.doesNotThrow(() => result.commit(), 'commit() must still best-effort-unlink every pending path, including the one that never read');
});

test('handover queue (durable drain): leftover files from different process incarnations (pids) recover in chronological order, not pid order', () => {
  // Two prior crashed incarnations left draining files behind - a lower
  // pid that crashed SECOND (later timestamp) and a higher pid that
  // crashed FIRST (earlier timestamp). A sort keyed on pid-then-timestamp
  // would recover the lower-pid file first regardless of which actually
  // drained its entries earlier; this pins recovery to timestamp order.
  const opDir = tmpOpDir();
  const base = cursorBridgeHandoverQueuePath(opDir);
  fs.mkdirSync(path.dirname(base), { recursive: true });
  fs.writeFileSync(`${base}.draining-1700000000000-99999-aaa`, `${JSON.stringify({ update_id: 1 })}\n`);
  fs.writeFileSync(`${base}.draining-1700000000500-5-bbb`, `${JSON.stringify({ update_id: 2 })}\n`);
  const { updates, commit } = drainCursorBridgeHandoverUpdatesDurable(opDir);
  assert.deepEqual(
    updates.map((u) => u.update_id),
    [1, 2],
    'the earlier-timestamped leftover (update_id 1) must recover before the later one, whatever pid each name embeds'
  );
  commit();
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

test('handover queue (durable drain): a wholly missing operator directory (never created, not merely empty) is the same no-op, not a throw', () => {
  // tmpOpDir() above pre-creates its directory via mkTmpDir, so every prior
  // "missing queue" test only ever exercises a missing FILE inside an
  // existing directory. leftoverDrainingFiles's own readdirSync(dir) call
  // needs the directory itself absent to reach its catch branch (a fresh
  // operator root before anything has ever appended to it).
  const missingDir = path.join(tmpOpDir(), 'never-created');
  assert.equal(fs.existsSync(missingDir), false);
  const { updates, commit } = drainCursorBridgeHandoverUpdatesDurable(missingDir);
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
