const assert = require('node:assert/strict');
const {
  isAgreementText,
  isAmbiguousIntentText,
  decideNegotiationUpdateAction,
  formatContractForTelegram,
} = require('../out/onboarding/negotiationTelegramRouting');

const PRINCIPAL_ID = 111;
const CHAT_ID = '-100123';
const NEGOTIATION_TOPIC_ID = 42;

function mkUpdate({ fromId = PRINCIPAL_ID, chatId = CHAT_ID, topicId = NEGOTIATION_TOPIC_ID, text = 'remove the PWA work' } = {}) {
  return { update_id: 1, message: { message_id: 1, chat: { id: chatId }, from: { id: fromId }, message_thread_id: topicId, text } };
}

// ── isAgreementText ────────────────────────────────────────────────────

test('isAgreementText recognizes bare agreement words', () => {
  for (const word of ['agree', 'Agreed', 'APPROVE', 'approved', 'lgtm', 'yes', 'agree.', 'agree!']) {
    assert.equal(isAgreementText(word), true, `expected "${word}" to be recognized as agreement`);
  }
});

test('isAgreementText is false for an objection that merely mentions the word "agree"', () => {
  assert.equal(isAgreementText('I agree with most of this but remove the PWA work'), false);
});

test('isAgreementText is false for ordinary objection text', () => {
  assert.equal(isAgreementText('also add accessibility support'), false);
});

// BL-442: the first real FES onboarding run replied "All agreed" - the
// original single-word anchor failed this and misrouted it as an objection.
test('isAgreementText recognizes common natural-language approvals broadened by BL-442', () => {
  for (const text of ['All agreed', 'all agreed', 'Ok', 'ok', 'okay', 'OK.', 'All Approve!']) {
    assert.equal(isAgreementText(text), true, `expected "${text}" to be recognized as agreement`);
  }
});

test('isAgreementText is still false for an objection that merely mentions "agree" even with "all" nearby', () => {
  assert.equal(isAgreementText('all agreed except remove the PWA work'), false);
});

// ── isAmbiguousIntentText ────────────────────────────────────────────────

test('isAmbiguousIntentText recognizes a small set of genuinely uncertain replies', () => {
  for (const text of ['not sure', 'Not Sure', 'unsure', 'maybe', 'hmm', 'hmmm', "I don't know", 'idk', '?', '???']) {
    assert.equal(isAmbiguousIntentText(text), true, `expected "${text}" to be recognized as ambiguous`);
  }
});

test('isAmbiguousIntentText is false for a real objection, even one that mentions uncertainty inline', () => {
  assert.equal(isAmbiguousIntentText('not sure about the PWA work, please remove it'), false);
});

test('isAmbiguousIntentText is false for an approval', () => {
  assert.equal(isAmbiguousIntentText('agreed'), false);
});

// ── decideNegotiationUpdateAction ──────────────────────────────────────

test('a message from a foreign chat is dropped as not-my-chat, even from the principal', () => {
  const update = mkUpdate({ chatId: '-999999' });
  const decision = decideNegotiationUpdateAction(update, String(PRINCIPAL_ID), CHAT_ID, NEGOTIATION_TOPIC_ID);
  assert.deepEqual(decision, { action: 'drop', reason: 'not-my-chat' });
});

test('a message from someone other than the principal is dropped', () => {
  const update = mkUpdate({ fromId: 999 });
  const decision = decideNegotiationUpdateAction(update, String(PRINCIPAL_ID), CHAT_ID, NEGOTIATION_TOPIC_ID);
  assert.deepEqual(decision, { action: 'drop', reason: 'not-principal' });
});

test('a message outside the negotiation topic is dropped', () => {
  const update = mkUpdate({ topicId: 7 });
  const decision = decideNegotiationUpdateAction(update, String(PRINCIPAL_ID), CHAT_ID, NEGOTIATION_TOPIC_ID);
  assert.deepEqual(decision, { action: 'drop', reason: 'not-negotiation-topic' });
});

