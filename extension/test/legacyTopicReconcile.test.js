const assert = require('node:assert/strict');
const { isLegacyPerTicketTopicKey, selectLegacyPerTicketTopics } = require('../out/concierge/legacyTopicReconcile');

// BL-494: the migration slice's pure "which map keys are legacy per-ticket
// topics" selection - a POSITIVE allowlist (BL-### shaped), never a blanket
// "everything except a known exclusion list", so it never needs to
// enumerate every epic id or standing key that might exist.

test('isLegacyPerTicketTopicKey: matches a plain BL-### ticket id', () => {
  assert.equal(isLegacyPerTicketTopicKey('BL-123'), true);
  assert.equal(isLegacyPerTicketTopicKey('BL-1'), true);
});

test('isLegacyPerTicketTopicKey: rejects an epic id (free-text slug, separate namespace)', () => {
  assert.equal(isLegacyPerTicketTopicKey('topic-consolidation'), false);
});

test('isLegacyPerTicketTopicKey: rejects the reserved BACKLOG key', () => {
  assert.equal(isLegacyPerTicketTopicKey('BACKLOG'), false);
});

test('isLegacyPerTicketTopicKey: rejects a GH-seeded ticket id (out of this migration\'s scope)', () => {
  assert.equal(isLegacyPerTicketTopicKey('GH-42'), false);
});

test('isLegacyPerTicketTopicKey: rejects a non-numeric suffix', () => {
  assert.equal(isLegacyPerTicketTopicKey('BL-abc'), false);
});

test('selectLegacyPerTicketTopics: selects only BL-### entries out of a mixed map', () => {
  const topicMap = { 'BL-1': 101, 'topic-consolidation': 500, BACKLOG: 600, 'BL-2': 102 };
  assert.deepEqual(selectLegacyPerTicketTopics(topicMap), [
    { backlogId: 'BL-1', topicId: 101 },
    { backlogId: 'BL-2', topicId: 102 },
  ]);
});

test('selectLegacyPerTicketTopics: returns an empty array for an empty map', () => {
  assert.deepEqual(selectLegacyPerTicketTopics({}), []);
});

test('selectLegacyPerTicketTopics: returns an empty array when the map has no per-ticket keys at all', () => {
  assert.deepEqual(selectLegacyPerTicketTopics({ 'topic-consolidation': 500, BACKLOG: 600 }), []);
});
