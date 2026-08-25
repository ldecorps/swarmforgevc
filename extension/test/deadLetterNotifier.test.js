const assert = require('node:assert/strict');
const { decideDeadLetterAnnouncement, buildDeadLetterAnnouncementText } = require('../out/notify/deadLetterNotifier');

// ── decideDeadLetterAnnouncement (BL-353) ─────────────────────────────────

test('BL-353: a brand new dead letter is announced and remembered', () => {
  const decision = decideDeadLetterAnnouncement(['/a/coder.handoff.dead'], []);
  assert.equal(decision.shouldAnnounce, true);
  assert.deepEqual(decision.nextAnnouncedIds, ['/a/coder.handoff.dead']);
});

test('BL-353: an already-announced dead letter is never re-announced (no spam)', () => {
  const decision = decideDeadLetterAnnouncement(['/a/coder.handoff.dead'], ['/a/coder.handoff.dead']);
  assert.equal(decision.shouldAnnounce, false);
  assert.deepEqual(decision.nextAnnouncedIds, ['/a/coder.handoff.dead']);
});

test('BL-353: a SECOND, genuinely new dead letter alongside an already-announced one is announced again', () => {
  const decision = decideDeadLetterAnnouncement(['/a/coder.handoff.dead', '/b/cleaner.handoff.dead'], ['/a/coder.handoff.dead']);
  assert.equal(decision.shouldAnnounce, true);
  assert.deepEqual(decision.nextAnnouncedIds, ['/a/coder.handoff.dead', '/b/cleaner.handoff.dead']);
});

test('BL-353: no dead letters at all never announces', () => {
  const decision = decideDeadLetterAnnouncement([], []);
  assert.equal(decision.shouldAnnounce, false);
  assert.deepEqual(decision.nextAnnouncedIds, []);
});

test('BL-353: the announced set only ever GROWS - a dead letter never disappears from it once added', () => {
  // Unlike recert batches, a dead-lettered file does not automatically
  // "un-dead-letter" itself - nextAnnouncedIds is always a superset of
  // alreadyAnnouncedFilePaths, even when currentFilePaths temporarily
  // shrinks (e.g. a human manually cleared one out).
  const decision = decideDeadLetterAnnouncement([], ['/a/coder.handoff.dead']);
  assert.deepEqual(decision.nextAnnouncedIds, ['/a/coder.handoff.dead']);
});

// ── buildDeadLetterAnnouncementText ───────────────────────────────────────

test('BL-353: the text names the role and task for a single dead letter, singular phrasing', () => {
  const text = buildDeadLetterAnnouncementText([{ role: 'coder', filePath: '/x/00_a.handoff.dead', task: 'BL-900-demo', chaseCount: 3 }]);
  assert.match(text, /1 dead-lettered item/);
  assert.match(text, /coder: BL-900-demo \(00_a\.handoff\.dead\)/);
});

test('BL-353: multiple new dead letters in one sweep produce ONE message listing all of them', () => {
  const text = buildDeadLetterAnnouncementText([
    { role: 'coder', filePath: '/x/a.handoff.dead', task: 'task-a', chaseCount: 3 },
    { role: 'cleaner', filePath: '/y/b.handoff.dead', task: 'task-b', chaseCount: 3 },
  ]);
  assert.match(text, /2 dead-lettered items/);
  assert.match(text, /coder: task-a/);
  assert.match(text, /cleaner: task-b/);
  assert.equal(text.split('\n').length, 3, 'expected one header line + one line per dead letter, never a message per dead letter');
});

test('a dead letter with no task falls back to its handoff type', () => {
  const text = buildDeadLetterAnnouncementText([{ role: 'coder', filePath: '/x/a.handoff.dead', type: 'note', chaseCount: 3 }]);
  assert.match(text, /coder: note/);
});
