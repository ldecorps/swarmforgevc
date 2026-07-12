const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appendOperatorEvent, readNewReplyOutboxEntries } = require('../out/bridge/operatorEventQueue');

// BL-281: the bridge's hand-off files into/out-of the Operator runtime
// (Babashka) - events.jsonl (bridge writes, runtime reads) and the reply
// outbox (runtime/disposable-LLM writes via operator_reply.bb, bridge
// reads for SSE relay). Newline-delimited JSON, matching operator_
// runtime.bb's own append-event!/read-events shape exactly.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-operator-event-queue-'));
}

test('appendOperatorEvent writes one JSON line to events.jsonl, matching operator_runtime.bb\'s own read-events format', () => {
  const targetPath = mkTmp();
  appendOperatorEvent(targetPath, { type: 'TELEGRAM_TOPIC_MESSAGE', subject: 'SUP-1' });
  const file = path.join(targetPath, '.swarmforge', 'operator', 'events.jsonl');
  const content = fs.readFileSync(file, 'utf8');
  assert.equal(content, '{"type":"TELEGRAM_TOPIC_MESSAGE","subject":"SUP-1"}\n');
});

test('appendOperatorEvent appends (never overwrites) across multiple calls', () => {
  const targetPath = mkTmp();
  appendOperatorEvent(targetPath, { type: 'TELEGRAM_TOPIC_MESSAGE', subject: 'SUP-1' });
  appendOperatorEvent(targetPath, { type: 'TELEGRAM_TOPIC_MESSAGE', subject: 'SUP-2' });
  const file = path.join(targetPath, '.swarmforge', 'operator', 'events.jsonl');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /SUP-1/);
  assert.match(lines[1], /SUP-2/);
});

test('readNewReplyOutboxEntries returns nothing (and totalLines unchanged) when the outbox file does not exist yet', () => {
  const targetPath = mkTmp();
  assert.deepEqual(readNewReplyOutboxEntries(targetPath, 0), { entries: [], totalLines: 0 });
});

function writeOutbox(targetPath, entries) {
  const dir = path.join(targetPath, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'telegram-reply-outbox.jsonl'), entries.map((e) => JSON.stringify(e) + '\n').join(''));
}

test('readNewReplyOutboxEntries returns only entries AFTER sinceIndex', () => {
  const targetPath = mkTmp();
  writeOutbox(targetPath, [
    { threadId: 'SUP-1', text: 'first reply' },
    { threadId: 'SUP-2', text: 'second reply' },
  ]);
  const first = readNewReplyOutboxEntries(targetPath, 0);
  assert.equal(first.entries.length, 2);
  assert.equal(first.totalLines, 2);

  const nextPoll = readNewReplyOutboxEntries(targetPath, first.totalLines);
  assert.deepEqual(nextPoll.entries, []);
});

test('readNewReplyOutboxEntries skips a malformed line rather than crashing the whole poll', () => {
  const targetPath = mkTmp();
  const dir = path.join(targetPath, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'telegram-reply-outbox.jsonl'),
    'not valid json\n' + JSON.stringify({ threadId: 'SUP-1', text: 'ok' }) + '\n'
  );
  const result = readNewReplyOutboxEntries(targetPath, 0);
  assert.deepEqual(result.entries, [{ id: 'legacy-1', threadId: 'SUP-1', text: 'ok' }]);
});

// BL-320: an outbox line written by operator_reply.bb going forward carries
// its own idempotency key - that value must ride through verbatim, never
// overwritten by the legacy-position fallback.
test('readNewReplyOutboxEntries passes through an entry\'s own id field verbatim', () => {
  const targetPath = mkTmp();
  writeOutbox(targetPath, [{ id: 'reply-abc123', threadId: 'SUP-1', text: 'hi' }]);
  const result = readNewReplyOutboxEntries(targetPath, 0);
  assert.deepEqual(result.entries, [{ id: 'reply-abc123', threadId: 'SUP-1', text: 'hi' }]);
});

// BL-320: a line written before this ticket has no id field at all - it
// must still round-trip as a usable entry (never dropped like a malformed
// line), with a synthesized id stable across re-reads of the same
// append-only file (derived from its own absolute line position, so a
// later poll starting from a later sinceIndex still reconstructs the same
// id for the same physical line).
test('readNewReplyOutboxEntries synthesizes a stable id for a pre-BL-320 entry with no id field', () => {
  const targetPath = mkTmp();
  writeOutbox(targetPath, [
    { threadId: 'SUP-1', text: 'first' },
    { threadId: 'SUP-2', text: 'second' },
  ]);
  const fromStart = readNewReplyOutboxEntries(targetPath, 0);
  assert.deepEqual(fromStart.entries, [
    { id: 'legacy-0', threadId: 'SUP-1', text: 'first' },
    { id: 'legacy-1', threadId: 'SUP-2', text: 'second' },
  ]);
  const fromSecond = readNewReplyOutboxEntries(targetPath, 1);
  assert.deepEqual(fromSecond.entries, [{ id: 'legacy-1', threadId: 'SUP-2', text: 'second' }]);
});
