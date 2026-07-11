const assert = require('node:assert/strict');
const {
  isFromPrincipal,
  topicIdOf,
  messageTextOf,
  subjectForTopic,
  topicForSubject,
  decideUpdateAction,
  pollAndForward,
} = require('../out/tools/telegramFrontDeskBotCore');

const PRINCIPAL_ID = 111;

function mkUpdate({ fromId, topicId, text } = {}) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: fromId }, message_thread_id: topicId, text } };
}

// ── isFromPrincipal / topicIdOf / messageTextOf (pure) ──────────────────

test('isFromPrincipal is true only for the configured principal id', () => {
  assert.equal(isFromPrincipal(mkUpdate({ fromId: PRINCIPAL_ID }), PRINCIPAL_ID), true);
  assert.equal(isFromPrincipal(mkUpdate({ fromId: 999 }), PRINCIPAL_ID), false);
});

test('topicIdOf/messageTextOf read message_thread_id/text', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'hi' });
  assert.equal(topicIdOf(update), 7);
  assert.equal(messageTextOf(update), 'hi');
});

// ── subjectForTopic / topicForSubject (pure) ─────────────────────────────

test('subjectForTopic resolves a mapped topic id to its subject', () => {
  assert.equal(subjectForTopic({ '7': 'SUP-1', '8': 'SUP-2' }, 7), 'SUP-1');
});

test('subjectForTopic returns undefined for an unmapped topic id (never a crash)', () => {
  assert.equal(subjectForTopic({ '7': 'SUP-1' }, 999), undefined);
  assert.equal(subjectForTopic({ '7': 'SUP-1' }, undefined), undefined);
});

test('BL-281 telegram-topic-03: topicForSubject resolves a SUP-### id back to ITS OWN topic, not another subject\'s', () => {
  const map = { '7': 'SUP-1', '8': 'SUP-2' };
  assert.equal(topicForSubject(map, 'SUP-1'), 7);
  assert.equal(topicForSubject(map, 'SUP-2'), 8);
});

test('topicForSubject returns undefined for a subject with no mapped topic', () => {
  assert.equal(topicForSubject({ '7': 'SUP-1' }, 'SUP-999'), undefined);
});

// ── decideUpdateAction (pure) — BL-281 telegram-topic-01/05 ──────────────

test('BL-281 telegram-topic-01: a principal message on a MAPPED topic posts to the bridge with the resolved subjectId', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'any update?' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, (topicId) => (topicId === 7 ? 'SUP-1' : undefined));
  assert.deepEqual(decision, { action: 'post', subjectId: 'SUP-1', text: 'any update?' });
});

test('BL-281 telegram-topic-05: a non-principal message is dropped, never posted', () => {
  const update = mkUpdate({ fromId: 999, topicId: 7, text: 'let me in' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, () => 'SUP-1');
  assert.deepEqual(decision, { action: 'drop', reason: 'not-principal' });
});

test('a principal message on an UNMAPPED topic is dropped (opening a subject is out of scope here)', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 999, text: 'new subject' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, () => undefined);
  assert.deepEqual(decision, { action: 'drop', reason: 'unmapped-topic' });
});

test('a textless update (e.g. a sticker/photo) is dropped, never posted with undefined text', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7 });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, () => 'SUP-1');
  assert.deepEqual(decision, { action: 'drop', reason: 'no-text' });
});

// ── pollAndForward (adapter-injected) ────────────────────────────────────

test('pollAndForward posts each accepted update and counts posted/dropped', async () => {
  const posted = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    getUpdates: async () => ({
      success: true,
      updates: [
        mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'accepted' }),
        mkUpdate({ fromId: 999, topicId: 7, text: 'rejected - not principal' }),
      ],
    }),
    postToBridge: async (subjectId, text) => {
      posted.push({ subjectId, text });
      return true;
    },
    subjectForTopic: (topicId) => (topicId === 7 ? 'SUP-1' : undefined),
    nextOffset: (updates, current) => current + updates.length,
  });

  assert.deepEqual(posted, [{ subjectId: 'SUP-1', text: 'accepted' }]);
  assert.equal(result.posted, 1);
  assert.equal(result.dropped, 1);
  assert.equal(result.nextOffset, 2);
});

test('pollAndForward leaves the offset unchanged when the poll itself fails', async () => {
  const result = await pollAndForward(5, PRINCIPAL_ID, {
    getUpdates: async () => ({ success: false, updates: [], error: 'network error' }),
    postToBridge: async () => true,
    subjectForTopic: () => undefined,
    nextOffset: (_updates, current) => current + 1,
  });
  assert.equal(result.nextOffset, 5);
  assert.equal(result.posted, 0);
});

test('pollAndForward counts a failed bridge POST as dropped, not posted', async () => {
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'hi' })] }),
    postToBridge: async () => false,
    subjectForTopic: () => 'SUP-1',
    nextOffset: (updates, current) => current + updates.length,
  });
  assert.equal(result.posted, 0);
  assert.equal(result.dropped, 1);
});
