/**
 * BL-136: tracer-bullet-launcher — unit tests for the pure seed-draft
 * builder. The actual send (sendSeedNote) shells out to swarm_handoff.sh and
 * is not unit tested here — see the testable-module boundary in the shared
 * engineering rules; this pure builder is the piece worth locking down.
 */
const assert = require('node:assert/strict');
const { buildSeedDraft } = require('../out/tools/tracer-bullet-launcher');

test('buildSeedDraft addresses the coordinator', () => {
  const draft = buildSeedDraft('trace-20260706T080349z');
  assert.match(draft, /^type: note\n/);
  assert.match(draft, /\nto: coordinator\n/);
});

test('buildSeedDraft priority is 00 (highest)', () => {
  const draft = buildSeedDraft('trace-20260706T080349z');
  assert.match(draft, /\npriority: 00\n/);
});

test('buildSeedDraft message carries the TRACE <id> prefix the role prompts recognize', () => {
  const draft = buildSeedDraft('trace-20260706T080349z');
  assert.match(draft, /\nmessage: TRACE trace-20260706T080349z\n$/);
});

test('buildSeedDraft message stays within the note protocol\'s 80-char limit', () => {
  const draft = buildSeedDraft('trace-20260706T080349z-12');
  const messageLine = draft.split('\n').find((l) => l.startsWith('message: '));
  const value = messageLine.slice('message: '.length);
  assert.ok(value.length <= 80, `message "${value}" (${value.length} chars) exceeds the 80-char limit`);
});
