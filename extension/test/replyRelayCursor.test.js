const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readPersistedCursor, writePersistedCursor, advanceCursorOnAck } = require('../out/bridge/replyRelayCursor');

// BL-320: the ack-driven, persisted cursor that replaces bridgeServer.ts's
// old in-memory, advance-on-emit cursor - readPersistedCursor/
// writePersistedCursor own durability across a bridge restart,
// advanceCursorOnAck owns the pure "does this ack actually confirm the
// next unacked entry" decision.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-reply-relay-cursor-'));
}

test('readPersistedCursor defaults to ackedIndex 0 when no cursor file exists yet', () => {
  const targetPath = mkTmp();
  assert.deepEqual(readPersistedCursor(targetPath), { ackedIndex: 0 });
});

test('readPersistedCursor defaults to ackedIndex 0 on a corrupt/non-JSON cursor file', () => {
  const targetPath = mkTmp();
  const dir = path.join(targetPath, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'telegram-reply-relay-cursor.json'), 'not valid json');
  assert.deepEqual(readPersistedCursor(targetPath), { ackedIndex: 0 });
});

test('readPersistedCursor defaults to ackedIndex 0 on a negative/non-integer ackedIndex', () => {
  const targetPath = mkTmp();
  const dir = path.join(targetPath, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'telegram-reply-relay-cursor.json'), JSON.stringify({ ackedIndex: -1 }));
  assert.deepEqual(readPersistedCursor(targetPath), { ackedIndex: 0 });
});

test('writePersistedCursor then readPersistedCursor round-trips the exact state', () => {
  const targetPath = mkTmp();
  writePersistedCursor(targetPath, { ackedIndex: 7 });
  assert.deepEqual(readPersistedCursor(targetPath), { ackedIndex: 7 });
});

test('writePersistedCursor overwrites a prior value rather than accumulating', () => {
  const targetPath = mkTmp();
  writePersistedCursor(targetPath, { ackedIndex: 3 });
  writePersistedCursor(targetPath, { ackedIndex: 9 });
  assert.deepEqual(readPersistedCursor(targetPath), { ackedIndex: 9 });
});

test('advanceCursorOnAck advances by one when the ack matches the entry at the cursor', () => {
  const unacked = [{ id: 'reply-1', threadId: 'SUP-1', text: 'hi' }];
  assert.equal(advanceCursorOnAck(4, 'reply-1', unacked), 5);
});

test('advanceCursorOnAck leaves the cursor unchanged when the ack does not match the entry at the cursor', () => {
  const unacked = [{ id: 'reply-1', threadId: 'SUP-1', text: 'hi' }];
  assert.equal(advanceCursorOnAck(4, 'some-other-id', unacked), 4);
});

test('advanceCursorOnAck leaves the cursor unchanged when there is no unacked entry at all (a stale/duplicate ack)', () => {
  assert.equal(advanceCursorOnAck(4, 'reply-1', []), 4);
});
