const assert = require('node:assert/strict');
const { isCompletionText, recordMissingOpener, regeneratedOpenerText, withRestoredOpener } = require('../out/concierge/topicRecordRepair');

// BL-348: a record whose very first message IS its completion summary was
// found for two real tickets (BL-329, BL-330) - the opener was never
// recorded before it. These tests pin the pure detection/regeneration
// logic; the CLI itself (repairBlTopicRecordsCli.test.js) covers the
// filesystem/backlog cross-reference and commit.

test('isCompletionText matches the exact completionSummaryText format', () => {
  const backlogId = 'BL-900';
  const title = 'Some ticket title';
  assert.equal(isCompletionText('BL-900 - Some ticket title is complete.', backlogId, title), true);
});

test('isCompletionText rejects an ordinary message', () => {
  assert.equal(isCompletionText('just a normal update', 'BL-900', 'Some ticket title'), false);
});

test('recordMissingOpener is true when the first (and only) message is the completion summary', () => {
  const record = {
    id: 'BL-329',
    messages: [{ seq: 0, ts: 1000, author: 'swarm', type: 'outbound', text: 'BL-329 - Serialise topic content is complete.' }],
  };
  assert.equal(recordMissingOpener(record, 'Serialise topic content'), true);
});

test('recordMissingOpener is false when a real opener already precedes the completion', () => {
  const record = {
    id: 'BL-335',
    messages: [
      { seq: 0, ts: 1000, author: 'swarm', type: 'outbound', text: 'What it is: Three features shipped' },
      { seq: 1, ts: 2000, author: 'swarm', type: 'outbound', text: 'BL-335 - Three features shipped is complete.' },
    ],
  };
  assert.equal(recordMissingOpener(record, 'Three features shipped'), false);
});

test('recordMissingOpener is false for a record with no messages at all', () => {
  assert.equal(recordMissingOpener({ id: 'BL-900', messages: [] }, 'anything'), false);
});

test('regeneratedOpenerText reuses topicRouter\'s own TaskStarted formatting (What it is / What it solves / How it works)', () => {
  const text = regeneratedOpenerText({
    id: 'BL-900',
    title: 'Fix the thing',
    notes: 'This is why it matters.\n\nMore detail below.',
    firstAcceptanceStep: 'Given a broken thing',
  });
  assert.match(text, /^What it is: Fix the thing/);
  assert.match(text, /What it solves: This is why it matters\./);
  assert.match(text, /How it works: Given a broken thing/);
});

test('regeneratedOpenerText degrades to a title-only line when notes/firstAcceptanceStep are absent', () => {
  const text = regeneratedOpenerText({ id: 'BL-900', title: 'Bare ticket' });
  assert.equal(text, 'What it is: Bare ticket');
});

test('withRestoredOpener inserts the opener before the completion, renumbering seq, without mutating the input', () => {
  const record = {
    id: 'BL-329',
    messages: [{ seq: 0, ts: 1000, author: 'swarm', type: 'outbound', text: 'BL-329 - x is complete.' }],
  };
  const repaired = withRestoredOpener(record, 'What it is: x');
  assert.deepEqual(record.messages.length, 1, 'the input record must be left untouched');
  assert.equal(repaired.messages.length, 2);
  assert.deepEqual(repaired.messages[0], { seq: 0, ts: 999, author: 'swarm', type: 'outbound', text: 'What it is: x' });
  assert.deepEqual(repaired.messages[1], { seq: 1, ts: 1000, author: 'swarm', type: 'outbound', text: 'BL-329 - x is complete.' });
});

test('withRestoredOpener keeps the opener strictly before the completion in timestamp order', () => {
  const record = { id: 'BL-329', messages: [{ seq: 0, ts: 1000, author: 'swarm', type: 'outbound', text: 'complete.' }] };
  const repaired = withRestoredOpener(record, 'opener text');
  assert.ok(repaired.messages[0].ts < repaired.messages[1].ts);
});
