const assert = require('node:assert/strict');
const test = require('node:test');

const { formatDeadLetterListing } = require('../out/tools/list-dead-letters');

// BL-109 dead-letter-visible-03: the presenter for listDeadLetters -
// resolveProjectRoot/roles.tsv wiring is exercised by swarm-metrics.ts's own
// tests (same helper, reused here); this file covers only the pure
// formatting this tool adds.

test('formatDeadLetterListing reports when there are no dead letters', () => {
  assert.equal(formatDeadLetterListing([]), 'No dead-lettered handoffs.');
});

test('formatDeadLetterListing prints role, filename, sender, type, task, and chase count', () => {
  const text = formatDeadLetterListing([
    {
      role: 'coordinator',
      filePath: '/repo/.swarmforge/handoffs/inbox/new/00_x_from_specifier_to_coordinator.handoff.dead',
      from: 'specifier',
      recipient: 'coordinator',
      type: 'note',
      task: undefined,
      chaseCount: 3,
    },
  ]);
  assert.match(text, /\[coordinator\]/);
  assert.match(text, /00_x_from_specifier_to_coordinator\.handoff\.dead/);
  assert.match(text, /from=specifier/);
  assert.match(text, /type=note/);
  assert.match(text, /chases=3/);
});

test('formatDeadLetterListing includes the task when present, omits it when absent', () => {
  const withTask = formatDeadLetterListing([
    { role: 'coder', filePath: '/a.handoff.dead', from: 'specifier', recipient: 'coder', type: 'git_handoff', task: 'BL-109', chaseCount: 1 },
  ]);
  assert.match(withTask, /task=BL-109/);

  const withoutTask = formatDeadLetterListing([
    { role: 'coder', filePath: '/a.handoff.dead', from: 'specifier', recipient: 'coder', type: 'note', task: undefined, chaseCount: 1 },
  ]);
  assert.doesNotMatch(withoutTask, /task=/);
});

test('formatDeadLetterListing falls back to "unknown" for a missing from/type header', () => {
  const text = formatDeadLetterListing([
    { role: 'coder', filePath: '/a.handoff.dead', from: undefined, recipient: 'coder', type: undefined, task: undefined, chaseCount: 0 },
  ]);
  assert.match(text, /from=unknown/);
  assert.match(text, /type=unknown/);
});

test('formatDeadLetterListing lists one line per dead letter, in the given order', () => {
  const text = formatDeadLetterListing([
    { role: 'coder', filePath: '/a.handoff.dead', from: 'specifier', recipient: 'coder', type: 'note', task: undefined, chaseCount: 0 },
    { role: 'cleaner', filePath: '/b.handoff.dead', from: 'coder', recipient: 'cleaner', type: 'git_handoff', task: 'BL-1', chaseCount: 2 },
  ]);
  const lines = text.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /\[coder\]/);
  assert.match(lines[1], /\[cleaner\]/);
});
