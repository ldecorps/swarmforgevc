const assert = require('node:assert/strict');
const { classifyRecertTopicReply } = require('../out/concierge/recertTopicReply');

// BL-450: the standing Recert topic's own reply grammar - id-bound, since
// scenarios are recertified one at a time but a reply must still name which
// one it acts on (sibling of pendingApprovalReply.ts's classifyApprovalsTopicReply).

test('BL-450: "validate <id>" is classified as validate for that exact scenario id', () => {
  assert.deepEqual(classifyRecertTopicReply('validate BL-207-thing-01'), { kind: 'validate', scenarioId: 'BL-207-thing-01' });
});

test('BL-450: "amend <id> <new text>" is classified as amend, capturing the new text', () => {
  assert.deepEqual(classifyRecertTopicReply('amend BL-207-thing-01 Given a new precondition'), {
    kind: 'amend',
    scenarioId: 'BL-207-thing-01',
    newText: 'Given a new precondition',
  });
});

test('BL-450: "delete <id>" is classified as delete for that exact scenario id', () => {
  assert.deepEqual(classifyRecertTopicReply('delete BL-207-thing-01'), { kind: 'delete', scenarioId: 'BL-207-thing-01' });
});

test('BL-450: a bare "confirm" is classified as confirm-delete', () => {
  assert.deepEqual(classifyRecertTopicReply('confirm'), { kind: 'confirm-delete' });
  assert.deepEqual(classifyRecertTopicReply('  Confirm  '), { kind: 'confirm-delete' });
});

test('BL-450: an ordinary reply naming no recognized verb classifies as none', () => {
  assert.deepEqual(classifyRecertTopicReply('looks fine to me'), { kind: 'none' });
  assert.deepEqual(classifyRecertTopicReply(''), { kind: 'none' });
});

test('BL-450: a bare "validate" with no id classifies as none - the Recert topic grammar requires an id', () => {
  assert.deepEqual(classifyRecertTopicReply('validate'), { kind: 'none' });
});

test('BL-450: a bare "delete" with no id classifies as none', () => {
  assert.deepEqual(classifyRecertTopicReply('delete'), { kind: 'none' });
});

test('BL-450: "amend <id>" with no new text classifies as none - amend requires the replacement text', () => {
  assert.deepEqual(classifyRecertTopicReply('amend BL-207-thing-01'), { kind: 'none' });
});

test('BL-450: validate wins over a "delete"/"amend" substring appearing inside its own scenario id (regression guard)', () => {
  assert.deepEqual(classifyRecertTopicReply('validate BL-900/delete-handler-01'), {
    kind: 'validate',
    scenarioId: 'BL-900/delete-handler-01',
  });
});
