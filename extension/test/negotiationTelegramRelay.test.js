const assert = require('node:assert/strict');
const {
  processNegotiationUpdate,
  relayNegotiationUpdates,
  CONTRACT_AGREED_MESSAGE,
  ROUND_LIMIT_MESSAGE,
  CLARIFY_INTENT_MESSAGE,
  COULD_NOT_DERIVE_CHANGE_MESSAGE,
} = require('../out/onboarding/negotiationTelegramRelay');

const PRINCIPAL_ID = '111';
const CHAT_ID = '-100123';
const NEGOTIATION_TOPIC_ID = 42;

function mkUpdate({ updateId = 1, fromId = 111, chatId = CHAT_ID, topicId = NEGOTIATION_TOPIC_ID, text = 'also add accessibility support' } = {}) {
  return { update_id: updateId, message: { message_id: updateId, chat: { id: chatId }, from: { id: fromId }, message_thread_id: topicId, text } };
}

function mkContract(overrides = {}) {
  return { scope: ['Ship the login flow'], outOfScope: [], boundaries: [], initialBacklogSummary: '', agreement: 'proposed', ...overrides };
}

function mkAdapters(overrides = {}) {
  const posts = [];
  return {
    posts,
    objectToContract: async () => ({ outcome: 'revised', contract: mkContract() }),
    approveContract: async () => ({ outcome: 'agreed', contract: mkContract({ agreement: 'agreed' }) }),
    postToTopic: async (text) => {
      posts.push(text);
    },
    ...overrides,
  };
}

// ── processNegotiationUpdate ────────────────────────────────────────────

test('a dropped decision (e.g. not-principal) never calls any adapter and reports dropped', async () => {
  const update = mkUpdate({ fromId: 999 });
  const adapters = mkAdapters({
    objectToContract: async () => {
      throw new Error('must not be called');
    },
    approveContract: async () => {
      throw new Error('must not be called');
    },
  });

  const outcome = await processNegotiationUpdate(update, PRINCIPAL_ID, CHAT_ID, NEGOTIATION_TOPIC_ID, adapters);

  assert.equal(outcome, 'dropped');
  assert.deepEqual(adapters.posts, []);
});

test('an objection revises the contract and posts the revision to the topic', async () => {
  const update = mkUpdate({ text: 'also add accessibility support' });
  const adapters = mkAdapters({
    objectToContract: async (text) => {
      assert.equal(text, 'also add accessibility support');
      return { outcome: 'revised', contract: mkContract({ scope: ['Ship the login flow', 'Per operator request: also add accessibility support'] }) };
    },
  });

  const outcome = await processNegotiationUpdate(update, PRINCIPAL_ID, CHAT_ID, NEGOTIATION_TOPIC_ID, adapters);

  assert.equal(outcome, 'posted');
  assert.equal(adapters.posts.length, 1);
  assert.match(adapters.posts[0], /accessibility support/);
});

test('an agreement reply approves the contract and posts a confirmation', async () => {
  const update = mkUpdate({ text: 'agree' });
  const adapters = mkAdapters();

  const outcome = await processNegotiationUpdate(update, PRINCIPAL_ID, CHAT_ID, NEGOTIATION_TOPIC_ID, adapters);

  assert.equal(outcome, 'posted');
  assert.deepEqual(adapters.posts, [CONTRACT_AGREED_MESSAGE]);
});

test('an objection against an already-ended negotiation is dropped, never thrown', async () => {
  const update = mkUpdate({ text: 'too late' });
  const adapters = mkAdapters({ objectToContract: async () => ({ outcome: 'already-ended' }) });

  const outcome = await processNegotiationUpdate(update, PRINCIPAL_ID, CHAT_ID, NEGOTIATION_TOPIC_ID, adapters);

  assert.equal(outcome, 'dropped');
  assert.deepEqual(adapters.posts, []);
});

test('an agreement against an already-ended negotiation is dropped, never thrown', async () => {
  const update = mkUpdate({ text: 'agree' });
  const adapters = mkAdapters({ approveContract: async () => ({ outcome: 'already-ended' }) });

  const outcome = await processNegotiationUpdate(update, PRINCIPAL_ID, CHAT_ID, NEGOTIATION_TOPIC_ID, adapters);

  assert.equal(outcome, 'dropped');
  assert.deepEqual(adapters.posts, []);
});

test('an objection that exhausts the round budget posts the round-limit notice instead of a revision', async () => {
  const update = mkUpdate({ text: 'one too many' });
  const adapters = mkAdapters({ objectToContract: async () => ({ outcome: 'round-limit' }) });

  const outcome = await processNegotiationUpdate(update, PRINCIPAL_ID, CHAT_ID, NEGOTIATION_TOPIC_ID, adapters);

  assert.equal(outcome, 'posted');
  assert.deepEqual(adapters.posts, [ROUND_LIMIT_MESSAGE]);
});

