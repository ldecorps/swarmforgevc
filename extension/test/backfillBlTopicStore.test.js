const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { backfillBlTopicStore, readBlTopicMessageEvents } = require('../out/tools/backfill-bl-topic-store');
const { readRecord, appendMessage: appendMessageRaw } = require('../out/concierge/blTopicStore');

// BL-329 serialise-topic-05: human messages already captured in
// .swarmforge/operator/events.jsonl (TELEGRAM_BL_TOPIC_MESSAGE records)
// before this feature shipped must be backfilled, not abandoned.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl-topic-backfill-'));
}

// BL-348: these fixtures are never real git repos, so appendMessage's (and
// backfillBlTopicStore's own, threaded-through) default loud-stderr
// commit-failure reporter would fire on every call here - none of that is
// what this file is testing, so it is silenced the same way
// blTopicStore.test.js's own non-git fixtures are.
const SILENT = () => {};
function appendMessage(targetPath, ticketId, message) {
  return appendMessageRaw(targetPath, ticketId, message, SILENT);
}
function backfill(targetPath) {
  return backfillBlTopicStore(targetPath, SILENT);
}

function writeEvents(targetPath, events) {
  const dir = path.join(targetPath, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e) + '\n').join(''));
}

test('readBlTopicMessageEvents returns [] when events.jsonl does not exist yet', () => {
  const targetPath = mkTmp();
  assert.deepEqual(readBlTopicMessageEvents(targetPath), []);
});

test('readBlTopicMessageEvents extracts only TELEGRAM_BL_TOPIC_MESSAGE records, ignoring every other event type', () => {
  const targetPath = mkTmp();
  writeEvents(targetPath, [
    { type: 'TELEGRAM_TOPIC_MESSAGE', subject: 'SUP-1' },
    { type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId: 'BL-900', text: 'a real human message' },
    { type: 'SOME_UNRELATED_EVENT', foo: 'bar' },
  ]);
  assert.deepEqual(readBlTopicMessageEvents(targetPath), [{ type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId: 'BL-900', text: 'a real human message' }]);
});

test('readBlTopicMessageEvents tolerates a corrupt line without crashing (skips it, keeps the rest)', () => {
  const targetPath = mkTmp();
  const dir = path.join(targetPath, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    'not valid json\n' + JSON.stringify({ type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId: 'BL-900', text: 'still imported' }) + '\n'
  );
  const events = readBlTopicMessageEvents(targetPath);
  assert.equal(events.length, 1);
  assert.equal(events[0].text, 'still imported');
});

test('BL-329 serialise-topic-05: a human message captured before this feature shipped is backfilled into that ticket\'s record', () => {
  const targetPath = mkTmp();
  writeEvents(targetPath, [{ type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId: 'BL-900', text: 'help, this is stuck' }]);
  const result = backfill(targetPath);
  assert.deepEqual(result, { imported: 1, skipped: 0 });
  const record = readRecord(targetPath, 'BL-900');
  assert.equal(record.messages.length, 1);
  assert.equal(record.messages[0].author, 'human');
  assert.equal(record.messages[0].type, 'inbound');
  assert.equal(record.messages[0].text, 'help, this is stuck');
});

test('backfill routes each event into its own ticket\'s record, never mixing tickets', () => {
  const targetPath = mkTmp();
  writeEvents(targetPath, [
    { type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId: 'BL-900', text: 'for 900' },
    { type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId: 'BL-901', text: 'for 901' },
  ]);
  backfill(targetPath);
  assert.deepEqual(readRecord(targetPath, 'BL-900').messages.map((m) => m.text), ['for 900']);
  assert.deepEqual(readRecord(targetPath, 'BL-901').messages.map((m) => m.text), ['for 901']);
});

test('backfill is idempotent - running it twice never duplicates an already-imported message', () => {
  const targetPath = mkTmp();
  writeEvents(targetPath, [{ type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId: 'BL-900', text: 'only once please' }]);
  const first = backfill(targetPath);
  const second = backfill(targetPath);
  assert.deepEqual(first, { imported: 1, skipped: 0 });
  assert.deepEqual(second, { imported: 0, skipped: 1 });
  assert.equal(readRecord(targetPath, 'BL-900').messages.length, 1);
});

test('backfill never duplicates a message the LIVE wiring already recorded before backfill ran', () => {
  const targetPath = mkTmp();
  // The live inbound path (postOperatorContext) already appended this via
  // appendMessage directly, exactly as telegram-front-desk-bot.ts does -
  // events.jsonl ALSO has it (appendOperatorEvent is a second, independent
  // writer for the same inbound message).
  appendMessage(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'already live-recorded' });
  writeEvents(targetPath, [{ type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId: 'BL-900', text: 'already live-recorded' }]);
  const result = backfill(targetPath);
  assert.deepEqual(result, { imported: 0, skipped: 1 });
  assert.equal(readRecord(targetPath, 'BL-900').messages.length, 1);
});

test('a genuinely distinct message for the same ticket is still imported alongside an already-present one', () => {
  const targetPath = mkTmp();
  appendMessage(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'first message' });
  writeEvents(targetPath, [
    { type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId: 'BL-900', text: 'first message' },
    { type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId: 'BL-900', text: 'second, distinct message' },
  ]);
  const result = backfill(targetPath);
  assert.deepEqual(result, { imported: 1, skipped: 1 });
  assert.deepEqual(readRecord(targetPath, 'BL-900').messages.map((m) => m.text), ['first message', 'second, distinct message']);
});
