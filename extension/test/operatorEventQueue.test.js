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
  assert.deepEqual(result.entries, [{ threadId: 'SUP-1', text: 'ok' }]);
});