test('a textless message (e.g. a sticker) in the negotiation topic is dropped', () => {
  // Built directly (not via mkUpdate's defaulted `text` param, which a
  // destructured `undefined` would fall through to the default for) so the
  // message genuinely carries no `text` field, as a sticker/photo would.
  const update = { update_id: 1, message: { message_id: 1, chat: { id: CHAT_ID }, from: { id: PRINCIPAL_ID }, message_thread_id: NEGOTIATION_TOPIC_ID } };
  const decision = decideNegotiationUpdateAction(update, String(PRINCIPAL_ID), CHAT_ID, NEGOTIATION_TOPIC_ID);
  assert.deepEqual(decision, { action: 'drop', reason: 'no-text' });
});

test('an ordinary reply in the negotiation topic from the principal is an objection', () => {
  const update = mkUpdate({ text: 'also add accessibility support' });
  const decision = decideNegotiationUpdateAction(update, String(PRINCIPAL_ID), CHAT_ID, NEGOTIATION_TOPIC_ID);
  assert.deepEqual(decision, { action: 'objection', text: 'also add accessibility support' });
});

test('an agreement reply in the negotiation topic from the principal is an agreement', () => {
  const update = mkUpdate({ text: 'agree' });
  const decision = decideNegotiationUpdateAction(update, String(PRINCIPAL_ID), CHAT_ID, NEGOTIATION_TOPIC_ID);
  assert.deepEqual(decision, { action: 'agree' });
});

// BL-442: the two-word reply that started this ticket - must classify as
// agreement, not fall through to the objection path.
test('a "All agreed" reply in the negotiation topic is an agreement, not an objection', () => {
  const update = mkUpdate({ text: 'All agreed' });
  const decision = decideNegotiationUpdateAction(update, String(PRINCIPAL_ID), CHAT_ID, NEGOTIATION_TOPIC_ID);
  assert.deepEqual(decision, { action: 'agree' });
});

test('a genuinely ambiguous reply in the negotiation topic asks rather than objects', () => {
  const update = mkUpdate({ text: 'not sure' });
  const decision = decideNegotiationUpdateAction(update, String(PRINCIPAL_ID), CHAT_ID, NEGOTIATION_TOPIC_ID);
  assert.deepEqual(decision, { action: 'ask' });
});

// BL-381: the chat guard must win over every later reason, same ordering
// rationale decideUpdateAction's own BL-379 comment gives - both conditions
// can hold at once (a stranger posting in a foreign chat), so this order is
// load-bearing, not incidental.
test('a foreign-chat message from neither the principal nor in the negotiation topic is still reported as not-my-chat', () => {
  const update = mkUpdate({ chatId: '-999999', fromId: 999, topicId: 7 });
  const decision = decideNegotiationUpdateAction(update, String(PRINCIPAL_ID), CHAT_ID, NEGOTIATION_TOPIC_ID);
  assert.deepEqual(decision, { action: 'drop', reason: 'not-my-chat' });
});

// ── formatContractForTelegram ──────────────────────────────────────────

test('formatContractForTelegram renders the agreement state, scope, out-of-scope, and boundaries', () => {
  const text = formatContractForTelegram({
    scope: ['Ship the login flow'],
    outOfScope: ['Payments'],
    boundaries: ['No production data access'],
    initialBacklogSummary: '5 tickets queued',
    agreement: 'proposed',
  });
  assert.match(text, /Agreement: proposed/);
  assert.match(text, /Ship the login flow/);
  assert.match(text, /Payments/);
  assert.match(text, /No production data access/);
});

test('formatContractForTelegram renders the exact expected layout, labels, and reply instructions', () => {
  const text = formatContractForTelegram({
    scope: ['Ship the login flow'],
    outOfScope: ['Payments'],
    boundaries: ['No production data access'],
    initialBacklogSummary: '5 tickets queued',
    agreement: 'proposed',
  });
  assert.equal(
    text,
    [
      'SwarmForge onboarding contract',
      'Agreement: proposed',
      '',
      'Scope:',
      '- Ship the login flow',
      '',
      'Out of scope:',
      '- Payments',
      '',
      'Boundaries:',
      '- No production data access',
      '',
      'Reply in this topic to object, or reply "agree" to approve.',
    ].join('\n')
  );
});

test('formatContractForTelegram renders an empty scope/outOfScope/boundaries list without crashing', () => {
  const text = formatContractForTelegram({
    scope: [],
    outOfScope: [],
    boundaries: [],
    initialBacklogSummary: '',
    agreement: 'proposed',
  });
  assert.match(text, /\(none\)/);
});
