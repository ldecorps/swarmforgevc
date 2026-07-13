const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readRecord, appendMessage, recordPath } = require('../out/concierge/blTopicStore');

// BL-329: the durable, git-tracked, per-ticket record of every message sent
// in a BL topic - inbound and outbound - so the Telegram topic becomes a
// disposable PROJECTION of state held in the repo rather than the source of
// truth itself. Mirrors support_thread_store.bb's own shape (one JSON
// record per id, atomic whole-file write via tmp+rename) but lives OUTSIDE
// .swarmforge/ (gitignored, lost on a fresh checkout) - under backlog/
// topics/, alongside the ticket itself.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl-topic-store-'));
}

test('readRecord returns an empty record for a ticket with no messages yet', () => {
  const targetPath = mkTmp();
  assert.deepEqual(readRecord(targetPath, 'BL-900'), { id: 'BL-900', messages: [] });
});

test('appendMessage then readRecord round-trips the exact message', () => {
  const targetPath = mkTmp();
  appendMessage(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'hello', ts: 1000 });
  assert.deepEqual(readRecord(targetPath, 'BL-900'), {
    id: 'BL-900',
    messages: [{ seq: 0, ts: 1000, author: 'human', type: 'inbound', text: 'hello' }],
  });
});

test('appendMessage carries order, timestamp, author and text for both directions (BL-329 serialise-topic-01)', () => {
  const targetPath = mkTmp();
  appendMessage(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'a question', ts: 1000 });
  appendMessage(targetPath, 'BL-900', { author: 'coder', type: 'outbound', text: 'an answer', ts: 2000 });
  const record = readRecord(targetPath, 'BL-900');
  assert.equal(record.messages.length, 2);
  assert.deepEqual(record.messages[0], { seq: 0, ts: 1000, author: 'human', type: 'inbound', text: 'a question' });
  assert.deepEqual(record.messages[1], { seq: 1, ts: 2000, author: 'coder', type: 'outbound', text: 'an answer' });
});

test('appendMessage assigns a monotonically increasing seq regardless of call order across directions', () => {
  const targetPath = mkTmp();
  appendMessage(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: '1', ts: 1 });
  appendMessage(targetPath, 'BL-900', { author: 'coder', type: 'outbound', text: '2', ts: 2 });
  appendMessage(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: '3', ts: 3 });
  const seqs = readRecord(targetPath, 'BL-900').messages.map((m) => m.seq);
  assert.deepEqual(seqs, [0, 1, 2]);
});

test('the record lives in the repository, keyed by ticket, not under .swarmforge/ (BL-329 serialise-topic-02)', () => {
  const targetPath = mkTmp();
  appendMessage(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 });
  const p = recordPath(targetPath, 'BL-900');
  assert.ok(p.includes(`${path.sep}backlog${path.sep}topics${path.sep}`), `expected the record under backlog/topics/, got ${p}`);
  assert.ok(!p.includes('.swarmforge'), `expected the record OUTSIDE the gitignored .swarmforge/ tree, got ${p}`);
  assert.ok(fs.existsSync(p), 'expected the record file to actually exist on disk');
});

test('a ticket record contains only that ticket\'s own messages, never another ticket\'s (BL-329 serialise-topic-02)', () => {
  const targetPath = mkTmp();
  appendMessage(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'for 900', ts: 1 });
  appendMessage(targetPath, 'BL-901', { author: 'human', type: 'inbound', text: 'for 901', ts: 2 });
  assert.deepEqual(
    readRecord(targetPath, 'BL-900').messages.map((m) => m.text),
    ['for 900']
  );
  assert.deepEqual(
    readRecord(targetPath, 'BL-901').messages.map((m) => m.text),
    ['for 901']
  );
});

test('the record preserves the order messages were sent in, even out of alphabetical/random text order (BL-329 serialise-topic-03)', () => {
  const targetPath = mkTmp();
  appendMessage(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'third-ish text but sent first', ts: 1 });
  appendMessage(targetPath, 'BL-900', { author: 'coder', type: 'outbound', text: 'aaa sent second', ts: 2 });
  appendMessage(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'zzz sent third', ts: 3 });
  assert.deepEqual(
    readRecord(targetPath, 'BL-900').messages.map((m) => m.text),
    ['third-ish text but sent first', 'aaa sent second', 'zzz sent third']
  );
});

test('the record survives a restart of the writing process - a fresh read after append sees every prior message (BL-329 serialise-topic-04)', () => {
  const targetPath = mkTmp();
  appendMessage(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'before restart', ts: 1 });
  // Simulate a process restart: nothing but the filesystem carries state
  // forward - re-reading from a fresh call must see what was written.
  const afterRestart = readRecord(targetPath, 'BL-900');
  assert.deepEqual(afterRestart.messages.map((m) => m.text), ['before restart']);
  appendMessage(targetPath, 'BL-900', { author: 'coder', type: 'outbound', text: 'after restart', ts: 2 });
  assert.deepEqual(readRecord(targetPath, 'BL-900').messages.map((m) => m.text), ['before restart', 'after restart']);
});

test('readRecord tolerates a missing backlog/topics directory entirely (never crashes on a fresh checkout)', () => {
  const targetPath = mkTmp();
  assert.doesNotThrow(() => readRecord(targetPath, 'BL-999'));
});