// BL-442: an ambiguous reply must never reach objectToContract at all - the
// contract must be left completely alone while the human is asked to
// disambiguate.
test('an ambiguous reply asks for clarification and never calls objectToContract or approveContract', async () => {
  const update = mkUpdate({ text: 'not sure' });
  const adapters = mkAdapters({
    objectToContract: async () => {
      throw new Error('must not be called');
    },
    approveContract: async () => {
      throw new Error('must not be called');
    },
  });

  const outcome = await processNegotiationUpdate(update, PRINCIPAL_ID, CHAT_ID, NEGOTIATION_TOPIC_ID, adapters);

  assert.equal(outcome, 'posted');
  assert.deepEqual(adapters.posts, [CLARIFY_INTENT_MESSAGE]);
});

// BL-442: an objection that is definitely an objection, but from which no
// concrete change could be derived, posts the rephrase message rather than
// re-posting the (unchanged) contract as if it were a real revision.
test('an objection from which no change could be derived posts the rephrase notice, not the contract', async () => {
  const update = mkUpdate({ text: 'I am wary of this direction' });
  const adapters = mkAdapters({ objectToContract: async () => ({ outcome: 'not-derived' }) });

  const outcome = await processNegotiationUpdate(update, PRINCIPAL_ID, CHAT_ID, NEGOTIATION_TOPIC_ID, adapters);

  assert.equal(outcome, 'posted');
  assert.deepEqual(adapters.posts, [COULD_NOT_DERIVE_CHANGE_MESSAGE]);
});

// ── relayNegotiationUpdates (BL-381 scenario 02: as many rounds as needed) ─

test('relayNegotiationUpdates processes every update in order and advances the offset past the last one', async () => {
  const updates = [mkUpdate({ updateId: 5, text: 'first objection' }), mkUpdate({ updateId: 6, text: 'second objection' })];
  const seenObjections = [];
  const adapters = mkAdapters({
    objectToContract: async (text) => {
      seenObjections.push(text);
      return { outcome: 'revised', contract: mkContract() };
    },
  });

  const result = await relayNegotiationUpdates(updates, 5, PRINCIPAL_ID, CHAT_ID, NEGOTIATION_TOPIC_ID, adapters);

  assert.deepEqual(seenObjections, ['first objection', 'second objection']);
  assert.equal(result.posted, 2);
  assert.equal(result.dropped, 0);
  assert.equal(result.nextOffset, 7);
  assert.equal(adapters.posts.length, 2);
});

// BL-381 scenario 02 is a Scenario Outline for exactly this reason: one
// round must work as readily as two - this fixture drives BOTH counts
// through the SAME relay so neither is a special case of the other.
for (const rounds of [1, 2]) {
  test(`relayNegotiationUpdates carries exactly ${rounds} revised contract(s) into the topic for ${rounds} objection(s)`, async () => {
    const updates = Array.from({ length: rounds }, (_, i) => mkUpdate({ updateId: i + 1, text: `objection ${i + 1}` }));
    const adapters = mkAdapters({ objectToContract: async () => ({ outcome: 'revised', contract: mkContract() }) });

    const result = await relayNegotiationUpdates(updates, 0, PRINCIPAL_ID, CHAT_ID, NEGOTIATION_TOPIC_ID, adapters);

    assert.equal(result.posted, rounds);
    assert.equal(adapters.posts.length, rounds);
  });
}

test('relayNegotiationUpdates counts a dropped update separately from a posted one', async () => {
  const updates = [mkUpdate({ updateId: 1, fromId: 999 }), mkUpdate({ updateId: 2, text: 'a real objection' })];
  const adapters = mkAdapters({ objectToContract: async () => ({ outcome: 'revised', contract: mkContract() }) });

  const result = await relayNegotiationUpdates(updates, 0, PRINCIPAL_ID, CHAT_ID, NEGOTIATION_TOPIC_ID, adapters);

  assert.equal(result.posted, 1);
  assert.equal(result.dropped, 1);
  assert.equal(result.nextOffset, 3);
});

test('relayNegotiationUpdates on an empty batch leaves the offset unchanged', async () => {
  const adapters = mkAdapters();
  const result = await relayNegotiationUpdates([], 9, PRINCIPAL_ID, CHAT_ID, NEGOTIATION_TOPIC_ID, adapters);
  assert.equal(result.nextOffset, 9);
  assert.equal(result.posted, 0);
  assert.equal(result.dropped, 0);
});
