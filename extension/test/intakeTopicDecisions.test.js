const assert = require('node:assert/strict');
const {
  decideEnsureIntakeTopicAction,
  decideIntakeTopicReply,
  INTAKE_SUBJECT_ID,
} = require('../out/tools/telegramTopicDecisions');

test('decideEnsureIntakeTopicAction reuses an existing topic', () => {
  const topicMap = { '42': INTAKE_SUBJECT_ID };
  assert.deepEqual(decideEnsureIntakeTopicAction(topicMap), { kind: 'reuse', topicId: 42 });
});

test('decideEnsureIntakeTopicAction creates when no topic is bound', () => {
  assert.deepEqual(decideEnsureIntakeTopicAction({}), { kind: 'create' });
});

test('decideIntakeTopicReply offers the way in when the form is reachable', () => {
  const reply = decideIntakeTopicReply('https://tunnel.example/intake-form?bearer=abc');
  assert.equal(reply.kind, 'way-in');
  assert.match(reply.text, /https:\/\/tunnel\.example\/intake-form\?bearer=abc/);
});

test('decideIntakeTopicReply says the form is unreachable when there is no URL', () => {
  const reply = decideIntakeTopicReply(undefined);
  assert.equal(reply.kind, 'unreachable');
  assert.match(reply.text, /unreachable/);
});
