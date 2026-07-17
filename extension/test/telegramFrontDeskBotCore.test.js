const assert = require('node:assert/strict');
const {
  isFromPrincipal,
  isFromMyChat,
  topicIdOf,
  messageTextOf,
  subjectForTopic,
  topicForSubject,
  hasDefaultBinding,
  resolveReplyTopicId,
  resolveReplyDelivery,
  decideUpdateAction,
  pollAndForward,
  parseNextSseRecord,
  relaySseReplies,
  DEFAULT_SUBJECT_KEY,
  computePollBackoffMs,
  shouldRaiseDegradedWarning,
  runPollCycle,
  applyPollCycleResult,
  runContainedLoop,
  computeReplyRelayCycleResult,
  applyReplyRelayCycleResult,
  decideEnsureOperatorTopicAction,
  OPERATOR_SUBJECT_ID,
  decideEnsureApprovalsTopicAction,
  APPROVALS_SUBJECT_ID,
  decideEnsureRecertTopicAction,
  RECERT_SUBJECT_ID,
  nextUpdateOffset,
  offsetAfterDelivery,
  shouldEscalateStuckDelivery,
  isPollCycleStale,
  decideCallbackQueryAction,
  decideSteeringAction,
  decideEnsureRoleTopicAction,
  decideVoiceUpdateAction,
  decideStandingTopicTitleSync,
  decideEnsureAgentQuestionsTopicAction,
  AGENT_QUESTIONS_SUBJECT_ID,
  decideEnsureControlTopicAction,
  CONTROL_SUBJECT_ID,
  decideAgentQuestionsReplyAction,
  decidePollAnswerAction,
  recordApprovalDecisionAndClose,
  composeAskMessageBody,
  composeAskButtons,
  decideEnsureBacklogTopicAction,
  BACKLOG_SUBJECT_ID,
} = require('../out/tools/telegramFrontDeskBotCore');

const PRINCIPAL_ID = 111;

function mkUpdate({ fromId, topicId, text, chatId } = {}) {
  return { update_id: 1, message: { message_id: 1, chat: { id: chatId ?? 1 }, from: { id: fromId }, message_thread_id: topicId, text } };
}

// BL-426: a voice-note update - mutually exclusive with `text` above.
function mkVoiceUpdate({ fromId, topicId, chatId, fileId, updateId } = {}) {
  return {
    update_id: updateId ?? 1,
    message: { message_id: 1, chat: { id: chatId ?? 1 }, from: { id: fromId }, message_thread_id: topicId, voice: { file_id: fileId ?? 'file-1', duration: 3 } },
  };
}

// BL-410: a tapped inline-keyboard button's own update shape - mutually
// exclusive with `message` above.
function mkCallbackUpdate({ fromId, data, chatId, callbackId } = {}) {
  return { update_id: 1, callback_query: { id: callbackId ?? 'cbq-1', data, from: { id: fromId }, message: { chat: { id: chatId ?? 1 } } } };
}

// ── isFromPrincipal / topicIdOf / messageTextOf (pure) ──────────────────

test('isFromPrincipal is true only for the configured principal id', () => {
  assert.equal(isFromPrincipal(mkUpdate({ fromId: PRINCIPAL_ID }), PRINCIPAL_ID), true);
  assert.equal(isFromPrincipal(mkUpdate({ fromId: 999 }), PRINCIPAL_ID), false);
});

// ── BL-379: isFromMyChat (pure) ──────────────────────────────────────────

test('BL-379: isFromMyChat is true only for the bot\'s own configured chat id', () => {
  assert.equal(isFromMyChat(mkUpdate({ fromId: PRINCIPAL_ID, chatId: 1 }), '1'), true);
  assert.equal(isFromMyChat(mkUpdate({ fromId: PRINCIPAL_ID, chatId: 2 }), '1'), false);
});

test('BL-379: isFromMyChat compares by string value, tolerating a numeric-vs-string mismatch', () => {
  assert.equal(isFromMyChat(mkUpdate({ fromId: PRINCIPAL_ID, chatId: -1001234567890 }), '-1001234567890'), true);
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
});

test('BL-294: subjectForTopic resolves a DM (topicId undefined) through the reserved default-subject key', () => {
  const map = { [DEFAULT_SUBJECT_KEY]: 'SUP-1', '7': 'SUP-2' };
  assert.equal(subjectForTopic(map, undefined), 'SUP-1');
});

test('subjectForTopic returns undefined for a DM when no default subject has been opened yet', () => {
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

test('BL-294: topicForSubject returns undefined (not NaN) for a subject mapped under the DM default key', () => {
  const map = { [DEFAULT_SUBJECT_KEY]: 'SUP-1' };
  assert.equal(topicForSubject(map, 'SUP-1'), undefined);
});

// ── resolveReplyTopicId (pure) — BL-325: the reply egress's BL-### fallback ──

test('BL-325: resolveReplyTopicId resolves a SUP-### threadId through the SUP map, unchanged from before', () => {
  const supMap = { '7': 'SUP-1' };
  assert.equal(resolveReplyTopicId(supMap, {}, 'SUP-1'), 7);
});

test('BL-325: resolveReplyTopicId falls back to the backlog map for a BL-### threadId', () => {
  const supMap = { '7': 'SUP-1' };
  const backlogMap = { 'BL-316': 62 };
  assert.equal(resolveReplyTopicId(supMap, backlogMap, 'BL-316'), 62);
});

test('BL-325: resolveReplyTopicId prefers the SUP map when (hypothetically) both would match', () => {
  const supMap = { '7': 'SUP-1' };
  const backlogMap = { 'SUP-1': 99 };
  assert.equal(resolveReplyTopicId(supMap, backlogMap, 'SUP-1'), 7);
});

test('BL-325: resolveReplyTopicId returns undefined when neither map has the threadId', () => {
  assert.equal(resolveReplyTopicId({ '7': 'SUP-1' }, { 'BL-1': 2 }, 'BL-999'), undefined);
});

// ── hasDefaultBinding (pure) — BL-355 ────────────────────────────────────

test('hasDefaultBinding is true only when DEFAULT_SUBJECT_KEY maps to that exact subject', () => {
  const map = { [DEFAULT_SUBJECT_KEY]: 'SUP-1', '7': 'SUP-2' };
  assert.equal(hasDefaultBinding(map, 'SUP-1'), true);
  assert.equal(hasDefaultBinding(map, 'SUP-2'), false);
  assert.equal(hasDefaultBinding(map, 'SUP-999'), false);
});

// ── resolveReplyDelivery (pure) — BL-355 reply-returns-to-asking-thread ──

test('resolveReplyDelivery: a subject bound only to a real topic delivers there, no pointer', () => {
  const map = { '7': 'SUP-1' };
  assert.deepEqual(resolveReplyDelivery(map, {}, 'SUP-1'), { kind: 'topic', topicId: 7, alsoPointerToDefault: false });
});

test('resolveReplyDelivery: a subject bound ONLY under DEFAULT_SUBJECT_KEY delivers to General, not silently dropped', () => {
  const map = { [DEFAULT_SUBJECT_KEY]: 'SUP-1' };
  assert.deepEqual(resolveReplyDelivery(map, {}, 'SUP-1'), { kind: 'default' });
});

test('resolveReplyDelivery: a subject bound to BOTH a real topic and the default key delivers to the topic with a pointer flagged', () => {
  const map = { [DEFAULT_SUBJECT_KEY]: 'SUP-2', '7': 'SUP-2' };
  assert.deepEqual(resolveReplyDelivery(map, {}, 'SUP-2'), { kind: 'topic', topicId: 7, alsoPointerToDefault: true });
});

test('resolveReplyDelivery: a BL-### threadId resolves through the backlog map, no pointer concept', () => {
  const backlogMap = { 'BL-316': 62 };
  assert.deepEqual(resolveReplyDelivery({}, backlogMap, 'BL-316'), { kind: 'topic', topicId: 62, alsoPointerToDefault: false });
});

test('resolveReplyDelivery: no binding anywhere is undeliverable', () => {
  assert.deepEqual(resolveReplyDelivery({ '7': 'SUP-1' }, { 'BL-1': 2 }, 'SUP-999'), { kind: 'undeliverable' });
});

// ── decideEnsureOperatorTopicAction (pure) — BL-346 standing-operator-topic-01/06/07 ──

test('BL-346: decideEnsureOperatorTopicAction creates when no topic is bound to the reserved subject yet', () => {
  assert.deepEqual(decideEnsureOperatorTopicAction({}), { kind: 'create' });
  assert.deepEqual(decideEnsureOperatorTopicAction({ '7': 'SUP-1' }), { kind: 'create' });
});

test('BL-346: decideEnsureOperatorTopicAction reuses the topic already bound to OPERATOR_SUBJECT_ID', () => {
  assert.deepEqual(decideEnsureOperatorTopicAction({ '7': 'SUP-1', '42': OPERATOR_SUBJECT_ID }), { kind: 'reuse', topicId: 42 });
});

test('BL-346: decideEnsureOperatorTopicAction is reserved-subject-specific - an ordinary SUP-### binding never counts as the Operator topic', () => {
  assert.deepEqual(decideEnsureOperatorTopicAction({ '7': 'SUP-1', '8': 'SUP-2' }), { kind: 'create' });
});

// ── decideEnsureApprovalsTopicAction (pure) — BL-434 ──────────────────────

test('BL-434: decideEnsureApprovalsTopicAction creates when no topic is bound to the reserved subject yet', () => {
  assert.deepEqual(decideEnsureApprovalsTopicAction({}), { kind: 'create' });
  assert.deepEqual(decideEnsureApprovalsTopicAction({ '7': 'SUP-1' }), { kind: 'create' });
});

test('BL-434: decideEnsureApprovalsTopicAction reuses the topic already bound to APPROVALS_SUBJECT_ID', () => {
  assert.deepEqual(decideEnsureApprovalsTopicAction({ '7': 'SUP-1', '42': APPROVALS_SUBJECT_ID }), { kind: 'reuse', topicId: 42 });
});

test('BL-434: decideEnsureApprovalsTopicAction is reserved-subject-specific - the Operator topic\'s own binding never counts as the Approvals topic', () => {
  assert.deepEqual(decideEnsureApprovalsTopicAction({ '42': OPERATOR_SUBJECT_ID }), { kind: 'create' });
});

// ── decideEnsureBacklogTopicAction (pure) — BL-492 ────────────────────────

test('BL-492: decideEnsureBacklogTopicAction creates when no topic is bound to the reserved subject yet', () => {
  assert.deepEqual(decideEnsureBacklogTopicAction({}), { kind: 'create' });
  assert.deepEqual(decideEnsureBacklogTopicAction({ '7': 'SUP-1' }), { kind: 'create' });
});

test('BL-492: decideEnsureBacklogTopicAction reuses the topic already bound to BACKLOG_SUBJECT_ID', () => {
  assert.deepEqual(decideEnsureBacklogTopicAction({ '7': 'SUP-1', '42': BACKLOG_SUBJECT_ID }), { kind: 'reuse', topicId: 42 });
});

test('BL-492: decideEnsureBacklogTopicAction is reserved-subject-specific - no OTHER standing topic\'s own binding ever counts as the Backlog topic', () => {
  assert.deepEqual(decideEnsureBacklogTopicAction({ '42': OPERATOR_SUBJECT_ID }), { kind: 'create' });
  assert.deepEqual(decideEnsureBacklogTopicAction({ '42': APPROVALS_SUBJECT_ID }), { kind: 'create' });
  assert.deepEqual(decideEnsureBacklogTopicAction({ '42': RECERT_SUBJECT_ID }), { kind: 'create' });
  assert.deepEqual(decideEnsureBacklogTopicAction({ '42': AGENT_QUESTIONS_SUBJECT_ID }), { kind: 'create' });
  assert.deepEqual(decideEnsureBacklogTopicAction({ '42': CONTROL_SUBJECT_ID }), { kind: 'create' });
});

test('BL-492: BACKLOG_SUBJECT_ID does not collide with any other reserved subject id', () => {
  const reserved = [OPERATOR_SUBJECT_ID, APPROVALS_SUBJECT_ID, RECERT_SUBJECT_ID, AGENT_QUESTIONS_SUBJECT_ID, CONTROL_SUBJECT_ID];
  assert.ok(!reserved.includes(BACKLOG_SUBJECT_ID), `BACKLOG_SUBJECT_ID must be distinct from every existing reserved id, got a collision with: ${JSON.stringify(reserved)}`);
});

// ── decideStandingTopicTitleSync (pure) — BL-453 concierge-icon-02/03 ────

test('BL-453: decideStandingTopicTitleSync updates when no title has ever been recorded (a pre-BL-453 install)', () => {
  assert.equal(decideStandingTopicTitleSync(undefined, 'Concierge'), 'update');
});

test('BL-453: decideStandingTopicTitleSync updates when the recorded title differs from the desired one', () => {
  assert.equal(decideStandingTopicTitleSync('Operator', 'Concierge'), 'update');
});

test('BL-453: decideStandingTopicTitleSync is unchanged once the recorded title already matches - never re-edits', () => {
  assert.equal(decideStandingTopicTitleSync('Concierge', 'Concierge'), 'unchanged');
});

// ── decideEnsureAgentQuestionsTopicAction (pure) — BL-466 ─────────────────

test('BL-466: decideEnsureAgentQuestionsTopicAction creates when no topic is bound to the reserved subject yet', () => {
  assert.deepEqual(decideEnsureAgentQuestionsTopicAction({}), { kind: 'create' });
  assert.deepEqual(decideEnsureAgentQuestionsTopicAction({ '7': 'SUP-1' }), { kind: 'create' });
});

test('BL-466: decideEnsureAgentQuestionsTopicAction reuses the topic already bound to AGENT_QUESTIONS_SUBJECT_ID', () => {
  assert.deepEqual(decideEnsureAgentQuestionsTopicAction({ '7': 'SUP-1', '42': AGENT_QUESTIONS_SUBJECT_ID }), { kind: 'reuse', topicId: 42 });
});

test('BL-466: decideEnsureAgentQuestionsTopicAction is reserved-subject-specific - another reserved subject\'s binding never counts', () => {
  assert.deepEqual(decideEnsureAgentQuestionsTopicAction({ '42': OPERATOR_SUBJECT_ID }), { kind: 'create' });
});

// ── decideEnsureControlTopicAction (pure) — BL-423 ────────────────────────

test('BL-423: decideEnsureControlTopicAction creates when no topic is bound to the reserved subject yet', () => {
  assert.deepEqual(decideEnsureControlTopicAction({}), { kind: 'create' });
  assert.deepEqual(decideEnsureControlTopicAction({ '7': 'SUP-1' }), { kind: 'create' });
});

test('BL-423: decideEnsureControlTopicAction reuses the topic already bound to CONTROL_SUBJECT_ID', () => {
  assert.deepEqual(decideEnsureControlTopicAction({ '7': 'SUP-1', '42': CONTROL_SUBJECT_ID }), { kind: 'reuse', topicId: 42 });
});

test('BL-423: decideEnsureControlTopicAction is reserved-subject-specific - another reserved subject\'s binding never counts', () => {
  assert.deepEqual(decideEnsureControlTopicAction({ '42': OPERATOR_SUBJECT_ID }), { kind: 'create' });
});

// ── decideAgentQuestionsReplyAction (pure) — BL-466 ───────────────────────

test('BL-466: decideAgentQuestionsReplyAction is not-applicable when the topic id is not the Agent Questions topic', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 5, text: 'staging' });
  assert.deepEqual(decideAgentQuestionsReplyAction(update, PRINCIPAL_ID, '1', 42), { kind: 'not-applicable' });
});

test('BL-466: decideAgentQuestionsReplyAction is not-applicable when no Agent Questions topic is bound at all', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'staging' });
  assert.deepEqual(decideAgentQuestionsReplyAction(update, PRINCIPAL_ID, '1', undefined), { kind: 'not-applicable' });
});

test('BL-466: decideAgentQuestionsReplyAction refuses a reply from a foreign chat or a non-principal', () => {
  const foreignChat = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'staging', chatId: 2 });
  assert.deepEqual(decideAgentQuestionsReplyAction(foreignChat, PRINCIPAL_ID, '1', 42), { kind: 'refuse' });
  const stranger = mkUpdate({ fromId: 999, topicId: 42, text: 'staging' });
  assert.deepEqual(decideAgentQuestionsReplyAction(stranger, PRINCIPAL_ID, '1', 42), { kind: 'refuse' });
});

test('BL-466: decideAgentQuestionsReplyAction refuses a text-less message in the Agent Questions topic', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42 });
  assert.deepEqual(decideAgentQuestionsReplyAction(update, PRINCIPAL_ID, '1', 42), { kind: 'refuse' });
});

test('BL-466: decideAgentQuestionsReplyAction delivers the principal\'s reply text in the Agent Questions topic', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'staging' });
  assert.deepEqual(decideAgentQuestionsReplyAction(update, PRINCIPAL_ID, '1', 42), { kind: 'deliver', text: 'staging' });
});

// ── decidePollAnswerAction (pure) — BL-466 ────────────────────────────────

function mkPollAnswer({ pollId, optionIds, userId } = {}) {
  return { poll_id: pollId ?? 'poll-1', option_ids: optionIds ?? [0], ...(userId === undefined ? {} : { user: { id: userId } }) };
}

test('BL-466: decidePollAnswerAction resolves the principal\'s selected option index', () => {
  assert.deepEqual(decidePollAnswerAction(mkPollAnswer({ pollId: 'poll-1', optionIds: [1], userId: PRINCIPAL_ID }), PRINCIPAL_ID), {
    kind: 'answer',
    pollId: 'poll-1',
    optionIndex: 1,
  });
});

test('BL-466: decidePollAnswerAction drops a vote with no user at all (an anonymous poll would never identify the voter)', () => {
  assert.deepEqual(decidePollAnswerAction(mkPollAnswer({ userId: undefined }), PRINCIPAL_ID), { kind: 'drop', reason: 'not-principal' });
});

test('BL-466: decidePollAnswerAction drops a vote from someone other than the principal', () => {
  assert.deepEqual(decidePollAnswerAction(mkPollAnswer({ userId: 999 }), PRINCIPAL_ID), { kind: 'drop', reason: 'not-principal' });
});

test('BL-466: decidePollAnswerAction drops a retraction (empty option_ids) as a deliberate drop, never a failure', () => {
  assert.deepEqual(decidePollAnswerAction(mkPollAnswer({ optionIds: [], userId: PRINCIPAL_ID }), PRINCIPAL_ID), {
    kind: 'drop',
    reason: 'no-selection',
  });
});

// ── decideEnsureRoleTopicAction (pure) — BL-425 provision-role-topics-01 ──

test('BL-425: decideEnsureRoleTopicAction creates when the role has no topic bound yet', () => {
  assert.deepEqual(decideEnsureRoleTopicAction({}, 'coder'), { kind: 'create' });
  assert.deepEqual(decideEnsureRoleTopicAction({ QA: 55 }, 'coder'), { kind: 'create' });
});

test('BL-425: decideEnsureRoleTopicAction reuses the topic already bound to that role', () => {
  assert.deepEqual(decideEnsureRoleTopicAction({ coder: 42, QA: 55 }, 'coder'), { kind: 'reuse', topicId: 42 });
});

// ── decideUpdateAction (pure) — BL-281 telegram-topic-01/05, BL-294 auto-open-01..04 ──

test('BL-281 telegram-topic-01: a principal message on a MAPPED topic posts under the resolved subjectId', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'any update?' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', (topicId) => (topicId === 7 ? 'SUP-1' : undefined));
  assert.deepEqual(decision, { action: 'post-existing', subjectId: 'SUP-1', text: 'any update?' });
});

test('BL-281 telegram-topic-05 / BL-294 auto-open-04: a non-principal message is dropped, never posted or opened', () => {
  const update = mkUpdate({ fromId: 999, topicId: 7, text: 'let me in' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', () => 'SUP-1');
  assert.deepEqual(decision, { action: 'drop', reason: 'not-principal' });
});

test('BL-294 auto-open-01: a principal DM (no topic) with no default subject yet opens the default subject', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, text: 'hello from a DM' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', () => undefined);
  assert.deepEqual(decision, { action: 'open-default', text: 'hello from a DM' });
});

test('BL-294 auto-open-02: a principal message on an unmapped topic opens a subject FOR that topic', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'new conversation' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', () => undefined);
  assert.deepEqual(decision, { action: 'open-for-topic', topicId: 42, text: 'new conversation' });
});

test('a textless update (e.g. a sticker/photo) is dropped, never posted or opened with undefined text', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7 });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', () => 'SUP-1');
  assert.deepEqual(decision, { action: 'drop', reason: 'no-text' });
});

// ── BL-379 front-desk-listens-only-to-its-own-chat-01: decideUpdateAction's chat guard ──

test('BL-379: a principal message from a FOREIGN chat is dropped as not-my-chat, never taken as work', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, chatId: 2, text: 'hello' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', () => undefined);
  assert.deepEqual(decision, { action: 'drop', reason: 'not-my-chat' });
});

test('BL-379: a message from the own chat but a non-principal sender is dropped as not-principal, not not-my-chat', () => {
  const update = mkUpdate({ fromId: 999, chatId: 1, text: 'let me in' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', () => undefined);
  assert.deepEqual(decision, { action: 'drop', reason: 'not-principal' });
});

// BL-379's own priority-order pin: BOTH drop conditions hold at once (a
// stranger, in a foreign chat) - proves the chat guard is checked FIRST,
// not merely that either guard alone can fire. Testing each condition in
// isolation (the two tests immediately above) would leave this order
// entirely unproven and let a clause-swap mutant survive.
test('BL-379: a stranger in a foreign chat is dropped as not-my-chat - the chat guard wins over not-principal when both hold', () => {
  const update = mkUpdate({ fromId: 999, chatId: 2, text: 'let me in' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', () => undefined);
  assert.deepEqual(decision, { action: 'drop', reason: 'not-my-chat' });
});

// ── BL-298 topic-reply-01/02/03: BL-### topic replies route as Operator context ──

test('BL-298 topic-reply-01: a reply on a topic mapped to a backlog item routes as operator context, not a support subject', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'here is an update' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', () => undefined, (topicId) => (topicId === 42 ? 'BL-123' : undefined));
  assert.deepEqual(decision, { action: 'operator-context', backlogId: 'BL-123', text: 'here is an update' });
});

test('BL-298: a topic mapped to BOTH a SUP-### subject and a backlog item resolves to the subject (support-thread priority, no regression)', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'ambiguous' });
  const decision = decideUpdateAction(
    update,
    PRINCIPAL_ID,
    '1',
    (topicId) => (topicId === 42 ? 'SUP-1' : undefined),
    (topicId) => (topicId === 42 ? 'BL-123' : undefined)
  );
  assert.deepEqual(decision, { action: 'post-existing', subjectId: 'SUP-1', text: 'ambiguous' });
});

test('BL-298 topic-reply-02: a topic mapped to a SUP-### subject still posts to that subject (no regression) even when backlogForTopic is provided', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'any update?' });
  const decision = decideUpdateAction(
    update,
    PRINCIPAL_ID,
    '1',
    (topicId) => (topicId === 7 ? 'SUP-1' : undefined),
    () => undefined
  );
  assert.deepEqual(decision, { action: 'post-existing', subjectId: 'SUP-1', text: 'any update?' });
});

test('BL-298 topic-reply-03: a non-principal reply on a backlog item\'s topic is still dropped, never routed as context', () => {
  const update = mkUpdate({ fromId: 999, topicId: 42, text: 'let me in' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', () => undefined, () => 'BL-123');
  assert.deepEqual(decision, { action: 'drop', reason: 'not-principal' });
});

test('an unmapped topic with no backlog mapping either still opens a fresh SUP-### subject (unrelated brand-new topic, unchanged)', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 99, text: 'brand new' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', () => undefined, () => undefined);
  assert.deepEqual(decision, { action: 'open-for-topic', topicId: 99, text: 'brand new' });
});

// ── BL-434 approvals-standing-topic-01/02/03: Approvals-topic replies ────

test('BL-434: a reply "approve <id>" in the Approvals topic is parsed into an approvals-topic-approve decision naming that exact id', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 750, text: 'approve BL-433' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', (topicId) => (topicId === 750 ? APPROVALS_SUBJECT_ID : undefined));
  assert.deepEqual(decision, { action: 'approvals-topic-approve', backlogId: 'BL-433', text: 'approve BL-433' });
});

test('BL-434: a reply "reject <id> <reason>" in the Approvals topic is parsed into an approvals-topic-reject decision', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 750, text: 'reject BL-433 no good' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', (topicId) => (topicId === 750 ? APPROVALS_SUBJECT_ID : undefined));
  assert.deepEqual(decision, { action: 'approvals-topic-reject', backlogId: 'BL-433', reason: 'no good', text: 'reject BL-433 no good' });
});

test('BL-434: a reply in the Approvals topic naming no recognizable verb+id is neither post-existing nor operator-context, but a distinct unrecognized decision', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 750, text: 'what is happening here' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', (topicId) => (topicId === 750 ? APPROVALS_SUBJECT_ID : undefined));
  assert.deepEqual(decision, { action: 'approvals-topic-unrecognized', text: 'what is happening here' });
});

// ── decideEnsureRecertTopicAction (pure) — BL-450 ─────────────────────────

test('BL-450: decideEnsureRecertTopicAction creates when no topic is bound to the reserved subject yet', () => {
  assert.deepEqual(decideEnsureRecertTopicAction({}), { kind: 'create' });
  assert.deepEqual(decideEnsureRecertTopicAction({ '7': 'SUP-1' }), { kind: 'create' });
});

test('BL-450: decideEnsureRecertTopicAction reuses the topic already bound to RECERT_SUBJECT_ID', () => {
  assert.deepEqual(decideEnsureRecertTopicAction({ '7': 'SUP-1', '42': RECERT_SUBJECT_ID }), { kind: 'reuse', topicId: 42 });
});

test('BL-450: decideEnsureRecertTopicAction is reserved-subject-specific - the Approvals topic\'s own binding never counts as the Recert topic', () => {
  assert.deepEqual(decideEnsureRecertTopicAction({ '42': APPROVALS_SUBJECT_ID }), { kind: 'create' });
});

// ── BL-450 recert-telegram-03/04/05/06/07: Recert-topic replies (pure) ────

test('BL-450: a reply "validate <id>" in the Recert topic is parsed into a recert-validate decision naming that exact id', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: 'validate BL-207-thing-01' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', (topicId) => (topicId === 900 ? RECERT_SUBJECT_ID : undefined));
  assert.deepEqual(decision, { action: 'recert-validate', scenarioId: 'BL-207-thing-01', text: 'validate BL-207-thing-01' });
});

test('BL-450: a reply to amend a scenario is parsed into a recert-amend decision carrying the new text', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: 'amend BL-207-thing-01 Given a revised precondition' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', (topicId) => (topicId === 900 ? RECERT_SUBJECT_ID : undefined));
  assert.deepEqual(decision, {
    action: 'recert-amend',
    scenarioId: 'BL-207-thing-01',
    newText: 'Given a revised precondition',
    text: 'amend BL-207-thing-01 Given a revised precondition',
  });
});

test('BL-450: a reply "delete <id>" in the Recert topic is parsed into a recert-delete decision', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: 'delete BL-207-thing-01' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', (topicId) => (topicId === 900 ? RECERT_SUBJECT_ID : undefined));
  assert.deepEqual(decision, { action: 'recert-delete', scenarioId: 'BL-207-thing-01', text: 'delete BL-207-thing-01' });
});

test('BL-450: a bare "confirm" in the Recert topic is parsed into a recert-confirm-delete decision', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: 'confirm' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', (topicId) => (topicId === 900 ? RECERT_SUBJECT_ID : undefined));
  assert.deepEqual(decision, { action: 'recert-confirm-delete', text: 'confirm' });
});

test('BL-450: a reply in the Recert topic naming no recognizable verb+id is neither post-existing nor operator-context, but a distinct unrecognized decision', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: 'looks fine to me' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', (topicId) => (topicId === 900 ? RECERT_SUBJECT_ID : undefined));
  assert.deepEqual(decision, { action: 'recert-unrecognized', text: 'looks fine to me' });
});

test('BL-450: a reply on an ORDINARY SUP-### topic (not the Recert topic) still posts as an ordinary subject post - no regression', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'validate BL-207-thing-01' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', (topicId) => (topicId === 7 ? 'SUP-1' : undefined));
  assert.deepEqual(decision, { action: 'post-existing', subjectId: 'SUP-1', text: 'validate BL-207-thing-01' });
});

test('BL-434: a reply on an ORDINARY SUP-### topic (not the Approvals topic) still posts as an ordinary subject post - no regression', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'approve BL-433' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', (topicId) => (topicId === 7 ? 'SUP-1' : undefined));
  assert.deepEqual(decision, { action: 'post-existing', subjectId: 'SUP-1', text: 'approve BL-433' });
});

test('decideUpdateAction called with only 3 args (no backlogForTopic) behaves exactly as before BL-298 - existing callers are unaffected', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 99, text: 'brand new' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, '1', () => undefined);
  assert.deepEqual(decision, { action: 'open-for-topic', topicId: 99, text: 'brand new' });
});

// ── decideSteeringAction (pure) — BL-425 slice 1 (REDIRECT mode) ─────────

test('BL-425 redirect-interrupts-addressed-pane-02: an authorised message in a role\'s topic redirects to that role', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, chatId: 1, topicId: 42, text: 'focus on the edge case first' });
  const decision = decideSteeringAction(update, PRINCIPAL_ID, '1', { coder: 42 });
  assert.deepEqual(decision, { kind: 'redirect', role: 'coder', text: 'focus on the edge case first' });
});

test('BL-425 redirect-routing-is-exact-03: each role\'s topic resolves to ITS OWN role, not another role\'s, when several are mapped', () => {
  const roleTopicMap = { coder: 42, cleaner: 43 };
  const toCoder = mkUpdate({ fromId: PRINCIPAL_ID, chatId: 1, topicId: 42, text: 'hello coder' });
  const toCleaner = mkUpdate({ fromId: PRINCIPAL_ID, chatId: 1, topicId: 43, text: 'hello cleaner' });
  assert.deepEqual(decideSteeringAction(toCoder, PRINCIPAL_ID, '1', roleTopicMap), { kind: 'redirect', role: 'coder', text: 'hello coder' });
  assert.deepEqual(decideSteeringAction(toCleaner, PRINCIPAL_ID, '1', roleTopicMap), { kind: 'redirect', role: 'cleaner', text: 'hello cleaner' });
});

test('BL-425 guard-unauthorised-sender-04: an unauthorised sender in a role\'s topic is refused, never redirected', () => {
  const update = mkUpdate({ fromId: 999, chatId: 1, topicId: 42, text: 'let me steer this' });
  const decision = decideSteeringAction(update, PRINCIPAL_ID, '1', { coder: 42 });
  assert.deepEqual(decision, { kind: 'refuse' });
});

test('BL-425: an unauthorised sender in a role\'s topic is refused even from a foreign chat (not-my-chat also fails auth)', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, chatId: 2, topicId: 42, text: 'let me steer this' });
  const decision = decideSteeringAction(update, PRINCIPAL_ID, '1', { coder: 42 });
  assert.deepEqual(decision, { kind: 'refuse' });
});

test('BL-425 guard-non-role-topic-05: an authorised message in a non-role topic (BL-ticket/Operator/unmapped) is ignored, never refused or redirected', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, chatId: 1, topicId: 999, text: 'anything' });
  assert.deepEqual(decideSteeringAction(update, PRINCIPAL_ID, '1', {}), { kind: 'ignore' });
  assert.deepEqual(decideSteeringAction(update, PRINCIPAL_ID, '1', { coder: 42 }), { kind: 'ignore' });
});

test('BL-425: an authorised message in a non-role topic is ignored even from an unauthorised sender - topic-scope is checked before auth', () => {
  const update = mkUpdate({ fromId: 999, chatId: 1, topicId: 999, text: 'anything' });
  assert.deepEqual(decideSteeringAction(update, PRINCIPAL_ID, '1', { coder: 42 }), { kind: 'ignore' });
});

test('BL-425: a textless update (sticker/photo) in a role\'s topic is ignored, never redirected with undefined text', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, chatId: 1, topicId: 42 });
  assert.deepEqual(decideSteeringAction(update, PRINCIPAL_ID, '1', { coder: 42 }), { kind: 'ignore' });
});

// ── decideVoiceUpdateAction (pure) — BL-426 slice 1 ──────────────────────

function operatorSubjectForTopic(topicId) {
  return topicId === 7 ? OPERATOR_SUBJECT_ID : undefined;
}

test('BL-426 audio-voice-note-coordinator-01: a principal voice note in the Operator topic decides to transcribe', () => {
  const update = mkVoiceUpdate({ fromId: PRINCIPAL_ID, chatId: 1, topicId: 7, fileId: 'file-abc' });
  assert.deepEqual(decideVoiceUpdateAction(update, PRINCIPAL_ID, '1', operatorSubjectForTopic), {
    kind: 'transcribe',
    fileId: 'file-abc',
  });
});

test('BL-426: a text message is not-applicable to the voice decision (no voice field at all)', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, chatId: 1, topicId: 7, text: 'hello' });
  assert.deepEqual(decideVoiceUpdateAction(update, PRINCIPAL_ID, '1', operatorSubjectForTopic), { kind: 'not-applicable' });
});

test('BL-426: an update with no message field at all (e.g. a callback-query-only update) is not-applicable, never throws', () => {
  const update = { update_id: 1 };
  assert.deepEqual(decideVoiceUpdateAction(update, PRINCIPAL_ID, '1', operatorSubjectForTopic), { kind: 'not-applicable' });
});

test('BL-426: a voice note in a non-Operator topic is not-applicable (out of scope for slice 1)', () => {
  const update = mkVoiceUpdate({ fromId: PRINCIPAL_ID, chatId: 1, topicId: 99 });
  assert.deepEqual(decideVoiceUpdateAction(update, PRINCIPAL_ID, '1', operatorSubjectForTopic), { kind: 'not-applicable' });
});

test('BL-426 audio-voice-note-coordinator-04: a voice note from a non-principal in the Operator topic is refused', () => {
  const update = mkVoiceUpdate({ fromId: 999, chatId: 1, topicId: 7 });
  assert.deepEqual(decideVoiceUpdateAction(update, PRINCIPAL_ID, '1', operatorSubjectForTopic), { kind: 'refuse' });
});

test('BL-426: a voice note from the principal but a foreign chat is refused (not-my-chat also fails)', () => {
  const update = mkVoiceUpdate({ fromId: PRINCIPAL_ID, chatId: 2, topicId: 7 });
  assert.deepEqual(decideVoiceUpdateAction(update, PRINCIPAL_ID, '1', operatorSubjectForTopic), { kind: 'refuse' });
});

// ── pollAndForward (adapter-injected) ────────────────────────────────────

function stubOpenSubjectAndRecord() {
  return async () => {
    throw new Error('openSubjectAndRecord should not be called for this test');
  };
}

test('pollAndForward posts each accepted update and counts posted/dropped', async () => {
  const posted = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
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
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    nextOffset: (updates, current) => current + updates.length,
  });

  assert.deepEqual(posted, [{ subjectId: 'SUP-1', text: 'accepted' }]);
  assert.equal(result.posted, 1);
  assert.equal(result.dropped, 1);
  assert.equal(result.nextOffset, 2);
});

test('pollAndForward leaves the offset unchanged when the poll itself fails', async () => {
  const result = await pollAndForward(5, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: false, updates: [], error: 'network error' }),
    postToBridge: async () => true,
    subjectForTopic: () => undefined,
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    nextOffset: (_updates, current) => current + 1,
  });
  assert.equal(result.nextOffset, 5);
  assert.equal(result.posted, 0);
});

// ── pollAndForward wiring — BL-425 slice 1 role steering ─────────────────

function stubRedirectToRole() {
  return async () => {
    throw new Error('redirectToRole should not be called for this test');
  };
}

test('BL-425: a role-topic message redirects via redirectToRole, never reaching postToBridge/openSubjectAndRecord', async () => {
  const redirected = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'focus on the edge case' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a role-topic redirect');
    },
    subjectForTopic: () => undefined,
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    readRoleTopicMap: () => ({ coder: 42 }),
    redirectToRole: async (role, text) => {
      redirected.push({ role, text });
    },
  });
  assert.deepEqual(redirected, [{ role: 'coder', text: 'focus on the edge case' }]);
  assert.equal(result.posted, 1);
});

test('BL-425: a message in a non-role topic falls through unaffected to the existing routing when readRoleTopicMap/redirectToRole are wired', async () => {
  const posted = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'an ordinary reply' })] }),
    postToBridge: async (subjectId, text) => {
      posted.push({ subjectId, text });
      return true;
    },
    subjectForTopic: (topicId) => (topicId === 7 ? 'SUP-1' : undefined),
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    readRoleTopicMap: () => ({ coder: 42 }),
    redirectToRole: stubRedirectToRole(),
  });
  assert.deepEqual(posted, [{ subjectId: 'SUP-1', text: 'an ordinary reply' }]);
  assert.equal(result.posted, 1);
});

test('BL-425: an unauthorised sender in a role topic is dropped, never redirected, when steering is wired', async () => {
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: 999, topicId: 42, text: 'let me steer this' })] }),
    postToBridge: async () => true,
    subjectForTopic: () => undefined,
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    readRoleTopicMap: () => ({ coder: 42 }),
    redirectToRole: stubRedirectToRole(),
  });
  assert.equal(result.posted, 0);
  assert.equal(result.dropped, 1);
});

test('BL-425: pollAndForward behaves exactly as before when readRoleTopicMap/redirectToRole are absent (pre-BL-425 fixtures keep working)', async () => {
  const posted = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'no steering wired' })] }),
    postToBridge: async (subjectId, text) => {
      posted.push({ subjectId, text });
      return true;
    },
    subjectForTopic: () => undefined,
    openSubjectAndRecord: async () => 'SUP-99',
  });
  assert.equal(result.posted, 1);
  assert.equal(posted.length, 0, 'expected the open-for-topic path (no subject mapped), not postToBridge');
});

// ── pollAndForward wiring — BL-426 slice 1 coordinator voice round-trip ──

test('BL-426 audio-voice-note-coordinator-01: a principal voice note in the Operator topic is transcribed and delivered as text', async () => {
  const posted = [];
  const marked = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkVoiceUpdate({ fromId: PRINCIPAL_ID, topicId: 7, fileId: 'file-abc' })] }),
    postToBridge: async (subjectId, text) => {
      posted.push({ subjectId, text });
      return true;
    },
    subjectForTopic: operatorSubjectForTopic,
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    transcribeVoice: async (fileId) => {
      assert.equal(fileId, 'file-abc');
      return { kind: 'ok', transcript: 'what is the status of BL-400' };
    },
    markVoiceOriginatedTurn: async (subjectId) => {
      marked.push(subjectId);
    },
  });
  assert.deepEqual(posted, [{ subjectId: OPERATOR_SUBJECT_ID, text: 'what is the status of BL-400' }]);
  assert.deepEqual(marked, [OPERATOR_SUBJECT_ID]);
  assert.equal(result.posted, 1);
});

test('BL-426: a failed bridge post for a transcribed voice note never marks the turn voice-originated', async () => {
  const marked = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkVoiceUpdate({ fromId: PRINCIPAL_ID, topicId: 7, fileId: 'file-abc' })] }),
    postToBridge: async () => false,
    subjectForTopic: operatorSubjectForTopic,
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    transcribeVoice: async () => ({ kind: 'ok', transcript: 'what is the status of BL-400' }),
    markVoiceOriginatedTurn: async (subjectId) => {
      marked.push(subjectId);
    },
  });
  assert.deepEqual(marked, []);
  assert.equal(result.failed, 1);
  assert.equal(result.posted, 0);
});

test('BL-426: a successfully delivered transcribed voice note never throws when markVoiceOriginatedTurn is not wired', async () => {
  const posted = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkVoiceUpdate({ fromId: PRINCIPAL_ID, topicId: 7, fileId: 'file-abc' })] }),
    postToBridge: async (subjectId, text) => {
      posted.push({ subjectId, text });
      return true;
    },
    subjectForTopic: operatorSubjectForTopic,
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    transcribeVoice: async () => ({ kind: 'ok', transcript: 'what is the status of BL-400' }),
  });
  assert.equal(posted.length, 1);
  assert.equal(result.posted, 1);
});

test('BL-426 audio-voice-note-coordinator-03: a text message in the Operator topic still delivers as text, never invoking transcribeVoice', async () => {
  const posted = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'what is the status' })] }),
    postToBridge: async (subjectId, text) => {
      posted.push({ subjectId, text });
      return true;
    },
    subjectForTopic: operatorSubjectForTopic,
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    transcribeVoice: async () => {
      throw new Error('transcribeVoice should not be called for a text message');
    },
  });
  assert.deepEqual(posted, [{ subjectId: OPERATOR_SUBJECT_ID, text: 'what is the status' }]);
  assert.equal(result.posted, 1);
});

test('BL-426 audio-voice-note-coordinator-04: a voice note from a non-principal is dropped, never invoking transcribeVoice', async () => {
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkVoiceUpdate({ fromId: 999, topicId: 7 })] }),
    postToBridge: async () => true,
    subjectForTopic: operatorSubjectForTopic,
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    transcribeVoice: async () => {
      throw new Error('transcribeVoice should not be called for a non-principal sender');
    },
  });
  assert.equal(result.posted, 0);
  assert.equal(result.dropped, 1);
});

test('BL-426 audio-voice-note-coordinator-05: a transient STT failure does not advance the offset past the voice note, and is never dropped', async () => {
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkVoiceUpdate({ fromId: PRINCIPAL_ID, topicId: 7, updateId: 5 })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called when STT fails transiently');
    },
    subjectForTopic: operatorSubjectForTopic,
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    transcribeVoice: async () => ({ kind: 'transient-failure' }),
  });
  assert.equal(result.nextOffset, 0, 'the offset must stay parked at the unadvanced voice note');
  assert.equal(result.failed, 1);
  assert.equal(result.dropped, 0);
  assert.equal(result.posted, 0);
});

test('BL-426 audio-voice-note-coordinator-06: a structurally un-processable voice note is dropped and the offset advances past it', async () => {
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkVoiceUpdate({ fromId: PRINCIPAL_ID, topicId: 7, updateId: 5 })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for an unprocessable voice note');
    },
    subjectForTopic: operatorSubjectForTopic,
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    transcribeVoice: async () => ({ kind: 'unprocessable' }),
  });
  assert.equal(result.nextOffset, 6, 'the offset must advance past a deliberately dropped, un-processable voice note');
  assert.equal(result.dropped, 1);
  assert.equal(result.failed, 0);
});

test('BL-426: a voice note in the Operator topic behaves as a pre-BL-426 no-text drop when transcribeVoice is absent (pre-BL-426 fixtures keep working)', async () => {
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkVoiceUpdate({ fromId: PRINCIPAL_ID, topicId: 7 })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called - voice is not wired');
    },
    subjectForTopic: operatorSubjectForTopic,
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
  });
  assert.equal(result.dropped, 1);
  assert.equal(result.posted, 0);
});

test('BL-389: pollAndForward counts a failed bridge POST as failed, never dropped or posted', async () => {
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'hi' })] }),
    postToBridge: async () => false,
    subjectForTopic: () => 'SUP-1',
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    nextOffset: (updates, current) => current + updates.length,
  });
  assert.equal(result.posted, 0);
  assert.equal(result.dropped, 0);
  assert.equal(result.failed, 1);
});

// ── pollAndForward open-and-record path — BL-294 auto-open-01/02/03 ──────

test('BL-294 auto-open-01: a DM with no default subject yet opens one via openSubjectAndRecord and counts it posted', async () => {
  const opened = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, text: 'hello' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a fresh open - openSubjectAndRecord already delivered it');
    },
    subjectForTopic: () => undefined,
    openSubjectAndRecord: async (topicId, text, updateId) => {
      opened.push({ topicId, text, updateId });
      return 'SUP-500';
    },
    nextOffset: (updates, current) => current + updates.length,
  });
  assert.deepEqual(opened, [{ topicId: undefined, text: 'hello', updateId: 1 }]);
  assert.equal(result.posted, 1);
  assert.equal(result.dropped, 0);
});

test('BL-294 auto-open-02: an unmapped topic opens a subject FOR that topic via openSubjectAndRecord', async () => {
  const opened = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'new topic' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a fresh open');
    },
    subjectForTopic: () => undefined,
    openSubjectAndRecord: async (topicId, text, updateId) => {
      opened.push({ topicId, text, updateId });
      return 'SUP-501';
    },
    nextOffset: (updates, current) => current + updates.length,
  });
  assert.deepEqual(opened, [{ topicId: 42, text: 'new topic', updateId: 1 }]);
  assert.equal(result.posted, 1);
});

// BL-389 rework (architect bounce): openSubjectAndRecord was the one
// adapter BL-389's own idempotency sweep left unprotected - proves the
// update's own update_id is actually threaded through to the adapter (the
// real implementation's own dedup key), not merely accepted and ignored.
test('BL-389 rework: the open-path threads the update\'s own update_id through to openSubjectAndRecord', async () => {
  const opened = [];
  await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [{ update_id: 777, message: { message_id: 777, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, text: 'hello' } }] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a fresh open');
    },
    subjectForTopic: () => undefined,
    openSubjectAndRecord: async (topicId, text, updateId) => {
      opened.push(updateId);
      return 'SUP-777';
    },
  });
  assert.deepEqual(opened, [777]);
});

test('BL-294 auto-open-03: a second message in an already-mapped context posts to the SAME subject, opening no second one', async () => {
  let opens = 0;
  const posted = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({
      success: true,
      updates: [
        mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'first' }),
        mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'second' }),
      ],
    }),
    postToBridge: async (subjectId, text) => {
      posted.push({ subjectId, text });
      return true;
    },
    // Once a context is mapped, subjectForTopic resolves it - this fixture
    // simulates the SECOND update arriving after the map was already
    // updated by the first (mirrors what openSubjectAndRecord's real
    // implementation does between calls).
    subjectForTopic: (topicId) => (topicId === 42 && opens > 0 ? 'SUP-502' : undefined),
    openSubjectAndRecord: async (topicId, text) => {
      opens += 1;
      return 'SUP-502';
    },
    nextOffset: (updates, current) => current + updates.length,
  });
  assert.equal(opens, 1, 'exactly one open per context');
  assert.deepEqual(posted, [{ subjectId: 'SUP-502', text: 'second' }]);
  assert.equal(result.posted, 2);
  assert.equal(result.dropped, 0);
});

// ── pollAndForward operator-context path — BL-298 topic-reply-01/02/03 ───

test('BL-298 topic-reply-01: a reply on a backlog item\'s topic routes to postOperatorContext, never postToBridge/openSubjectAndRecord', async () => {
  const contexts = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'progress update' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === 42 ? 'BL-123' : undefined),
    postOperatorContext: async (backlogId, text) => {
      contexts.push({ backlogId, text });
      return true;
    },
    nextOffset: (updates, current) => current + updates.length,
  });
  assert.deepEqual(contexts, [{ backlogId: 'BL-123', text: 'progress update' }]);
  assert.equal(result.posted, 1);
  assert.equal(result.dropped, 0);
});

// ── BL-357: an approval reply flips the ticket's human_approval field ────

test('BL-357: a reply containing "approve" on a backlog item\'s topic also records the approval, alongside the existing operator-context post', async () => {
  const contexts = [];
  const approvals = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'I approve this' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === 42 ? 'BL-123' : undefined),
    postOperatorContext: async (backlogId, text) => {
      contexts.push({ backlogId, text });
      return true;
    },
    recordApprovalReply: async (backlogId) => {
      approvals.push(backlogId);
      return true;
    },
  });
  assert.deepEqual(contexts, [{ backlogId: 'BL-123', text: 'I approve this' }]);
  assert.deepEqual(approvals, ['BL-123']);
  assert.equal(result.posted, 1);
});

// BL-484 decided-ask-closes-02 (per-ticket-topic entry point): a bare-reply
// approval on a ticket's own topic closes the posted ask too - the SAME
// recordApprovalDecisionAndClose routine deliverOperatorContext calls,
// never a divergent edit path from the Approvals-topic reply above.
test('BL-484: an approval reply on a backlog item\'s own topic also closes the posted ask', async () => {
  const editCalls = [];
  await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'I approve this' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === 42 ? 'BL-123' : undefined),
    postOperatorContext: async () => true,
    recordApprovalReply: async () => true,
    readApprovalAskMessage: async (backlogId) => ({ topicId: 800, messageId: 7, text: `${backlogId} needs your approval...` }),
    editApprovalAskMessage: async (topicId, messageId, text) => {
      editCalls.push({ topicId, messageId, text });
      return { success: true };
    },
  });
  assert.equal(editCalls.length, 1);
  assert.ok(editCalls[0].text.includes('-- Approved'));
});

test('BL-357: an ordinary reply with no approval keyword posts operator context but never calls recordApprovalReply', async () => {
  const approvals = [];
  await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'still working on it' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === 42 ? 'BL-123' : undefined),
    postOperatorContext: async () => true,
    recordApprovalReply: async (backlogId) => {
      approvals.push(backlogId);
      return true;
    },
  });
  assert.deepEqual(approvals, []);
});

// ── BL-409: reject/amend extend the approval reply chain ─────────────────

test('BL-409: a "reject <reason>" reply records the rejection reason, alongside the existing operator-context post', async () => {
  const contexts = [];
  const rejections = [];
  const approvals = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'reject bad scope' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === 42 ? 'BL-123' : undefined),
    postOperatorContext: async (backlogId, text) => {
      contexts.push({ backlogId, text });
      return true;
    },
    recordApprovalReply: async (backlogId) => {
      approvals.push(backlogId);
      return true;
    },
    recordRejectionReply: async (backlogId, reason) => {
      rejections.push({ backlogId, reason });
      return true;
    },
  });
  assert.deepEqual(contexts, [{ backlogId: 'BL-123', text: 'reject bad scope' }]);
  assert.deepEqual(rejections, [{ backlogId: 'BL-123', reason: 'bad scope' }]);
  assert.deepEqual(approvals, []);
  assert.equal(result.posted, 1);
});

test('BL-409: an "amend <note>" reply posts only the note as operator context and changes no approval state', async () => {
  const contexts = [];
  const rejections = [];
  const approvals = [];
  await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({
      success: true,
      updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'amend tighten the acceptance criteria' })],
    }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === 42 ? 'BL-123' : undefined),
    postOperatorContext: async (backlogId, text) => {
      contexts.push({ backlogId, text });
      return true;
    },
    recordApprovalReply: async (backlogId) => {
      approvals.push(backlogId);
      return true;
    },
    recordRejectionReply: async (backlogId, reason) => {
      rejections.push({ backlogId, reason });
      return true;
    },
  });
  assert.deepEqual(contexts, [{ backlogId: 'BL-123', text: 'tighten the acceptance criteria' }]);
  assert.deepEqual(approvals, []);
  assert.deepEqual(rejections, []);
});

test('BL-409: an approve reply still never calls recordRejectionReply (priority-order regression guard)', async () => {
  const rejections = [];
  const approvals = [];
  await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'approve' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === 42 ? 'BL-123' : undefined),
    postOperatorContext: async () => true,
    recordApprovalReply: async (backlogId) => {
      approvals.push(backlogId);
      return true;
    },
    recordRejectionReply: async (backlogId, reason) => {
      rejections.push({ backlogId, reason });
      return true;
    },
  });
  assert.deepEqual(approvals, ['BL-123']);
  assert.deepEqual(rejections, []);
});

test('BL-357: an approval reply on a SUP-### subject topic (not a backlog item) never calls recordApprovalReply', async () => {
  const approvals = [];
  await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'approved' })] }),
    postToBridge: async () => true,
    openSubjectAndRecord: async () => 'SUP-500',
    subjectForTopic: (topicId) => (topicId === 7 ? 'SUP-500' : undefined),
    backlogForTopic: () => undefined,
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for a SUP-### subject topic');
    },
    recordApprovalReply: async (backlogId) => {
      approvals.push(backlogId);
      return true;
    },
  });
  assert.deepEqual(approvals, []);
});

// ── BL-434 approvals-standing-topic-01/02/03: Approvals-topic reply delivery ──

test('BL-434 approvals-standing-topic-02: "approve <id>" in the Approvals topic records approve for that exact ticket', async () => {
  const approvals = [];
  const notified = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 750, text: 'approve BL-433' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for an Approvals-topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for an Approvals-topic reply');
    },
    subjectForTopic: (topicId) => (topicId === 750 ? APPROVALS_SUBJECT_ID : undefined),
    backlogForTopic: () => undefined,
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for an Approvals-topic reply');
    },
    recordApprovalReply: async (backlogId) => {
      approvals.push(backlogId);
      return true;
    },
    recordRejectionReply: async () => {
      throw new Error('recordRejectionReply should not be called for an approve reply');
    },
    notifyApprovalsTopic: async (topicId, text) => {
      notified.push({ topicId, text });
      return true;
    },
  });
  assert.deepEqual(approvals, ['BL-433']);
  assert.deepEqual(notified, [], 'a successful approve needs no surfacing reply');
  assert.equal(result.posted, 1);
  assert.equal(result.dropped, 0);
});

test('BL-434 approvals-standing-topic-02: "reject <id> <reason>" in the Approvals topic records reject for that exact ticket, with the reason', async () => {
  const rejections = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 750, text: 'reject BL-433 no good' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for an Approvals-topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for an Approvals-topic reply');
    },
    subjectForTopic: (topicId) => (topicId === 750 ? APPROVALS_SUBJECT_ID : undefined),
    backlogForTopic: () => undefined,
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for an Approvals-topic reply');
    },
    recordApprovalReply: async () => {
      throw new Error('recordApprovalReply should not be called for a reject reply');
    },
    recordRejectionReply: async (backlogId, reason) => {
      rejections.push({ backlogId, reason });
      return true;
    },
  });
  assert.deepEqual(rejections, [{ backlogId: 'BL-433', reason: 'no good' }]);
  assert.equal(result.posted, 1);
});

// BL-484 decided-ask-closes-02: a typed-reply decision closes the posted
// ask exactly the way a button tap does - proves the Approvals-topic reply
// path routes through the SAME recordApprovalDecisionAndClose routine as
// processCallbackQuery above, never a second, divergent edit path.
test('BL-484: "reject <id> <reason>" in the Approvals topic closes the posted ask - strips buttons, appends the Rejected verdict + reason', async () => {
  const editCalls = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 750, text: 'reject BL-484 bad scope' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for an Approvals-topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for an Approvals-topic reply');
    },
    subjectForTopic: (topicId) => (topicId === 750 ? APPROVALS_SUBJECT_ID : undefined),
    backlogForTopic: () => undefined,
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for an Approvals-topic reply');
    },
    recordApprovalReply: async () => {
      throw new Error('recordApprovalReply should not be called for a reject reply');
    },
    recordRejectionReply: async () => true,
    readApprovalAskMessage: async (backlogId) => ({ topicId: 800, messageId: 42, text: `${backlogId} needs your approval...` }),
    editApprovalAskMessage: async (topicId, messageId, text) => {
      editCalls.push({ topicId, messageId, text });
      return { success: true };
    },
  });
  assert.deepEqual(editCalls, [{ topicId: 800, messageId: 42, text: 'BL-484 needs your approval...\n-- Rejected: bad scope' }]);
  assert.equal(result.posted, 1);
});

test('BL-434 approvals-standing-topic-03: "approve <id>" for a ticket that is NOT currently pending is surfaced, never applied', async () => {
  const approvals = [];
  const notified = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 750, text: 'approve BL-999' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for an Approvals-topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for an Approvals-topic reply');
    },
    subjectForTopic: (topicId) => (topicId === 750 ? APPROVALS_SUBJECT_ID : undefined),
    backlogForTopic: () => undefined,
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for an Approvals-topic reply');
    },
    // recordApprovalReply's own no-op contract: false means "not pending / no
    // matching ticket" - never a second pending-check adapter.
    recordApprovalReply: async (backlogId) => {
      approvals.push(backlogId);
      return false;
    },
    notifyApprovalsTopic: async (topicId, text) => {
      notified.push({ topicId, text });
      return true;
    },
  });
  assert.deepEqual(approvals, ['BL-999'], 'recordApprovalReply IS called - it is the one that determines pending-ness, but its write is a no-op');
  assert.equal(notified.length, 1);
  assert.equal(notified[0].topicId, 750);
  assert.match(notified[0].text, /BL-999/);
  assert.match(notified[0].text, /isn't awaiting approval/);
  assert.equal(result.posted, 0);
  assert.equal(result.dropped, 1, 'a not-currently-pending id is a deliberate drop, never a retryable failure');
  assert.equal(result.failed, 0);
});

test('BL-434 approvals-standing-topic-01: a reply in the Approvals topic naming no recognizable verb+id is dropped, never crashes, never calls record*', async () => {
  const approvals = [];
  const rejections = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 750, text: 'what is happening here' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for an Approvals-topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for an Approvals-topic reply');
    },
    subjectForTopic: (topicId) => (topicId === 750 ? APPROVALS_SUBJECT_ID : undefined),
    backlogForTopic: () => undefined,
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for an Approvals-topic reply');
    },
    recordApprovalReply: async (backlogId) => {
      approvals.push(backlogId);
      return true;
    },
    recordRejectionReply: async (backlogId, reason) => {
      rejections.push({ backlogId, reason });
      return true;
    },
  });
  assert.deepEqual(approvals, []);
  assert.deepEqual(rejections, []);
  assert.equal(result.dropped, 1);
});

test('BL-434: an Approvals-topic reply degrades to a silent drop when notifyApprovalsTopic is not wired (optional-adapter convention)', async () => {
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 750, text: 'approve BL-999' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for an Approvals-topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for an Approvals-topic reply');
    },
    subjectForTopic: (topicId) => (topicId === 750 ? APPROVALS_SUBJECT_ID : undefined),
    backlogForTopic: () => undefined,
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for an Approvals-topic reply');
    },
    recordApprovalReply: async () => false,
    // notifyApprovalsTopic deliberately omitted.
  });
  assert.equal(result.dropped, 1);
});

// ── BL-450 recert-telegram-03..08: Recert-topic reply delivery ───────────

function recertPollAdapters(overrides = {}) {
  return {
    chatId: '1',
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a Recert-topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a Recert-topic reply');
    },
    subjectForTopic: (topicId) => (topicId === 900 ? RECERT_SUBJECT_ID : undefined),
    backlogForTopic: () => undefined,
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for a Recert-topic reply');
    },
    ...overrides,
  };
}

test('recert-telegram-03: "validate <id>" for the scenario currently up for recert records the validation', async () => {
  const validated = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    recertPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: 'validate BL-207-thing-01' })] }),
      recordRecertValidate: async (scenarioId) => {
        validated.push(scenarioId);
        return true;
      },
    })
  );
  assert.deepEqual(validated, ['BL-207-thing-01']);
  assert.equal(result.posted, 1);
  assert.equal(result.dropped, 0);
});

test('recert-telegram-04: a reply to amend a scenario queues an update proposal carrying the new text, never records a validation', async () => {
  const amends = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    recertPollAdapters({
      getUpdates: async () => ({
        success: true,
        updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: 'amend BL-207-thing-01 Given a revised precondition' })],
      }),
      recordRecertValidate: async () => {
        throw new Error('recordRecertValidate should not be called for an amend reply');
      },
      queueRecertAmendProposal: async (scenarioId, newText) => {
        amends.push({ scenarioId, newText });
        return true;
      },
    })
  );
  assert.deepEqual(amends, [{ scenarioId: 'BL-207-thing-01', newText: 'Given a revised precondition' }]);
  assert.equal(result.posted, 1);
});

test('recert-telegram-05: "delete <id>" for a scenario up for recert arms the confirmation gate but queues nothing yet', async () => {
  const notified = [];
  const queued = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    recertPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: 'delete BL-207-thing-01' })] }),
      isScenarioUpForRecert: async () => true,
      queueRecertDeleteProposal: async (scenarioId) => {
        queued.push(scenarioId);
        return true;
      },
      setPendingRecertDelete: async (scenarioId) => {
        notified.push({ armed: scenarioId });
      },
      notifyRecertTopic: async (topicId, text) => {
        notified.push({ topicId, text });
        return true;
      },
    })
  );
  assert.deepEqual(queued, [], 'expected no delete proposal queued yet - only the confirmation gate is armed');
  assert.ok(notified.some((n) => n.armed === 'BL-207-thing-01'), 'expected the pending-delete marker armed for BL-207-thing-01');
  assert.ok(notified.some((n) => n.topicId === 900 && /confirm/i.test(n.text)), 'expected a confirmation request posted into the Recert topic');
  assert.equal(result.posted, 1);
});

test('recert-telegram-06: confirming a pending delete queues a delete proposal for that scenario', async () => {
  let pending = 'BL-207-thing-01';
  const cleared = [];
  const queued = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    recertPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: 'confirm' })] }),
      getPendingRecertDelete: async () => pending,
      clearPendingRecertDelete: async () => {
        cleared.push(pending);
        pending = undefined;
      },
      queueRecertDeleteProposal: async (scenarioId) => {
        queued.push(scenarioId);
        return true;
      },
    })
  );
  assert.deepEqual(queued, ['BL-207-thing-01']);
  assert.deepEqual(cleared, ['BL-207-thing-01'], 'expected the pending marker cleared before/at confirmation, never left armed');
  assert.equal(result.posted, 1);
});

test('a bare "confirm" with no pending delete is a silent drop - nothing to confirm', async () => {
  const queued = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    recertPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: 'confirm' })] }),
      getPendingRecertDelete: async () => undefined,
      queueRecertDeleteProposal: async (scenarioId) => {
        queued.push(scenarioId);
        return true;
      },
    })
  );
  assert.deepEqual(queued, []);
  assert.equal(result.dropped, 1);
});

test('recert-telegram-07: "validate <id>" for a scenario not currently up for recert is surfaced, never applied', async () => {
  const validated = [];
  const notified = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    recertPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: 'validate BL-999-ghost-01' })] }),
      recordRecertValidate: async (scenarioId) => {
        validated.push(scenarioId);
        return false;
      },
      notifyRecertTopic: async (topicId, text) => {
        notified.push({ topicId, text });
        return true;
      },
    })
  );
  assert.deepEqual(validated, ['BL-999-ghost-01'], 'recordRecertValidate IS called - it is the one that determines up-for-recert-ness, but its write is a no-op');
  assert.equal(notified.length, 1);
  assert.equal(notified[0].topicId, 900);
  assert.match(notified[0].text, /BL-999-ghost-01/);
  assert.match(notified[0].text, /isn't awaiting recertification/);
  assert.equal(result.posted, 0);
  assert.equal(result.dropped, 1, 'a not-currently-up-for-recert id is a deliberate drop, never a retryable failure');
  assert.equal(result.failed, 0);
});

test('a reply in the Recert topic naming no recognizable verb+id is dropped, never crashes, never calls a writer', async () => {
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    recertPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: 'looks fine to me' })] }),
      recordRecertValidate: async () => {
        throw new Error('recordRecertValidate should not be called for an unrecognized reply');
      },
    })
  );
  assert.equal(result.dropped, 1);
});

test('a Recert-topic reply degrades to a silent drop when notifyRecertTopic is not wired (optional-adapter convention)', async () => {
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    recertPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: 'validate BL-999-ghost-01' })] }),
      recordRecertValidate: async () => false,
      // notifyRecertTopic deliberately omitted.
    })
  );
  assert.equal(result.dropped, 1);
});

test('BL-298 topic-reply-02: a SUP-### subject\'s topic still posts via postToBridge (no regression), never postOperatorContext', async () => {
  const posted = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'any update?' })] }),
    postToBridge: async (subjectId, text) => {
      posted.push({ subjectId, text });
      return true;
    },
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    subjectForTopic: (topicId) => (topicId === 7 ? 'SUP-1' : undefined),
    backlogForTopic: () => {
      throw new Error('backlogForTopic should not even be consulted once subjectForTopic resolves');
    },
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for a SUP-### subject topic');
    },
    nextOffset: (updates, current) => current + updates.length,
  });
  assert.deepEqual(posted, [{ subjectId: 'SUP-1', text: 'any update?' }]);
  assert.equal(result.posted, 1);
});

test('BL-298 topic-reply-03: a non-principal reply on a backlog item\'s topic is dropped - reaches neither the Operator nor a thread', async () => {
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: 999, topicId: 42, text: 'let me in' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a non-principal reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a non-principal reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: () => 'BL-123',
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for a non-principal reply');
    },
    nextOffset: (updates, current) => current + updates.length,
  });
  assert.equal(result.posted, 0);
  assert.equal(result.dropped, 1);
});

// ── BL-410: inline-keyboard buttons extend the approval-reply chain ──────

// ── decideCallbackQueryAction (pure) ─────────────────────────────────────

test('BL-410: decideCallbackQueryAction resolves an Approve tap', () => {
  const cq = mkCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'approve:BL-123' }).callback_query;
  assert.deepEqual(decideCallbackQueryAction(cq, PRINCIPAL_ID, '1'), { action: 'approve', backlogId: 'BL-123' });
});

test('BL-410: decideCallbackQueryAction resolves a Reject tap as awaiting a follow-up reason', () => {
  const cq = mkCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'reject:BL-123' }).callback_query;
  assert.deepEqual(decideCallbackQueryAction(cq, PRINCIPAL_ID, '1'), { action: 'await-followup', backlogId: 'BL-123', kind: 'reject' });
});

test('BL-410: decideCallbackQueryAction resolves an Amend tap as awaiting a follow-up note', () => {
  const cq = mkCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'amend:BL-123' }).callback_query;
  assert.deepEqual(decideCallbackQueryAction(cq, PRINCIPAL_ID, '1'), { action: 'await-followup', backlogId: 'BL-123', kind: 'amend' });
});

test('BL-410: decideCallbackQueryAction drops a tap from a foreign chat as not-my-chat', () => {
  const cq = mkCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'approve:BL-123', chatId: 2 }).callback_query;
  assert.deepEqual(decideCallbackQueryAction(cq, PRINCIPAL_ID, '1'), { action: 'drop', reason: 'not-my-chat' });
});

test('BL-410: decideCallbackQueryAction drops a tap from a non-principal sender as not-principal', () => {
  const cq = mkCallbackUpdate({ fromId: 999, data: 'approve:BL-123' }).callback_query;
  assert.deepEqual(decideCallbackQueryAction(cq, PRINCIPAL_ID, '1'), { action: 'drop', reason: 'not-principal' });
});

test('BL-410: decideCallbackQueryAction checks not-my-chat before not-principal, same guard order as decideUpdateAction, when both hold', () => {
  const cq = mkCallbackUpdate({ fromId: 999, data: 'approve:BL-123', chatId: 2 }).callback_query;
  assert.deepEqual(decideCallbackQueryAction(cq, PRINCIPAL_ID, '1'), { action: 'drop', reason: 'not-my-chat' });
});

test('BL-410: decideCallbackQueryAction drops unrecognized/stale callback data as unrecognized-data', () => {
  const cq = mkCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'snooze:BL-123' }).callback_query;
  assert.deepEqual(decideCallbackQueryAction(cq, PRINCIPAL_ID, '1'), { action: 'drop', reason: 'unrecognized-data' });
});

test('BL-410: decideCallbackQueryAction drops a callback with no data at all', () => {
  const cq = mkCallbackUpdate({ fromId: PRINCIPAL_ID }).callback_query;
  assert.deepEqual(decideCallbackQueryAction(cq, PRINCIPAL_ID, '1'), { action: 'drop', reason: 'unrecognized-data' });
});

// ── BL-483: decideCallbackQueryAction resolves an ask-option tap ─────────

test('BL-483: decideCallbackQueryAction resolves a tapped ask option to its thread and index', () => {
  const cq = mkCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'ask:SUP-42:1' }).callback_query;
  assert.deepEqual(decideCallbackQueryAction(cq, PRINCIPAL_ID, '1'), { action: 'answer-ask', threadId: 'SUP-42', optionIndex: 1 });
});

test('BL-483: decideCallbackQueryAction resolves an ask-option tap at index 0', () => {
  const cq = mkCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'ask:SUP-42:0' }).callback_query;
  assert.deepEqual(decideCallbackQueryAction(cq, PRINCIPAL_ID, '1'), { action: 'answer-ask', threadId: 'SUP-42', optionIndex: 0 });
});

test('BL-483: decideCallbackQueryAction still checks not-my-chat/not-principal before an ask-option tap', () => {
  const foreignChat = mkCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'ask:SUP-42:0', chatId: 2 }).callback_query;
  assert.deepEqual(decideCallbackQueryAction(foreignChat, PRINCIPAL_ID, '1'), { action: 'drop', reason: 'not-my-chat' });
  const foreignSender = mkCallbackUpdate({ fromId: 999, data: 'ask:SUP-42:0' }).callback_query;
  assert.deepEqual(decideCallbackQueryAction(foreignSender, PRINCIPAL_ID, '1'), { action: 'drop', reason: 'not-principal' });
});

// ── BL-483: composeAskMessageBody / composeAskButtons (pure) ─────────────

test('BL-483: composeAskMessageBody lists each option with its description and states the free-text fallback', () => {
  const body = composeAskMessageBody('Which environment?', [
    { label: 'staging', description: 'the pre-prod environment' },
    { label: 'prod', description: 'the live environment' },
  ]);
  assert.match(body, /Which environment\?/);
  assert.match(body, /staging/);
  assert.match(body, /the pre-prod environment/);
  assert.match(body, /prod/);
  assert.match(body, /the live environment/);
  assert.match(body, /reply with your own answer/i);
});

test('BL-483: composeAskMessageBody omits a missing description without leaving a dangling separator', () => {
  const body = composeAskMessageBody('Pick one', [{ label: 'only-option' }]);
  assert.match(body, /only-option/);
  assert.doesNotMatch(body, /only-option\s*[—-]\s*$/m);
});

test('BL-483: composeAskButtons renders one button per option, one option per row, callback_data carries the ask id + index (never the label)', () => {
  const buttons = composeAskButtons('SUP-42', [{ label: 'staging' }, { label: 'prod' }]);
  assert.deepEqual(buttons, [
    [{ text: 'staging', callbackData: 'ask:SUP-42:0' }],
    [{ text: 'prod', callbackData: 'ask:SUP-42:1' }],
  ]);
});

// ── pollAndForward: callback_query dispatch (adapter-injected) ───────────

function callbackFixtureAdapters(overrides = {}) {
  return {
    chatId: '1',
    getUpdates: async () => ({
      success: true,
      updates: [mkCallbackUpdate(overrides.update ?? { fromId: PRINCIPAL_ID, data: overrides.data })],
    }),
    postToBridge:
      overrides.postToBridge ??
      (async () => {
        throw new Error('postToBridge should not be called for an approve/reject/amend callback_query');
      }),
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a callback_query');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: () => undefined,
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for a bare callback_query (no reply text)');
    },
    recordApprovalReply: overrides.recordApprovalReply ?? (async () => true),
    recordRejectionReply: overrides.recordRejectionReply ?? (async () => true),
    setPendingButtonAction: overrides.setPendingButtonAction ?? (async () => {}),
    answerCallbackQuery: overrides.answerCallbackQuery ?? (async () => {}),
    readRecordedApprovalVerdict: overrides.readRecordedApprovalVerdict,
    readApprovalAskMessage: overrides.readApprovalAskMessage,
    editApprovalAskMessage: overrides.editApprovalAskMessage,
    // BL-483: an ask-option tap's own resolution/close adapters - all
    // optional, same "absent degrades to a no-op/proceeds" posture as every
    // other optional PollAdapters field above.
    resolveAskOptions: overrides.resolveAskOptions,
    readAskMessage: overrides.readAskMessage,
    editAskMessage: overrides.editAskMessage,
  };
}

test('BL-410: an Approve tap records the approval and answers the callback, counted as posted', async () => {
  const approvals = [];
  const answered = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'approve:BL-123',
      recordApprovalReply: async (backlogId) => {
        approvals.push(backlogId);
        return true;
      },
      answerCallbackQuery: async (id) => {
        answered.push(id);
      },
    })
  );
  assert.deepEqual(approvals, ['BL-123']);
  assert.deepEqual(answered, ['cbq-1']);
  assert.equal(result.posted, 1);
});

test('BL-410: a Reject tap stashes the pending reason-awaited marker, never calling recordRejectionReply itself', async () => {
  const pending = [];
  const rejections = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'reject:BL-123',
      setPendingButtonAction: async (backlogId, kind) => {
        pending.push({ backlogId, kind });
      },
      recordRejectionReply: async (backlogId, reason) => {
        rejections.push({ backlogId, reason });
        return true;
      },
    })
  );
  assert.deepEqual(pending, [{ backlogId: 'BL-123', kind: 'reject' }]);
  assert.deepEqual(rejections, [], 'the reason is not in hand yet - only a typed/pending-derived follow-up reply may call recordRejectionReply');
});

test('BL-410: an Amend tap stashes the pending note-awaited marker', async () => {
  const pending = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'amend:BL-123',
      setPendingButtonAction: async (backlogId, kind) => {
        pending.push({ backlogId, kind });
      },
    })
  );
  assert.deepEqual(pending, [{ backlogId: 'BL-123', kind: 'amend' }]);
});

test('BL-410: a non-principal tap is dropped and NEVER answered (its spinner is not this bot\'s to clear)', async () => {
  const answered = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      update: { fromId: 999, data: 'approve:BL-123' },
      answerCallbackQuery: async (id) => answered.push(id),
    })
  );
  assert.deepEqual(answered, []);
  assert.equal(result.dropped, 1);
});

test('BL-410: every recognized-chat/principal tap answers the spinner, even a no-op/unrecognized one (the "never hangs" requirement)', async () => {
  const answered = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'snooze:BL-123',
      answerCallbackQuery: async (id) => answered.push(id),
    })
  );
  assert.deepEqual(answered, ['cbq-1']);
});

// ── BL-483: a tapped ask-option button routes back as the answer, through
// the SAME postToBridge path a typed reply takes (BL-466's poll answer
// used the identical call) - one effect path, never a second one.
// resolveAskOptions doubles as the staleness check - undefined means this
// thread's ask is no longer the pending one (answered/retracted/superseded
// - "ONE pending question at a time" is the awaiting-answer store's own
// contract), the SAME "undefined collapses every closed case" posture
// resolvePollThread already established for an unknown/stale poll id. ────

test('BL-483: a tap on an open ask resolves the option label, answers via postToBridge (same path as a typed reply), and answers the spinner', async () => {
  const bridged = [];
  const answered = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'ask:SUP-42:1',
      resolveAskOptions: async (threadId) => (threadId === 'SUP-42' ? [{ label: 'staging' }, { label: 'prod' }] : undefined),
      postToBridge: async (threadId, text, updateId) => {
        bridged.push({ threadId, text, updateId });
        return true;
      },
      answerCallbackQuery: async (id) => answered.push(id),
    })
  );
  assert.deepEqual(bridged, [{ threadId: 'SUP-42', text: 'prod', updateId: 1 }]);
  assert.deepEqual(answered, ['cbq-1']);
  assert.equal(result.posted, 1);
});

test('BL-483: the ask message is updated to show it was answered', async () => {
  const edits = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'ask:SUP-42:0',
      resolveAskOptions: async () => [{ label: 'staging' }],
      postToBridge: async () => true,
      readAskMessage: async () => ({ topicId: 800, messageId: 900, text: 'Which environment?\n\n1. staging' }),
      editAskMessage: async (topicId, messageId, text) => {
        edits.push({ topicId, messageId, text });
        return true;
      },
    })
  );
  assert.equal(edits.length, 1);
  assert.equal(edits[0].topicId, 800);
  assert.equal(edits[0].messageId, 900);
  assert.match(edits[0].text, /staging/);
  assert.match(edits[0].text, /answered/i);
});

test('BL-483: a postToBridge failure is reported as failed, never edits the message as answered', async () => {
  const edits = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'ask:SUP-42:0',
      resolveAskOptions: async () => [{ label: 'staging' }],
      postToBridge: async () => false,
      readAskMessage: async () => ({ topicId: 800, messageId: 900, text: 'Which environment?' }),
      editAskMessage: async (topicId, messageId, text) => {
        edits.push({ topicId, messageId, text });
        return true;
      },
    })
  );
  assert.equal(result.failed, 1);
  assert.deepEqual(edits, []);
});

test('BL-483: an option index outside the resolved options never fabricates an answer, drops instead', async () => {
  const bridged = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'ask:SUP-42:9',
      resolveAskOptions: async () => [{ label: 'staging' }],
      postToBridge: async (threadId, text) => {
        bridged.push({ threadId, text });
        return true;
      },
    })
  );
  assert.deepEqual(bridged, []);
  assert.equal(result.dropped, 1);
});

test('BL-483: resolveAskOptions absent (pre-BL-483 fixtures) never crashes - the tap is dropped rather than guessing an answer', async () => {
  const bridged = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'ask:SUP-42:0',
      postToBridge: async (threadId, text, updateId) => {
        bridged.push({ threadId, text, updateId });
        return true;
      },
    })
  );
  assert.deepEqual(bridged, [], 'no adapter to resolve the option label from - must never guess or fabricate an answer');
  assert.equal(result.dropped, 1);
});

// ── BL-483: a tap on a retracted/already-answered ask is stale - answered
// with a toast, edited to show it is no longer open, NO side effect. ─────

test('BL-483: a tap on a closed (already-answered/retracted) ask performs no postToBridge side effect', async () => {
  const bridged = [];
  const answered = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'ask:SUP-42:0',
      resolveAskOptions: async () => undefined,
      postToBridge: async (threadId, text, updateId) => {
        bridged.push({ threadId, text, updateId });
        return true;
      },
      answerCallbackQuery: async (id, text) => answered.push({ id, text }),
    })
  );
  assert.deepEqual(bridged, [], 'a stale tap must never record a second, spurious answer');
  assert.equal(answered.length, 1);
  assert.equal(answered[0].id, 'cbq-1');
  assert.match(answered[0].text ?? '', /no longer open|already/i);
  assert.equal(result.dropped, 1);
});

test('BL-483: a tap on a closed ask edits the message to show it is no longer open', async () => {
  const edits = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'ask:SUP-42:0',
      resolveAskOptions: async () => undefined,
      readAskMessage: async () => ({ topicId: 800, messageId: 900, text: 'Which environment?\n\n1. staging' }),
      editAskMessage: async (topicId, messageId, text) => {
        edits.push({ topicId, messageId, text });
        return true;
      },
    })
  );
  assert.equal(edits.length, 1);
  assert.match(edits[0].text, /no longer open|already/i);
});

// ── BL-484: a tap on an ALREADY-DECIDED ask is stale - answered with an
// informative toast naming the recorded verdict, no decision side effect. ──

test('BL-484: an Approve tap on an already-decided (approved) ticket answers with a toast and never records again', async () => {
  const approvals = [];
  const answered = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'approve:BL-123',
      recordApprovalReply: async (backlogId) => {
        approvals.push(backlogId);
        return true;
      },
      answerCallbackQuery: async (id, text) => {
        answered.push({ id, text });
      },
      readRecordedApprovalVerdict: async () => 'approved',
    })
  );
  assert.deepEqual(approvals, [], 'expected no decision side effect on a stale tap');
  assert.deepEqual(answered, [{ id: 'cbq-1', text: 'Already decided: approved' }]);
  assert.equal(result.dropped, 1);
  assert.equal(result.posted, 0);
});

test('BL-484: a Reject tap on an already-decided (rejected) ticket answers with a toast and never stashes a pending marker', async () => {
  const pending = [];
  const answered = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'reject:BL-123',
      setPendingButtonAction: async (backlogId, kind) => {
        pending.push({ backlogId, kind });
      },
      answerCallbackQuery: async (id, text) => {
        answered.push({ id, text });
      },
      readRecordedApprovalVerdict: async () => 'rejected',
    })
  );
  assert.deepEqual(pending, []);
  assert.deepEqual(answered, [{ id: 'cbq-1', text: 'Already decided: rejected' }]);
});

test('BL-484: readRecordedApprovalVerdict absent (pre-BL-484 fixtures) keeps every tap proceeding exactly as before (regression)', async () => {
  const approvals = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'approve:BL-123',
      recordApprovalReply: async (backlogId) => {
        approvals.push(backlogId);
        return true;
      },
    })
  );
  assert.deepEqual(approvals, ['BL-123']);
});

test('BL-484: readRecordedApprovalVerdict returning undefined (still pending) keeps the tap proceeding normally', async () => {
  const approvals = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    callbackFixtureAdapters({
      data: 'approve:BL-123',
      recordApprovalReply: async (backlogId) => {
        approvals.push(backlogId);
        return true;
      },
      readRecordedApprovalVerdict: async () => undefined,
    })
  );
  assert.deepEqual(approvals, ['BL-123']);
});

// ── BL-484: recordApprovalDecisionAndClose - the ONE closing routine
// serving both decision entry points (a button tap above, and a typed
// reply below) ─────────────────────────────────────────────────────────

function closingFixtureAdapters(overrides = {}) {
  const editCalls = [];
  return {
    recordApprovalReply: overrides.recordApprovalReply ?? (async () => true),
    recordRejectionReply: overrides.recordRejectionReply ?? (async () => true),
    readApprovalAskMessage: overrides.readApprovalAskMessage,
    editApprovalAskMessage:
      overrides.editApprovalAskMessage ??
      (async (topicId, messageId, text) => {
        editCalls.push({ topicId, messageId, text });
        return { success: true };
      }),
    // BL-496: pass through only when the test actually supplies one - an
    // absent field means "use closeApprovalAskIfPossible's own production
    // default", the exact posture every other optional PollAdapters field
    // already has.
    waitForAskCloseRetry: overrides.waitForAskCloseRetry,
    askCloseRetryBudget: overrides.askCloseRetryBudget,
    editCalls,
  };
}

test('recordApprovalDecisionAndClose: an approved decision with a stored ask edits it with the buttons-stripped, verdict-appended text', async () => {
  const adapters = closingFixtureAdapters({
    readApprovalAskMessage: async (backlogId) => ({ topicId: 800, messageId: 999, text: `${backlogId} needs your approval...` }),
  });
  const nowMs = Date.UTC(2026, 6, 17, 3, 7);

  const changed = await recordApprovalDecisionAndClose(adapters, 'BL-484', { kind: 'approved' }, nowMs);

  assert.equal(changed, true);
  assert.deepEqual(adapters.editCalls, [
    { topicId: 800, messageId: 999, text: 'BL-484 needs your approval...\n-- Approved 2026-07-17 03:07 UTC' },
  ]);
});

test('BL-496: a successful ask-close edit never writes anything to stderr', async () => {
  const adapters = closingFixtureAdapters({
    readApprovalAskMessage: async (backlogId) => ({ topicId: 800, messageId: 999, text: `${backlogId} needs your approval...` }),
  });
  const originalErrorWrite = process.stderr.write;
  const errors = [];
  process.stderr.write = (chunk) => {
    errors.push(chunk);
    return true;
  };
  try {
    await recordApprovalDecisionAndClose(adapters, 'BL-484', { kind: 'approved' }, 0);
  } finally {
    process.stderr.write = originalErrorWrite;
  }

  assert.equal(errors.length, 0, `expected no stderr output on a successful ask-close edit, got: ${JSON.stringify(errors)}`);
});

test('BL-496: a stored ask message with no editApprovalAskMessage adapter wired at all logs the "not wired" fallback, never crashes', async () => {
  // closingFixtureAdapters' own `??` default always substitutes a
  // succeeding stub for an explicitly-undefined override, so this scenario
  // - the adapter genuinely absent from PollAdapters, a real production
  // possibility (see the pre-BL-484 PollAdapters test above) - is built by
  // hand rather than through that helper.
  const adapters = {
    recordApprovalReply: async () => true,
    recordRejectionReply: async () => true,
    readApprovalAskMessage: async (backlogId) => ({ topicId: 800, messageId: 999, text: `${backlogId} needs your approval...` }),
  };
  const originalErrorWrite = process.stderr.write;
  const errors = [];
  process.stderr.write = (chunk) => {
    errors.push(chunk);
    return true;
  };
  let changed;
  try {
    changed = await recordApprovalDecisionAndClose(adapters, 'BL-484', { kind: 'approved' }, 0);
  } finally {
    process.stderr.write = originalErrorWrite;
  }

  assert.equal(changed, true, 'expected the decision recording to still succeed with no edit adapter wired');
  assert.ok(
    errors.some((e) => e.includes('BL-484') && e.includes('message edit failed or not wired')),
    `expected the "not wired" fallback logged, got: ${JSON.stringify(errors)}`
  );
});

test('recordApprovalDecisionAndClose: a rejected decision appends the reason', async () => {
  const adapters = closingFixtureAdapters({
    readApprovalAskMessage: async (backlogId) => ({ topicId: 800, messageId: 999, text: `${backlogId} needs your approval...` }),
  });

  await recordApprovalDecisionAndClose(adapters, 'BL-484', { kind: 'rejected', reason: 'bad scope' }, 0);

  assert.equal(adapters.editCalls[0].text, 'BL-484 needs your approval...\n-- Rejected: bad scope');
});

test('recordApprovalDecisionAndClose: no stored ask message (never captured) records the decision but attempts no edit, never crashes', async () => {
  const adapters = closingFixtureAdapters({ readApprovalAskMessage: undefined });

  const changed = await recordApprovalDecisionAndClose(adapters, 'BL-484', { kind: 'approved' }, 0);

  assert.equal(changed, true);
  assert.deepEqual(adapters.editCalls, []);
});

test('recordApprovalDecisionAndClose: a decision that was NOT actually pending (recordApprovalReply reports no change) attempts no edit at all', async () => {
  const adapters = closingFixtureAdapters({
    recordApprovalReply: async () => false,
    readApprovalAskMessage: async () => ({ topicId: 800, messageId: 999, text: 'BL-484 needs your approval...' }),
  });

  const changed = await recordApprovalDecisionAndClose(adapters, 'BL-484', { kind: 'approved' }, 0);

  assert.equal(changed, false);
  assert.deepEqual(adapters.editCalls, [], 'expected no edit attempted for a no-op (already-decided) recording');
});

test('recordApprovalDecisionAndClose: a failed message edit is logged and does not throw - the decision recording still succeeded', async () => {
  const adapters = closingFixtureAdapters({
    readApprovalAskMessage: async () => ({ topicId: 800, messageId: 999, text: 'BL-484 needs your approval...' }),
    editApprovalAskMessage: async () => ({ success: false, error: 'Bad Request: message to edit not found' }),
  });
  const originalErrorWrite = process.stderr.write;
  const errors = [];
  process.stderr.write = (chunk) => {
    errors.push(chunk);
    return true;
  };
  let changed;
  try {
    changed = await recordApprovalDecisionAndClose(adapters, 'BL-484', { kind: 'approved' }, 0);
  } finally {
    process.stderr.write = originalErrorWrite;
  }

  assert.equal(changed, true, 'expected the decision recording to still be reported as successful');
  assert.ok(errors.some((e) => e.includes('BL-484')), `expected a failed-edit warning naming the ticket, got: ${JSON.stringify(errors)}`);
});

test('recordApprovalDecisionAndClose: readApprovalAskMessage/editApprovalAskMessage both absent (pre-BL-484 PollAdapters) records the decision and never crashes', async () => {
  const changed = await recordApprovalDecisionAndClose(
    { recordApprovalReply: async () => true, recordRejectionReply: async () => true },
    'BL-484',
    { kind: 'approved' },
    0
  );
  assert.equal(changed, true);
});

// ── BL-496: the ask-close's own bounded, retry_after-honouring retry ─────

test('BL-496 ask-close-rate-limit-01: a non-rate-limit rejection is attempted exactly once and logs the real reason, never retried', async () => {
  let attempts = 0;
  const waits = [];
  const adapters = closingFixtureAdapters({
    readApprovalAskMessage: async () => ({ topicId: 800, messageId: 999, text: 'BL-484 needs your approval...' }),
    editApprovalAskMessage: async () => {
      attempts += 1;
      return { success: false, error: 'Bad Request: message to edit not found' };
    },
    waitForAskCloseRetry: async (ms) => {
      waits.push(ms);
    },
  });
  const originalErrorWrite = process.stderr.write;
  const errors = [];
  process.stderr.write = (chunk) => {
    errors.push(chunk);
    return true;
  };
  try {
    await recordApprovalDecisionAndClose(adapters, 'BL-484', { kind: 'approved' }, 0);
  } finally {
    process.stderr.write = originalErrorWrite;
  }

  assert.equal(attempts, 1, 'expected exactly one edit attempt for a non-rate-limit rejection');
  assert.deepEqual(waits, [], 'expected no wait requested - a non-rate-limit failure is never retried');
  assert.ok(
    errors.some((e) => e.includes('BL-484') && e.includes('Bad Request: message to edit not found')),
    `expected the logged failure to include the real rejection reason, got: ${JSON.stringify(errors)}`
  );
});

test('BL-496 ask-close-rate-limit-02: a rate-limited edit waits the told-you-so retry-after and retries until it succeeds', async () => {
  let attempts = 0;
  const waits = [];
  const adapters = closingFixtureAdapters({
    readApprovalAskMessage: async () => ({ topicId: 800, messageId: 999, text: 'BL-484 needs your approval...' }),
    askCloseRetryBudget: 3,
    editApprovalAskMessage: async (topicId, messageId, text) => {
      attempts += 1;
      if (attempts < 3) {
        return { success: false, retryAfterSeconds: 3 };
      }
      adapters.editCalls.push({ topicId, messageId, text });
      return { success: true };
    },
    waitForAskCloseRetry: async (ms) => {
      waits.push(ms);
    },
  });

  const changed = await recordApprovalDecisionAndClose(adapters, 'BL-484', { kind: 'approved' }, 0);

  assert.equal(changed, true);
  assert.equal(attempts, 3, 'expected 3 total edit attempts (2 failed + 1 succeeded)');
  assert.deepEqual(waits, [3000, 3000], 'expected a 3-second wait requested before each of the 2 retries');
  assert.equal(adapters.editCalls.length, 1, 'expected the message finally edited on the successful attempt');
});

test('BL-496 ask-close-rate-limit-03: a persistently rate-limited edit stops at its bounded budget, logs the undelivered close, and never throws', async () => {
  let attempts = 0;
  const waits = [];
  const adapters = closingFixtureAdapters({
    readApprovalAskMessage: async () => ({ topicId: 800, messageId: 999, text: 'BL-484 needs your approval...' }),
    askCloseRetryBudget: 3,
    editApprovalAskMessage: async () => {
      attempts += 1;
      return { success: false, retryAfterSeconds: 3 };
    },
    waitForAskCloseRetry: async (ms) => {
      waits.push(ms);
    },
  });
  const originalErrorWrite = process.stderr.write;
  const errors = [];
  process.stderr.write = (chunk) => {
    errors.push(chunk);
    return true;
  };
  let changed;
  try {
    changed = await recordApprovalDecisionAndClose(adapters, 'BL-484', { kind: 'approved' }, 0);
  } finally {
    process.stderr.write = originalErrorWrite;
  }

  assert.equal(changed, true, 'expected the decision recording to still succeed despite the undelivered close');
  assert.equal(attempts, 3, 'expected exactly the bounded budget of attempts, never more');
  assert.deepEqual(waits, [3000, 3000], 'expected a wait only BETWEEN attempts, never after the last one');
  assert.ok(
    errors.some((e) => e.includes('BL-484') && /rate.?limit/i.test(e)),
    `expected a loud undelivered-close warning naming the rate limit, got: ${JSON.stringify(errors)}`
  );
});

test('BL-496: an askCloseRetryBudget of 0 (misconfigured) attempts no edit at all and still logs the undelivered close, never throws', async () => {
  let attempts = 0;
  const adapters = closingFixtureAdapters({
    readApprovalAskMessage: async () => ({ topicId: 800, messageId: 999, text: 'BL-484 needs your approval...' }),
    askCloseRetryBudget: 0,
    editApprovalAskMessage: async () => {
      attempts += 1;
      return { success: true };
    },
  });
  const originalErrorWrite = process.stderr.write;
  const errors = [];
  process.stderr.write = (chunk) => {
    errors.push(chunk);
    return true;
  };
  let changed;
  try {
    changed = await recordApprovalDecisionAndClose(adapters, 'BL-484', { kind: 'approved' }, 0);
  } finally {
    process.stderr.write = originalErrorWrite;
  }

  assert.equal(changed, true, 'expected the decision recording to still succeed despite the zero retry budget');
  assert.equal(attempts, 0, 'expected zero edit attempts with a zero budget - the loop must never run');
  assert.ok(errors.some((e) => e.includes('BL-484')), `expected the undelivered close logged, got: ${JSON.stringify(errors)}`);
});

test('BL-496 ask-close-rate-limit-04: three decided asks each rate-limited once then succeeding all close in one burst', async () => {
  async function closeOne(ticketId) {
    const waits = [];
    let attempts = 0;
    const adapters = closingFixtureAdapters({
      readApprovalAskMessage: async () => ({ topicId: 800, messageId: 999, text: `${ticketId} needs your approval...` }),
      askCloseRetryBudget: 3,
      editApprovalAskMessage: async (topicId, messageId, text) => {
        attempts += 1;
        if (attempts === 1) {
          return { success: false, retryAfterSeconds: 2 };
        }
        adapters.editCalls.push({ topicId, messageId, text });
        return { success: true };
      },
      waitForAskCloseRetry: async (ms) => {
        waits.push(ms);
      },
    });
    await recordApprovalDecisionAndClose(adapters, ticketId, { kind: 'approved' }, 0);
    return adapters.editCalls;
  }

  const results = await Promise.all(['BL-491', 'BL-492', 'BL-493'].map(closeOne));

  for (const [i, editCalls] of results.entries()) {
    assert.equal(editCalls.length, 1, `expected ${['BL-491', 'BL-492', 'BL-493'][i]} finally edited exactly once`);
  }
});

// ── pollAndForward: Agent Questions topic reply + poll_answer dispatch — BL-466 ──

function agentQuestionsPollAdapters(overrides = {}) {
  return {
    chatId: '1',
    agentQuestionsTopicId: overrides.agentQuestionsTopicId ?? (async () => 42),
    getPendingAgentQuestionThread: overrides.getPendingAgentQuestionThread ?? (async () => 'SUP-1'),
    postToBridge: overrides.postToBridge ?? (async () => true),
    subjectForTopic: () => undefined,
    backlogForTopic: () => undefined,
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should never open a fresh subject for the reserved Agent Questions topic');
    },
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for an Agent Questions topic reply');
    },
    ...overrides,
  };
}

test('BL-466 agent-question-poll-03: a reply in the Agent Questions topic is delivered as the pending question\'s answer', async () => {
  const posted = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    agentQuestionsPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'staging' })] }),
      postToBridge: async (subjectId, text, updateId) => {
        posted.push({ subjectId, text, updateId });
        return true;
      },
    })
  );
  assert.deepEqual(posted, [{ subjectId: 'SUP-1', text: 'staging', updateId: 1 }]);
  assert.equal(result.posted, 1);
});

test('BL-466: a reply in the Agent Questions topic with no question currently pending is dropped, never opens a fresh subject', async () => {
  const posted = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    agentQuestionsPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'staging' })] }),
      getPendingAgentQuestionThread: async () => undefined,
      postToBridge: async (subjectId, text) => {
        posted.push({ subjectId, text });
        return true;
      },
    })
  );
  assert.deepEqual(posted, []);
  assert.equal(result.dropped, 1);
});

test('BL-466: a non-principal reply in the Agent Questions topic is dropped, never delivered', async () => {
  const posted = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    agentQuestionsPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: 999, topicId: 42, text: 'staging' })] }),
      postToBridge: async (subjectId, text) => {
        posted.push({ subjectId, text });
        return true;
      },
    })
  );
  assert.deepEqual(posted, []);
  assert.equal(result.dropped, 1);
});

test('BL-466: a reply outside the Agent Questions topic is unaffected - falls through to ordinary routing', async () => {
  const posted = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    agentQuestionsPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'any update?' })] }),
      subjectForTopic: (topicId) => (topicId === 7 ? 'SUP-2' : undefined),
      postToBridge: async (subjectId, text) => {
        posted.push({ subjectId, text });
        return true;
      },
    })
  );
  assert.deepEqual(posted, [{ subjectId: 'SUP-2', text: 'any update?' }]);
  assert.equal(result.posted, 1);
});

function mkPollAnswerUpdate({ pollId, optionIds, userId, updateId } = {}) {
  return { update_id: updateId ?? 1, poll_answer: mkPollAnswer({ pollId, optionIds, userId }) };
}

test('BL-466 agent-question-poll-02: a poll vote resolves the selected option and delivers it as the answer', async () => {
  const posted = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkPollAnswerUpdate({ pollId: 'poll-1', optionIds: [1], userId: PRINCIPAL_ID })] }),
    resolvePollThread: async (pollId) => (pollId === 'poll-1' ? { threadId: 'SUP-1', options: ['staging', 'prod'] } : undefined),
    postToBridge: async (subjectId, text, updateId) => {
      posted.push({ subjectId, text, updateId });
      return true;
    },
  });
  assert.deepEqual(posted, [{ subjectId: 'SUP-1', text: 'prod', updateId: 1 }]);
  assert.equal(result.posted, 1);
});

test('BL-466: a poll vote for an unknown/stale poll id is dropped, never delivered', async () => {
  const posted = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkPollAnswerUpdate({ pollId: 'stale-poll', userId: PRINCIPAL_ID })] }),
    resolvePollThread: async () => undefined,
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for an unresolvable poll');
    },
  });
  assert.deepEqual(posted, []);
  assert.equal(result.dropped, 1);
});

test('BL-466: a poll-vote retraction (empty option_ids) is dropped, never delivered', async () => {
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkPollAnswerUpdate({ optionIds: [], userId: PRINCIPAL_ID })] }),
    resolvePollThread: async () => {
      throw new Error('resolvePollThread should not be called for a retraction - there is no selection to resolve');
    },
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a retraction');
    },
  });
  assert.equal(result.dropped, 1);
});

test('BL-466: a poll vote from a non-principal is dropped, never delivered', async () => {
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkPollAnswerUpdate({ userId: 999 })] }),
    resolvePollThread: async () => {
      throw new Error('resolvePollThread should not be called for a non-principal vote');
    },
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a non-principal vote');
    },
  });
  assert.equal(result.dropped, 1);
});

// ── pollAndForward: Control topic verb/callback dispatch — BL-423 ────────

function mkControlCallbackUpdate({ fromId, data, topicId, chatId, callbackId } = {}) {
  return {
    update_id: 1,
    callback_query: { id: callbackId ?? 'ctl-cbq-1', data, from: { id: fromId }, message: { chat: { id: chatId ?? 1 }, message_thread_id: topicId } },
  };
}

function controlPollAdapters(overrides = {}) {
  return {
    chatId: '1',
    controlTopicId: overrides.controlTopicId ?? (async () => 900),
    getPendingControlConfirm: overrides.getPendingControlConfirm ?? (async () => undefined),
    setPendingControlConfirm: overrides.setPendingControlConfirm ?? (async () => {}),
    getPauseState: overrides.getPauseState ?? (async () => ({ active: false })),
    postControlStopModesMenu: overrides.postControlStopModesMenu ?? (async () => {}),
    postControlRestartConfirm: overrides.postControlRestartConfirm ?? (async () => {}),
    postControlCancelled: overrides.postControlCancelled ?? (async () => {}),
    postControlPauseMenu: overrides.postControlPauseMenu ?? (async () => {}),
    executeEmergencyStop: overrides.executeEmergencyStop ?? (async () => {}),
    executeDrainStop: overrides.executeDrainStop ?? (async () => {}),
    executeRestart: overrides.executeRestart ?? (async () => {}),
    applyPause: overrides.applyPause ?? (async () => {}),
    resumeNow: overrides.resumeNow ?? (async () => {}),
    answerCallbackQuery: overrides.answerCallbackQuery ?? (async () => {}),
    subjectForTopic: () => undefined,
    backlogForTopic: () => undefined,
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a Control topic event');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should never open a fresh subject for the reserved Control topic');
    },
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for a Control topic event');
    },
    ...overrides,
  };
}

test('BL-423: an authorised /stop in the Control topic prompts the stop-mode menu and arms the confirm', async () => {
  const armed = [];
  const menus = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: '/stop' })] }),
      setPendingControlConfirm: async (c) => armed.push(c),
      postControlStopModesMenu: async () => menus.push(true),
    })
  );
  assert.deepEqual(armed, [{ kind: 'stop-modes' }]);
  assert.deepEqual(menus, [true]);
  assert.equal(result.posted, 1);
});

test('BL-423: tapping Emergency stop while armed executes the emergency stop and clears the confirm', async () => {
  const cleared = [];
  const executed = [];
  const answered = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({
        success: true,
        updates: [mkControlCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'control:emergency-stop', topicId: 900 })],
      }),
      getPendingControlConfirm: async () => ({ kind: 'stop-modes' }),
      setPendingControlConfirm: async (c) => cleared.push(c),
      executeEmergencyStop: async () => executed.push('emergency'),
      answerCallbackQuery: async (id) => answered.push(id),
    })
  );
  assert.deepEqual(executed, ['emergency']);
  assert.deepEqual(cleared, [undefined]);
  assert.deepEqual(answered, ['ctl-cbq-1']);
  assert.equal(result.posted, 1);
});

test('BL-423: tapping Drain & stop while armed executes the drain stop', async () => {
  const executed = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({
        success: true,
        updates: [mkControlCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'control:drain-stop', topicId: 900 })],
      }),
      getPendingControlConfirm: async () => ({ kind: 'stop-modes' }),
      executeDrainStop: async () => executed.push('drain'),
      executeEmergencyStop: async () => {
        throw new Error('executeEmergencyStop should not fire for a drain-stop tap');
      },
    })
  );
  assert.deepEqual(executed, ['drain']);
});

test('BL-423: an emergency-stop tap with no pending stop-modes confirm never executes (stale/already-actioned)', async () => {
  const executed = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({
        success: true,
        updates: [mkControlCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'control:emergency-stop', topicId: 900 })],
      }),
      executeEmergencyStop: async () => executed.push('emergency'),
    })
  );
  assert.deepEqual(executed, []);
  assert.equal(result.dropped, 1);
});

test('BL-423: cancelling a pending stop confirm clears it and never executes either stop mode', async () => {
  const cleared = [];
  const cancelled = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({
        success: true,
        updates: [mkControlCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'control:cancel', topicId: 900 })],
      }),
      getPendingControlConfirm: async () => ({ kind: 'stop-modes' }),
      setPendingControlConfirm: async (c) => cleared.push(c),
      postControlCancelled: async () => cancelled.push(true),
      executeEmergencyStop: async () => {
        throw new Error('cancel must never execute emergency stop');
      },
      executeDrainStop: async () => {
        throw new Error('cancel must never execute drain stop');
      },
    })
  );
  assert.deepEqual(cleared, [undefined]);
  assert.deepEqual(cancelled, [true]);
});

test('BL-423: an authorised /restart prompts a restart confirm; tapping confirm executes the restart', async () => {
  const armed = [];
  const executed = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: '/restart' })] }),
      setPendingControlConfirm: async (c) => armed.push(c),
    })
  );
  assert.deepEqual(armed, [{ kind: 'restart-confirm' }]);

  await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({
        success: true,
        updates: [mkControlCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'control:confirm-restart', topicId: 900 })],
      }),
      getPendingControlConfirm: async () => ({ kind: 'restart-confirm' }),
      executeRestart: async () => executed.push('restart'),
    })
  );
  assert.deepEqual(executed, ['restart']);
});

test('BL-423: an authorised /pause posts the duration menu without freezing anything yet', async () => {
  const menus = [];
  const applied = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: '/pause' })] }),
      postControlPauseMenu: async () => menus.push(true),
      applyPause: async (d) => applied.push(d),
    })
  );
  assert.deepEqual(menus, [true]);
  assert.deepEqual(applied, []);
});

test('BL-423: picking 15 min applies a timed pause immediately - no separate confirm needed', async () => {
  const applied = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({
        success: true,
        updates: [mkControlCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'control:pause-15m', topicId: 900 })],
      }),
      applyPause: async (d) => applied.push(d),
    })
  );
  assert.deepEqual(applied, [15 * 60 * 1000]);
});

test('BL-423: picking "Until I resume" applies a pause with no duration', async () => {
  const applied = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({
        success: true,
        updates: [mkControlCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'control:pause-until-resume', topicId: 900 })],
      }),
      applyPause: async (d) => applied.push(d),
    })
  );
  assert.deepEqual(applied, [undefined]);
});

test('BL-423: tapping Resume now while paused restores intake', async () => {
  const resumed = [];
  await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({
        success: true,
        updates: [mkControlCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'control:resume-now', topicId: 900 })],
      }),
      getPauseState: async () => ({ active: true, untilMs: 12345 }),
      resumeNow: async () => resumed.push(true),
    })
  );
  assert.deepEqual(resumed, [true]);
});

test('BL-423: an unauthorised sender\'s /stop in the Control topic is refused with no swarm action', async () => {
  const menus = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: 999, topicId: 900, text: '/stop' })] }),
      postControlStopModesMenu: async () => menus.push(true),
    })
  );
  assert.deepEqual(menus, []);
  assert.equal(result.dropped, 1);
});

test('BL-423 guard #4: an unauthorised tap on a control button is refused, spinner never answered, no swarm action', async () => {
  const executed = [];
  const answered = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({
        success: true,
        updates: [mkControlCallbackUpdate({ fromId: 999, data: 'control:emergency-stop', topicId: 900 })],
      }),
      getPendingControlConfirm: async () => ({ kind: 'stop-modes' }),
      executeEmergencyStop: async () => executed.push('emergency'),
      answerCallbackQuery: async (id) => answered.push(id),
    })
  );
  assert.deepEqual(executed, []);
  assert.deepEqual(answered, []);
  assert.equal(result.dropped, 1);
});

test('BL-423: a /stop outside the Control topic is ignored with no swarm action, never falls through to ordinary routing', async () => {
  const menus = [];
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 5, text: '/stop' })] }),
      subjectForTopic: () => undefined,
      postControlStopModesMenu: async () => menus.push(true),
      openSubjectAndRecord: async () => {
        // A stray "/stop" outside the Control topic is ordinary chatter -
        // it legitimately opens a fresh subject via the pre-existing
        // unmapped-topic path, exactly like any other message would.
      },
    })
  );
  assert.deepEqual(menus, []);
  assert.equal(result.posted, 1);
});

test('BL-423: an ordinary chat message in the Control topic (not a recognized verb) is dropped, never opens a fresh subject', async () => {
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 900, text: 'hello there' })] }),
    })
  );
  assert.equal(result.dropped, 1);
});

test('BL-423: a callback tap for an unrelated (approve/reject) button in the Control topic falls through to the ordinary callback dispatch untouched', async () => {
  const result = await pollAndForward(
    0,
    PRINCIPAL_ID,
    controlPollAdapters({
      getUpdates: async () => ({
        success: true,
        updates: [mkControlCallbackUpdate({ fromId: PRINCIPAL_ID, data: 'approve:BL-1', topicId: 900 })],
      }),
      recordApprovalReply: async () => true,
    })
  );
  assert.equal(result.posted, 1);
});

// ── deliverOperatorContext: pending Reject/Amend follow-up consumption ───

// BL-410: clearPendingButtonAction must only ever fire when a marker was
// actually pending - an ordinary reply with nothing pending must never call
// it, even speculatively (it would otherwise write the pending-actions file
// on every single reply, not just the one-shot follow-up it exists for).
test('BL-410: an ordinary reply with nothing pending never calls clearPendingButtonAction', async () => {
  const cleared = [];
  await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'still working on it' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === 42 ? 'BL-123' : undefined),
    postOperatorContext: async () => true,
    recordApprovalReply: async () => true,
    recordRejectionReply: async () => true,
    getPendingButtonAction: async () => undefined,
    clearPendingButtonAction: async (backlogId) => {
      cleared.push(backlogId);
    },
  });
  assert.deepEqual(cleared, []);
});

test('BL-410: a bare reply while a Reject tap is pending is treated as the rejection reason, same effect as typed "reject <reason>"', async () => {
  const contexts = [];
  const rejections = [];
  const pending = { 'BL-123': 'reject' };
  await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'bad scope' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === 42 ? 'BL-123' : undefined),
    postOperatorContext: async (backlogId, text) => {
      contexts.push({ backlogId, text });
      return true;
    },
    recordApprovalReply: async () => true,
    recordRejectionReply: async (backlogId, reason) => {
      rejections.push({ backlogId, reason });
      return true;
    },
    getPendingButtonAction: async (backlogId) => pending[backlogId],
    clearPendingButtonAction: async (backlogId) => {
      delete pending[backlogId];
    },
  });
  assert.deepEqual(rejections, [{ backlogId: 'BL-123', reason: 'bad scope' }]);
  assert.deepEqual(contexts, [{ backlogId: 'BL-123', text: 'bad scope' }]);
  assert.deepEqual(pending, {}, 'the one-shot pending marker must be cleared once consumed');
});

test('BL-410: a bare reply while an Amend tap is pending is treated as the amendment note, same effect as typed "amend <note>"', async () => {
  const contexts = [];
  const approvals = [];
  const rejections = [];
  const pending = { 'BL-123': 'amend' };
  await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({
      success: true,
      updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'tighten the acceptance criteria' })],
    }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === 42 ? 'BL-123' : undefined),
    postOperatorContext: async (backlogId, text) => {
      contexts.push({ backlogId, text });
      return true;
    },
    recordApprovalReply: async (backlogId) => {
      approvals.push(backlogId);
      return true;
    },
    recordRejectionReply: async (backlogId, reason) => {
      rejections.push({ backlogId, reason });
      return true;
    },
    getPendingButtonAction: async (backlogId) => pending[backlogId],
    clearPendingButtonAction: async (backlogId) => {
      delete pending[backlogId];
    },
  });
  assert.deepEqual(contexts, [{ backlogId: 'BL-123', text: 'tighten the acceptance criteria' }]);
  assert.deepEqual(approvals, []);
  assert.deepEqual(rejections, []);
  assert.deepEqual(pending, {}, 'the one-shot pending marker must be cleared once consumed');
});

// BL-410: the two tests above both use reply text with no leading/trailing
// whitespace, so classifyWithPendingButton's own text.trim() is a no-op for
// them and cannot prove it runs. A reply padded with whitespace (an
// ordinary thing to type) must have that whitespace stripped before it
// becomes the stored reason/note - never leaking into the ticket file
// (rejectHumanApprovalText's own sink) or the posted operator-context text.
test('BL-410: a padded bare reply while a Reject tap is pending has its whitespace trimmed before it becomes the reason', async () => {
  const rejections = [];
  const pending = { 'BL-123': 'reject' };
  await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({
      success: true,
      updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: '  bad scope  ' })],
    }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === 42 ? 'BL-123' : undefined),
    postOperatorContext: async () => true,
    recordApprovalReply: async () => true,
    recordRejectionReply: async (backlogId, reason) => {
      rejections.push({ backlogId, reason });
      return true;
    },
    getPendingButtonAction: async (backlogId) => pending[backlogId],
    clearPendingButtonAction: async (backlogId) => {
      delete pending[backlogId];
    },
  });
  assert.deepEqual(rejections, [{ backlogId: 'BL-123', reason: 'bad scope' }]);
});

test('BL-410: a padded bare reply while an Amend tap is pending has its whitespace trimmed before it becomes the note', async () => {
  const contexts = [];
  const pending = { 'BL-123': 'amend' };
  await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({
      success: true,
      updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: '  tighten the acceptance criteria  ' })],
    }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === 42 ? 'BL-123' : undefined),
    postOperatorContext: async (backlogId, text) => {
      contexts.push({ backlogId, text });
      return true;
    },
    recordApprovalReply: async () => true,
    recordRejectionReply: async () => true,
    getPendingButtonAction: async (backlogId) => pending[backlogId],
    clearPendingButtonAction: async (backlogId) => {
      delete pending[backlogId];
    },
  });
  // contextText for amend is action.note (BL-409's own dispatch) - if
  // action.kind were ever anything other than 'amend', deliverOperatorContext
  // would fall back to the RAW (unpadded) text instead, which this assertion
  // also catches.
  assert.deepEqual(contexts, [{ backlogId: 'BL-123', text: 'tighten the acceptance criteria' }]);
});

test('BL-410: an explicit "approve" reply wins over a pending Reject tap, and still clears the stale marker', async () => {
  const approvals = [];
  const rejections = [];
  const pending = { 'BL-123': 'reject' };
  await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'approve' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === 42 ? 'BL-123' : undefined),
    postOperatorContext: async () => true,
    recordApprovalReply: async (backlogId) => {
      approvals.push(backlogId);
      return true;
    },
    recordRejectionReply: async (backlogId, reason) => {
      rejections.push({ backlogId, reason });
      return true;
    },
    getPendingButtonAction: async (backlogId) => pending[backlogId],
    clearPendingButtonAction: async (backlogId) => {
      delete pending[backlogId];
    },
  });
  assert.deepEqual(approvals, ['BL-123']);
  assert.deepEqual(rejections, []);
  assert.deepEqual(pending, {}, 'any reply resolves the one-shot pending prompt, whether consumed as the pending verb or not');
});

test('BL-410: deliverOperatorContext works unchanged when getPendingButtonAction/clearPendingButtonAction are absent (pre-BL-410 fixtures keep working)', async () => {
  const contexts = [];
  const approvals = [];
  await pollAndForward(0, PRINCIPAL_ID, {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'approve' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a backlog-item topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a backlog-item topic reply');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: (topicId) => (topicId === 42 ? 'BL-123' : undefined),
    postOperatorContext: async (backlogId, text) => {
      contexts.push({ backlogId, text });
      return true;
    },
    recordApprovalReply: async (backlogId) => {
      approvals.push(backlogId);
      return true;
    },
    recordRejectionReply: async () => true,
  });
  assert.deepEqual(approvals, ['BL-123']);
  assert.deepEqual(contexts, [{ backlogId: 'BL-123', text: 'approve' }]);
});

// ── parseNextSseRecord (pure) ────────────────────────────────────────────

test('parseNextSseRecord parses a named event + data line, returning the remaining buffer', () => {
  const buffer = 'event: telegram-reply\ndata: {"threadId":"SUP-1","text":"hi"}\n\nrest of buffer';
  const result = parseNextSseRecord(buffer);
  assert.equal(result.event, 'telegram-reply');
  assert.equal(result.data, '{"threadId":"SUP-1","text":"hi"}');
  assert.equal(result.rest, 'rest of buffer');
});

test('parseNextSseRecord parses an UNNAMED data-only record (the BridgeState snapshot shape) with event undefined', () => {
  const result = parseNextSseRecord('data: {"pipeline":[]}\n\n');
  assert.equal(result.event, undefined);
  assert.equal(result.data, '{"pipeline":[]}');
});

test('parseNextSseRecord returns null when no complete record (no blank-line terminator) is buffered yet', () => {
  assert.equal(parseNextSseRecord('event: telegram-reply\ndata: {"threadId"'), null);
});

test('parseNextSseRecord can be called repeatedly to drain multiple buffered records', () => {
  const buffer = 'data: {"a":1}\n\ndata: {"a":2}\n\n';
  const first = parseNextSseRecord(buffer);
  assert.equal(first.data, '{"a":1}');
  const second = parseNextSseRecord(first.rest);
  assert.equal(second.data, '{"a":2}');
  assert.equal(parseNextSseRecord(second.rest), null);
});

// ── relaySseReplies (adapter-injected) — telegram-topic-03 ───────────────

function mkChunkReader(chunks) {
  let i = 0;
  return async () => {
    if (i >= chunks.length) {
      return { done: true, chunk: '' };
    }
    return { done: false, chunk: chunks[i++] };
  };
}

function topicDelivery(topicId, alsoPointerToDefault = false) {
  return { kind: 'topic', topicId, alsoPointerToDefault };
}
const DEFAULT_DELIVERY = { kind: 'default' };
const UNDELIVERABLE = { kind: 'undeliverable' };

test('relaySseReplies posts a telegram-reply record into its mapped topic, then acks it', async () => {
  const sent = [];
  const acked = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-1","text":"hello"}\n\n']),
      sendReply: async (topicId, text) => {
        sent.push({ topicId, text });
      },
      resolveDelivery: (subjectId) => (subjectId === 'SUP-1' ? topicDelivery(42) : UNDELIVERABLE),
      ackReply: async (id) => {
        acked.push(id);
      },
    },
    new Set()
  );
  assert.deepEqual(sent, [{ topicId: 42, text: 'hello' }]);
  assert.deepEqual(acked, ['r1']);
});

test('relaySseReplies sends nothing for a thread id with no resolvable destination at all, never throws, but still acks it', async () => {
  const sent = [];
  const acked = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-9","text":"hi"}\n\n']),
      sendReply: async (topicId, text) => {
        sent.push({ topicId, text });
      },
      resolveDelivery: () => UNDELIVERABLE,
      ackReply: async (id) => {
        acked.push(id);
      },
    },
    new Set()
  );
  assert.deepEqual(sent, []);
  assert.deepEqual(acked, ['r1']);
});

// ── BL-355: a subject bound only under DEFAULT_SUBJECT_KEY (General/a DM,
// never a real topic) now delivers instead of being silently dropped ─────

test('relaySseReplies delivers to General (no message_thread_id) when the subject has only a default binding', async () => {
  const sent = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-1","text":"hello"}\n\n']),
      sendReply: async (topicId, text) => {
        sent.push({ topicId, text });
      },
      resolveDelivery: () => DEFAULT_DELIVERY,
      ackReply: async () => {},
    },
    new Set()
  );
  assert.deepEqual(sent, [{ topicId: undefined, text: 'hello' }]);
});

// ── BL-355: a subject bound to BOTH a real topic and DEFAULT_SUBJECT_KEY
// keeps the full reply in its real topic AND sends a pointer to General ──

test('relaySseReplies sends the full reply to the real topic plus a pointer to General when both are bound', async () => {
  const sent = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-2","text":"the real answer"}\n\n']),
      sendReply: async (topicId, text) => {
        sent.push({ topicId, text });
      },
      resolveDelivery: () => topicDelivery(42, true),
      ackReply: async () => {},
    },
    new Set()
  );
  assert.deepEqual(sent, [
    { topicId: 42, text: 'the real answer' },
    { topicId: undefined, text: "This was answered — see the reply in this conversation's other topic." },
  ]);
});

// BL-440: a reply record's own retractsPendingQuestion flag (written by
// operator-decide.ts's runApprove on a successful gate answer) must ride
// through relayOneRecord/deliverReply to the real sendReply call so the
// live wiring can record it in blTopicStore.ts - the real production
// writer BL-440's own premise-live gate needs.
test('relaySseReplies threads a record\'s own retractsPendingQuestion flag through to sendReply', async () => {
  const sent = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"BL-100","text":"Answered coder\'s gate: y.","retractsPendingQuestion":true}\n\n']),
      sendReply: async (topicId, text, retractsPendingQuestion) => {
        sent.push({ topicId, text, retractsPendingQuestion });
      },
      resolveDelivery: () => topicDelivery(42),
      ackReply: async () => {},
    },
    new Set()
  );
  assert.deepEqual(sent, [{ topicId: 42, text: "Answered coder's gate: y.", retractsPendingQuestion: true }]);
});

test('relaySseReplies never sets retractsPendingQuestion on an ordinary reply record', async () => {
  const sent = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-1","text":"hello"}\n\n']),
      sendReply: async (topicId, text, retractsPendingQuestion) => {
        sent.push({ topicId, text, retractsPendingQuestion });
      },
      resolveDelivery: () => topicDelivery(42),
      ackReply: async () => {},
    },
    new Set()
  );
  assert.deepEqual(sent, [{ topicId: 42, text: 'hello', retractsPendingQuestion: undefined }]);
});

// BL-440: the pointer-to-General notice is a distinct message, not itself
// an answer - it must never inherit the primary reply's own retraction flag.
test('relaySseReplies never marks the pointer-to-General notice as a retraction', async () => {
  const sent = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader([
        'event: telegram-reply\ndata: {"id":"r1","threadId":"BL-100","text":"the real answer","retractsPendingQuestion":true}\n\n',
      ]),
      sendReply: async (topicId, text, retractsPendingQuestion) => {
        sent.push({ topicId, text, retractsPendingQuestion });
      },
      resolveDelivery: () => topicDelivery(42, true),
      ackReply: async () => {},
    },
    new Set()
  );
  assert.deepEqual(sent, [
    { topicId: 42, text: 'the real answer', retractsPendingQuestion: true },
    { topicId: undefined, text: "This was answered — see the reply in this conversation's other topic.", retractsPendingQuestion: undefined },
  ]);
});

test('relaySseReplies sends only the real topic, no pointer, when no default binding exists', async () => {
  const sent = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-2","text":"the real answer"}\n\n']),
      sendReply: async (topicId, text) => {
        sent.push({ topicId, text });
      },
      resolveDelivery: () => topicDelivery(42, false),
      ackReply: async () => {},
    },
    new Set()
  );
  assert.deepEqual(sent, [{ topicId: 42, text: 'the real answer' }]);
});

// ── relaySseReplies / deliverReply — BL-426 slice 1 outbound voice synthesis ──

test('BL-426 audio-voice-note-coordinator-02: a voice-originated turn\'s reply is synthesized to a voice note in the same topic, alongside the text', async () => {
  const sent = [];
  const synthesized = [];
  const voiceSent = [];
  const cleared = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"OPERATOR","text":"BL-400 is in QA"}\n\n']),
      sendReply: async (topicId, text) => {
        sent.push({ topicId, text });
      },
      resolveDelivery: () => topicDelivery(7),
      ackReply: async () => {},
      isVoiceOriginatedTurn: async (threadId) => threadId === 'OPERATOR',
      clearVoiceOriginatedTurn: async (threadId) => {
        cleared.push(threadId);
      },
      synthesizeVoice: async (text) => {
        synthesized.push(text);
        return { kind: 'ok', audio: Buffer.from('synth-audio') };
      },
      sendVoice: async (topicId, audio) => {
        voiceSent.push({ topicId, audio });
      },
    },
    new Set()
  );
  assert.deepEqual(sent, [{ topicId: 7, text: 'BL-400 is in QA' }], 'the text transcript must still be sent (voice + transcript, never voice-only)');
  assert.deepEqual(synthesized, ['BL-400 is in QA']);
  assert.deepEqual(voiceSent, [{ topicId: 7, audio: Buffer.from('synth-audio') }]);
  assert.deepEqual(cleared, ['OPERATOR'], 'the one-shot marker must be cleared so the NEXT reply defaults back to text-only');
});

test('BL-426: an ordinary (non-voice-originated) reply never synthesizes or sends voice', async () => {
  const voiceSent = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"OPERATOR","text":"a plain text answer"}\n\n']),
      sendReply: async () => {},
      resolveDelivery: () => topicDelivery(7),
      ackReply: async () => {},
      isVoiceOriginatedTurn: async () => false,
      clearVoiceOriginatedTurn: async () => {
        throw new Error('clearVoiceOriginatedTurn should not be called when the turn is not voice-originated');
      },
      synthesizeVoice: async () => {
        throw new Error('synthesizeVoice should not be called when the turn is not voice-originated');
      },
      sendVoice: async (topicId, audio) => {
        voiceSent.push({ topicId, audio });
      },
    },
    new Set()
  );
  assert.deepEqual(voiceSent, []);
});

test('BL-426: a TTS failure degrades to the text reply already sent, never blocking or crashing the relay', async () => {
  const sent = [];
  const voiceSent = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"OPERATOR","text":"BL-400 is in QA"}\n\n']),
      sendReply: async (topicId, text) => {
        sent.push({ topicId, text });
      },
      resolveDelivery: () => topicDelivery(7),
      ackReply: async () => {},
      isVoiceOriginatedTurn: async () => true,
      clearVoiceOriginatedTurn: async () => {},
      synthesizeVoice: async () => ({ kind: 'failure' }),
      sendVoice: async (topicId, audio) => {
        voiceSent.push({ topicId, audio });
      },
    },
    new Set()
  );
  assert.deepEqual(sent, [{ topicId: 7, text: 'BL-400 is in QA' }]);
  assert.deepEqual(voiceSent, [], 'sendVoice must never be called when synthesis failed');
});

test('BL-426: a voice-originated reply synthesizes and sends voice even when clearVoiceOriginatedTurn is not wired', async () => {
  const sent = [];
  const voiceSent = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"OPERATOR","text":"BL-400 is in QA"}\n\n']),
      sendReply: async (topicId, text) => {
        sent.push({ topicId, text });
      },
      resolveDelivery: () => topicDelivery(7),
      ackReply: async () => {},
      isVoiceOriginatedTurn: async () => true,
      synthesizeVoice: async () => ({ kind: 'ok', audio: Buffer.from('synth-audio') }),
      sendVoice: async (topicId, audio) => {
        voiceSent.push({ topicId, audio });
      },
    },
    new Set()
  );
  assert.deepEqual(sent, [{ topicId: 7, text: 'BL-400 is in QA' }]);
  assert.deepEqual(voiceSent, [{ topicId: 7, audio: Buffer.from('synth-audio') }]);
});

test('BL-426: relaySseReplies behaves exactly as before when the voice adapters are absent (pre-BL-426 fixtures keep working)', async () => {
  const sent = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-1","text":"hello"}\n\n']),
      sendReply: async (topicId, text) => {
        sent.push({ topicId, text });
      },
      resolveDelivery: () => topicDelivery(42),
      ackReply: async () => {},
    },
    new Set()
  );
  assert.deepEqual(sent, [{ topicId: 42, text: 'hello' }]);
});

// ── relaySseReplies / deliverAgentQuestion — BL-466 ───────────────────────

test('BL-483 multi-option-ask-buttons-01: an agentQuestion record carrying options sends tappable buttons (never a poll) into the Agent Questions topic and records the message for later resolution/editing', async () => {
  const posted = [];
  const recorded = [];
  const sentReplies = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader([
        'event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-1","text":"which environment?","agentQuestion":true,"options":[{"label":"staging","description":"pre-prod"},{"label":"prod","description":"live"}]}\n\n',
      ]),
      sendReply: async (topicId, text) => {
        sentReplies.push({ topicId, text });
      },
      sendAskButtons: async (topicId, text, buttons) => {
        posted.push({ topicId, text, buttons });
        return { success: true, messageId: 555 };
      },
      recordAskMessage: async (threadId, topicId, messageId, text) => {
        recorded.push({ threadId, topicId, messageId, text });
      },
      agentQuestionsTopicId: async () => 42,
      resolveDelivery: () => {
        throw new Error('resolveDelivery should never be consulted for an agentQuestion record - it always routes to the Agent Questions topic');
      },
      ackReply: async () => {},
    },
    new Set()
  );
  assert.equal(posted.length, 1);
  assert.equal(posted[0].topicId, 42);
  assert.match(posted[0].text, /staging/);
  assert.match(posted[0].text, /pre-prod/);
  assert.match(posted[0].text, /prod/);
  assert.match(posted[0].text, /live/);
  assert.deepEqual(posted[0].buttons, [
    [{ text: 'staging', callbackData: 'ask:SUP-1:0' }],
    [{ text: 'prod', callbackData: 'ask:SUP-1:1' }],
  ]);
  assert.deepEqual(recorded, [{ threadId: 'SUP-1', topicId: 42, messageId: 555, text: posted[0].text }]);
  assert.deepEqual(sentReplies, [], 'an options-carrying agentQuestion must never ALSO send an ordinary reply');
});

test('BL-483 multi-option-ask-buttons-05: an agentQuestion record with no options renders byte-identically to the pre-change (plain message) contract', async () => {
  const posted = [];
  const sentReplies = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-1","text":"anything else?","agentQuestion":true}\n\n']),
      sendReply: async (topicId, text) => {
        sentReplies.push({ topicId, text });
      },
      sendAskButtons: async (topicId, text, buttons) => {
        posted.push({ topicId, text, buttons });
        return { success: true, messageId: 555 };
      },
      agentQuestionsTopicId: async () => 42,
      resolveDelivery: () => {
        throw new Error('resolveDelivery should never be consulted for an agentQuestion record');
      },
      ackReply: async () => {},
    },
    new Set()
  );
  assert.deepEqual(sentReplies, [{ topicId: 42, text: 'anything else?' }]);
  assert.deepEqual(posted, [], 'an open-ended agentQuestion must never send buttons');
});

test('BL-483: an agentQuestion record with an EMPTY options array also falls back to a plain message', async () => {
  const posted = [];
  const sentReplies = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-1","text":"anything else?","agentQuestion":true,"options":[]}\n\n']),
      sendReply: async (topicId, text) => sentReplies.push({ topicId, text }),
      sendAskButtons: async (topicId, text, buttons) => {
        posted.push({ topicId, text, buttons });
        return { success: true, messageId: 555 };
      },
      agentQuestionsTopicId: async () => 42,
      resolveDelivery: () => ({ kind: 'undeliverable' }),
      ackReply: async () => {},
    },
    new Set()
  );
  assert.deepEqual(sentReplies, [{ topicId: 42, text: 'anything else?' }]);
  assert.deepEqual(posted, []);
});

test('BL-483: a button send that fails (no messageId returned) records no mapping, never crashes the relay', async () => {
  const recorded = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader([
        'event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-1","text":"which environment?","agentQuestion":true,"options":[{"label":"staging"},{"label":"prod"}]}\n\n',
      ]),
      sendReply: async () => {},
      sendAskButtons: async () => ({ success: false }),
      recordAskMessage: async (threadId, topicId, messageId, text) => {
        recorded.push({ threadId, topicId, messageId, text });
      },
      agentQuestionsTopicId: async () => 42,
      resolveDelivery: () => ({ kind: 'undeliverable' }),
      ackReply: async () => {},
    },
    new Set()
  );
  assert.deepEqual(recorded, []);
});

test('BL-466: an ordinary (non-agentQuestion) record is completely unaffected - still resolved/delivered the pre-BL-466 way', async () => {
  const sent = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-1","text":"hello"}\n\n']),
      sendReply: async (topicId, text) => {
        sent.push({ topicId, text });
      },
      sendPoll: async () => {
        throw new Error('sendPoll should never be called for an ordinary reply');
      },
      agentQuestionsTopicId: async () => {
        throw new Error('agentQuestionsTopicId should never be consulted for an ordinary reply');
      },
      resolveDelivery: (subjectId) => (subjectId === 'SUP-1' ? topicDelivery(7) : UNDELIVERABLE),
      ackReply: async () => {},
    },
    new Set()
  );
  assert.deepEqual(sent, [{ topicId: 7, text: 'hello' }]);
});

test('relaySseReplies ignores a record that is not a telegram-reply event, and never acks it', () => {
  const sent = [];
  const acked = [];
  return relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: some-other-event\ndata: {"id":"r1","threadId":"SUP-1","text":"hi"}\n\n']),
      sendReply: async (topicId, text) => {
        sent.push({ topicId, text });
      },
      resolveDelivery: () => topicDelivery(42),
      ackReply: async (id) => {
        acked.push(id);
      },
    },
    new Set()
  ).then(() => {
    assert.deepEqual(sent, []);
    assert.deepEqual(acked, []);
  });
});

test('relaySseReplies drains multiple records buffered across chunks before reading the next one', async () => {
  const sent = [];
  const acked = [];
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader([
        'event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-1","text":"first"}\n\nevent: telegram-reply\ndata: {"id":"r2","threadId":"SUP-2","text":"second"}\n\n',
      ]),
      sendReply: async (topicId, text) => {
        sent.push({ topicId, text });
      },
      resolveDelivery: (subjectId) => topicDelivery({ 'SUP-1': 1, 'SUP-2': 2 }[subjectId]),
      ackReply: async (id) => {
        acked.push(id);
      },
    },
    new Set()
  );
  assert.deepEqual(sent, [
    { topicId: 1, text: 'first' },
    { topicId: 2, text: 'second' },
  ]);
  assert.deepEqual(acked, ['r1', 'r2']);
});

test('relaySseReplies returns cleanly once readChunk reports done', async () => {
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader([]),
      sendReply: async () => {
        throw new Error('should never be called');
      },
      resolveDelivery: () => topicDelivery(1),
      ackReply: async () => {
        throw new Error('should never be called');
      },
    },
    new Set()
  );
});

// ── BL-320: idempotency (redelivery after a reconnect must never double-post) ──

test('relaySseReplies never re-sends a record whose id is already in seenIds, but still acks it', async () => {
  const sent = [];
  const acked = [];
  const seenIds = new Set(['r1']);
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-1","text":"hello"}\n\n']),
      sendReply: async (topicId, text) => {
        sent.push({ topicId, text });
      },
      resolveDelivery: () => topicDelivery(42),
      ackReply: async (id) => {
        acked.push(id);
      },
    },
    seenIds
  );
  assert.deepEqual(sent, [], 'a record already in seenIds must never be re-posted to Telegram');
  assert.deepEqual(acked, ['r1'], 'the (possibly lost) ack must still be retried');
});

test('relaySseReplies adds a newly-sent record\'s id to the shared seenIds set so a later reconnect dedupes it', async () => {
  const seenIds = new Set();
  await relaySseReplies(
    '',
    {
      readChunk: mkChunkReader(['event: telegram-reply\ndata: {"id":"r1","threadId":"SUP-1","text":"hello"}\n\n']),
      sendReply: async () => {},
      resolveDelivery: () => topicDelivery(42),
      ackReply: async () => {},
    },
    seenIds
  );
  assert.ok(seenIds.has('r1'));
});

// ── BL-302: poll-loop resilience (backoff, escalation, isolation) ────────

const BACKOFF_CONFIG = { backoffBaseMs: 1000, backoffMaxMs: 8000, degradedThreshold: 3 };

// ── computePollBackoffMs / shouldRaiseDegradedWarning (pure) ─────────────

test('poll-resilience-01: computePollBackoffMs grows exponentially per consecutive failure, capped at backoffMaxMs', () => {
  assert.equal(computePollBackoffMs(1, BACKOFF_CONFIG), 1000);
  assert.equal(computePollBackoffMs(2, BACKOFF_CONFIG), 2000);
  assert.equal(computePollBackoffMs(3, BACKOFF_CONFIG), 4000);
  assert.equal(computePollBackoffMs(4, BACKOFF_CONFIG), 8000);
  assert.equal(computePollBackoffMs(10, BACKOFF_CONFIG), 8000);
});

test('poll-resilience-01: computePollBackoffMs is never zero for any failed cycle (no tight-spin)', () => {
  for (let n = 1; n <= 20; n++) {
    assert.ok(computePollBackoffMs(n, BACKOFF_CONFIG) > 0, `expected a positive delay at consecutiveFailures=${n}`);
  }
});

test('poll-resilience-02: shouldRaiseDegradedWarning fires exactly on the threshold crossing, not before or after', () => {
  assert.equal(shouldRaiseDegradedWarning(1, BACKOFF_CONFIG), false);
  assert.equal(shouldRaiseDegradedWarning(2, BACKOFF_CONFIG), false);
  assert.equal(shouldRaiseDegradedWarning(3, BACKOFF_CONFIG), true);
  assert.equal(shouldRaiseDegradedWarning(4, BACKOFF_CONFIG), false);
  assert.equal(shouldRaiseDegradedWarning(100, BACKOFF_CONFIG), false);
});

// ── runPollCycle (adapter-injected, one cycle) ────────────────────────────

function fakeCycleAdapters(getUpdatesResult) {
  return {
    chatId: '1',
    getUpdates: async () => getUpdatesResult,
    postToBridge: async () => true,
    subjectForTopic: () => undefined,
    openSubjectAndRecord: async () => 'SUP-1',
    backlogForTopic: () => undefined,
    postOperatorContext: async () => true,
    nextOffset: (updates, current) => current + updates.length,
  };
}

test('poll-resilience-01: a failed cycle increments consecutiveFailures and returns a positive delay', async () => {
  const state = { offset: 5, consecutiveFailures: 0 };
  const cycle = await runPollCycle(state, PRINCIPAL_ID, fakeCycleAdapters({ success: false, updates: [], error: 'network error' }), BACKOFF_CONFIG);
  assert.equal(cycle.state.consecutiveFailures, 1);
  assert.equal(cycle.delayMs, 1000);
  assert.equal(cycle.degradedWarning, false);
});

test('poll-resilience-01: a run of failures backs off with growing delay, then a success resets to the floor', async () => {
  let state = { offset: 0, consecutiveFailures: 0 };
  const delays = [];
  for (let i = 0; i < 4; i++) {
    const cycle = await runPollCycle(state, PRINCIPAL_ID, fakeCycleAdapters({ success: false, updates: [], error: 'down' }), BACKOFF_CONFIG);
    delays.push(cycle.delayMs);
    state = cycle.state;
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000]);

  const recovered = await runPollCycle(state, PRINCIPAL_ID, fakeCycleAdapters({ success: true, updates: [] }), BACKOFF_CONFIG);
  assert.equal(recovered.state.consecutiveFailures, 0);
  assert.equal(recovered.delayMs, 0);
});

test('poll-resilience-02: the degraded warning fires on the exact cycle the threshold is crossed', async () => {
  let state = { offset: 0, consecutiveFailures: 0 };
  const warnings = [];
  for (let i = 0; i < 5; i++) {
    const cycle = await runPollCycle(state, PRINCIPAL_ID, fakeCycleAdapters({ success: false, updates: [], error: 'down' }), BACKOFF_CONFIG);
    warnings.push(cycle.degradedWarning);
    state = cycle.state;
  }
  assert.deepEqual(warnings, [false, false, true, false, false]);
});

test('poll-resilience-02: retries continue past the degraded threshold (never gives up)', async () => {
  let state = { offset: 0, consecutiveFailures: 0 };
  for (let i = 0; i < 10; i++) {
    const cycle = await runPollCycle(state, PRINCIPAL_ID, fakeCycleAdapters({ success: false, updates: [], error: 'down' }), BACKOFF_CONFIG);
    state = cycle.state;
  }
  assert.equal(state.consecutiveFailures, 10);
  const cycle = await runPollCycle(state, PRINCIPAL_ID, fakeCycleAdapters({ success: true, updates: [] }), BACKOFF_CONFIG);
  assert.equal(cycle.state.consecutiveFailures, 0, 'the loop must still be able to recover after a sustained outage');
});

test('a successful cycle with real updates still advances the offset via runPollCycle', async () => {
  const update = { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, text: 'hi' } };
  const cycle = await runPollCycle({ offset: 0, consecutiveFailures: 2, stuckAttempts: 0 }, PRINCIPAL_ID, fakeCycleAdapters({ success: true, updates: [update] }), BACKOFF_CONFIG);
  // BL-369: the offset is the delivered update's own update_id + 1 (real
  // Telegram semantics, offsetAfterDelivery), never an injected adapter's
  // arbitrary arithmetic - update_id:1 delivered means offset advances to 2.
  assert.equal(cycle.state.offset, 2);
  assert.equal(cycle.state.consecutiveFailures, 0);
});

// ── applyPollCycleResult (adapter-injected per-cycle side effects) ───────
// Split out of pollLoop's own for(;;) (found during cleaner review: two
// ifs inline in that forever loop pushed its own CRAP over threshold at
// near-zero coverage) so the decision-to-effect wiring is unit-tested here
// instead of only reachable through the live, untested loop wrapper.

test('applyPollCycleResult writes the warning and waits when both are present', async () => {
  const warnings = [];
  const waits = [];
  await applyPollCycleResult(
    { state: { offset: 0, consecutiveFailures: 3 }, delayMs: 4000, degradedWarning: true },
    (message) => warnings.push(message),
    async (ms) => waits.push(ms)
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /3 consecutive failures/);
  assert.deepEqual(waits, [4000]);
});

test('applyPollCycleResult writes nothing and waits nothing on a successful cycle (delayMs 0, no warning)', async () => {
  const warnings = [];
  const waits = [];
  await applyPollCycleResult(
    { state: { offset: 5, consecutiveFailures: 0 }, delayMs: 0, degradedWarning: false },
    (message) => warnings.push(message),
    async (ms) => waits.push(ms)
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(waits, []);
});

test('applyPollCycleResult still waits on a failed cycle below the degraded threshold (no warning yet)', async () => {
  const warnings = [];
  const waits = [];
  await applyPollCycleResult(
    { state: { offset: 0, consecutiveFailures: 1 }, delayMs: 1000, degradedWarning: false },
    (message) => warnings.push(message),
    async (ms) => waits.push(ms)
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(waits, [1000]);
});

// ── computeReplyRelayCycleResult / applyReplyRelayCycleResult (BL-320) ───
// Extracted from subscribeReplies's own for(;;) (cleaner review: the
// inline try/catch plus two nested ifs pushed subscribeReplies's own CRAP
// to 30 at 0% coverage - the live wrapper is never unit-exercised, same
// class of gap the comment above this block already called out for
// pollLoop/runPollCycle/applyPollCycleResult), mirroring that exact split.

test('computeReplyRelayCycleResult on success resets consecutiveFailures and waits the base backoff, not zero', () => {
  const cycle = computeReplyRelayCycleResult({ consecutiveFailures: 3 }, true, BACKOFF_CONFIG);
  assert.equal(cycle.state.consecutiveFailures, 0);
  assert.equal(cycle.delayMs, BACKOFF_CONFIG.backoffBaseMs);
  assert.equal(cycle.degradedWarning, false);
});

test('computeReplyRelayCycleResult on failure increments consecutiveFailures and backs off like the poll cycle', () => {
  let state = { consecutiveFailures: 0 };
  const delays = [];
  for (let i = 0; i < 4; i++) {
    const cycle = computeReplyRelayCycleResult(state, false, BACKOFF_CONFIG);
    delays.push(cycle.delayMs);
    state = cycle.state;
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000]);
});

test('computeReplyRelayCycleResult raises the degraded warning on the exact cycle the threshold is crossed', () => {
  let state = { consecutiveFailures: 0 };
  const warnings = [];
  for (let i = 0; i < 5; i++) {
    const cycle = computeReplyRelayCycleResult(state, false, BACKOFF_CONFIG);
    warnings.push(cycle.degradedWarning);
    state = cycle.state;
  }
  assert.deepEqual(warnings, [false, false, true, false, false]);
});

test('computeReplyRelayCycleResult keeps retrying past the degraded threshold and still recovers on success', () => {
  let state = { consecutiveFailures: 0 };
  for (let i = 0; i < 10; i++) {
    state = computeReplyRelayCycleResult(state, false, BACKOFF_CONFIG).state;
  }
  assert.equal(state.consecutiveFailures, 10);
  const cycle = computeReplyRelayCycleResult(state, true, BACKOFF_CONFIG);
  assert.equal(cycle.state.consecutiveFailures, 0, 'reconnects must still be able to recover after a sustained outage');
});

test('applyReplyRelayCycleResult writes the warning (with the error message) and waits when both are present', async () => {
  const warnings = [];
  const waits = [];
  await applyReplyRelayCycleResult(
    { state: { consecutiveFailures: 3 }, delayMs: 4000, degradedWarning: true },
    'socket terminated',
    (message) => warnings.push(message),
    async (ms) => waits.push(ms)
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /3 consecutive reconnect failures/);
  assert.match(warnings[0], /socket terminated/);
  assert.deepEqual(waits, [4000]);
});

test('applyReplyRelayCycleResult writes no warning but still waits the base backoff on a clean stream end (success)', async () => {
  const warnings = [];
  const waits = [];
  await applyReplyRelayCycleResult(
    { state: { consecutiveFailures: 0 }, delayMs: BACKOFF_CONFIG.backoffBaseMs, degradedWarning: false },
    undefined,
    (message) => warnings.push(message),
    async (ms) => waits.push(ms)
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(waits, [BACKOFF_CONFIG.backoffBaseMs]);
});

// ── runContainedLoop (adapter-injected loop isolation) ────────────────────

test('poll-resilience-03: a loop that throws is reported, waited on, and RESTARTED - runContainedLoop itself never rejects', async () => {
  let calls = 0;
  const faults = [];
  const waits = [];
  const start = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('socket dropped');
    }
    // second call succeeds (returns normally) - the recursive chain ends.
  };
  await runContainedLoop(
    'poll',
    start,
    async (ms) => waits.push(ms),
    5000,
    (name, error) => faults.push({ name, message: error.message })
  );
  assert.equal(calls, 2);
  assert.deepEqual(faults, [{ name: 'poll', message: 'socket dropped' }]);
  assert.deepEqual(waits, [5000]);
});

test('poll-resilience-03: a loop that never throws resolves cleanly with no fault/wait at all', async () => {
  const faults = [];
  const waits = [];
  await runContainedLoop(
    'reply-relay',
    async () => {},
    async (ms) => waits.push(ms),
    5000,
    (name, error) => faults.push({ name, error })
  );
  assert.deepEqual(faults, []);
  assert.deepEqual(waits, []);
});

test('poll-resilience-03: a fault in one loop does not affect a concurrently-running sibling loop', async () => {
  const siblingTicks = [];
  let siblingRunning = true;

  async function siblingLoop() {
    for (let i = 0; i < 5 && siblingRunning; i++) {
      siblingTicks.push(i);
    }
  }

  let poisonCalls = 0;
  const poisonedStart = async () => {
    poisonCalls += 1;
    if (poisonCalls <= 2) {
      throw new Error('fault ' + poisonCalls);
    }
  };

  await Promise.all([
    runContainedLoop('poisoned', poisonedStart, async () => {}, 0, () => {}),
    runContainedLoop('sibling', siblingLoop, async () => {}, 0, () => {
      throw new Error('sibling should never fault');
    }),
  ]);

  // The poisoned loop faulted twice and still recovered (3rd call
  // succeeds); the sibling ran to completion completely undisturbed by
  // it - proof neither Promise.all entry ever rejected because of the
  // other.
  assert.equal(poisonCalls, 3);
  assert.deepEqual(siblingTicks, [0, 1, 2, 3, 4]);
});

// ── nextUpdateOffset (pure) — BL-353: moved from the retired
//    telegramInboundRelay.ts, unrelated to the deleted relay class ──────

test('nextUpdateOffset advances past the highest update_id seen', () => {
  assert.equal(nextUpdateOffset([{ update_id: 5 }, { update_id: 7 }, { update_id: 6 }], 0), 8);
});

test('nextUpdateOffset never regresses when given an empty batch', () => {
  assert.equal(nextUpdateOffset([], 12), 12);
});

// ── offsetAfterDelivery (pure) — BL-369 bug #1, the keystone defect ─────

function upd(id) {
  return { update_id: id, message: { message_id: id, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, text: 'x' } };
}

test('offsetAfterDelivery advances past every update when all were posted', () => {
  assert.equal(offsetAfterDelivery([upd(5), upd(6), upd(7)], 0, ['posted', 'posted', 'posted']), 8);
});

test('offsetAfterDelivery-no-loss-01: stops BEFORE the first FAILED update, never advancing past it', () => {
  assert.equal(offsetAfterDelivery([upd(5), upd(6), upd(7)], 0, ['posted', 'failed', 'posted']), 6);
});

test('offsetAfterDelivery: a failure on the FIRST update advances the offset not at all', () => {
  assert.equal(offsetAfterDelivery([upd(5), upd(6)], 3, ['failed', 'posted']), 3);
});

test('offsetAfterDelivery: an empty batch leaves the offset unchanged', () => {
  assert.equal(offsetAfterDelivery([], 9, []), 9);
});

test('offsetAfterDelivery: a single posted update advances to its own update_id + 1 (real Telegram semantics)', () => {
  assert.equal(offsetAfterDelivery([upd(41)], 0, ['posted']), 42);
});

// ── BL-389 the-battery-.../a-dropped-message-must-not-park-the-offset ────
// scenarios 01-03: a DROP is terminal (never retried), a FAILURE is
// retryable (never skipped) - the antonym pair IS the fix.

test('BL-389 scenario 01: a message dropped on purpose is never fetched again - the offset advances PAST it', () => {
  assert.equal(offsetAfterDelivery([upd(5)], 0, ['dropped']), 6);
});

test('BL-389 scenario 02: a message whose delivery failed is fetched again - the offset does NOT move past it', () => {
  assert.equal(offsetAfterDelivery([upd(5)], 0, ['failed']), 0);
});

test('BL-389 scenario 03: a dropped message ahead of a failed one does not shield it - offset advances past the drop, then stops at the failure', () => {
  assert.equal(offsetAfterDelivery([upd(5), upd(6), upd(7)], 0, ['dropped', 'failed', 'posted']), 6);
});

test('BL-389 scenario 03 (converse): a dropped message AFTER a failure is never reached - offset still stops at the failure, advancing not at all', () => {
  assert.equal(offsetAfterDelivery([upd(5), upd(6), upd(7)], 0, ['failed', 'dropped', 'posted']), 0);
});

// ── shouldEscalateStuckDelivery (pure) — BL-369 scenario 05 ─────────────

const STUCK_CONFIG = { backoffBaseMs: 1000, backoffMaxMs: 8000, degradedThreshold: 3, stuckRetryLimit: 3 };

test('shouldEscalateStuckDelivery fires exactly on the threshold crossing, not before or after', () => {
  assert.equal(shouldEscalateStuckDelivery(2, STUCK_CONFIG), false);
  assert.equal(shouldEscalateStuckDelivery(3, STUCK_CONFIG), true);
  assert.equal(shouldEscalateStuckDelivery(4, STUCK_CONFIG), false);
});

// ── runPollCycle's stuckAttempts tracking (BL-369 scenario 05) ──────────

function fakeStuckCycleAdapters({ deliver }) {
  const update = { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, text: 'stuck' } };
  return {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [update] }),
    postToBridge: async () => deliver,
    subjectForTopic: () => 'SUP-1',
    openSubjectAndRecord: async () => 'SUP-1',
    backlogForTopic: () => undefined,
    postOperatorContext: async () => true,
  };
}

test('BL-369 no-inbound-message-is-ever-lost-05: a cycle whose only update keeps failing increments stuckAttempts each time', async () => {
  let state = { offset: 0, consecutiveFailures: 0, stuckAttempts: 0 };
  for (let i = 1; i <= 3; i++) {
    const cycle = await runPollCycle(state, PRINCIPAL_ID, fakeStuckCycleAdapters({ deliver: false }), STUCK_CONFIG);
    state = cycle.state;
    assert.equal(state.stuckAttempts, i);
    assert.equal(state.offset, 0, 'the offset must never advance past the still-undelivered update');
  }
});

test('BL-369 no-inbound-message-is-ever-lost-05: escalateStuckDelivery fires exactly on the cycle stuckAttempts crosses the limit, never before or again after', async () => {
  let state = { offset: 0, consecutiveFailures: 0, stuckAttempts: 0 };
  const escalations = [];
  for (let i = 1; i <= 5; i++) {
    const cycle = await runPollCycle(state, PRINCIPAL_ID, fakeStuckCycleAdapters({ deliver: false }), STUCK_CONFIG);
    state = cycle.state;
    escalations.push(cycle.escalateStuckDelivery);
  }
  assert.deepEqual(escalations, [false, false, true, false, false]);
});

test('a delivery success resets stuckAttempts to 0 and lets the offset advance again', async () => {
  const failing = await runPollCycle({ offset: 0, consecutiveFailures: 0, stuckAttempts: 2 }, PRINCIPAL_ID, fakeStuckCycleAdapters({ deliver: false }), STUCK_CONFIG);
  assert.equal(failing.state.stuckAttempts, 3);
  const recovered = await runPollCycle(failing.state, PRINCIPAL_ID, fakeStuckCycleAdapters({ deliver: true }), STUCK_CONFIG);
  assert.equal(recovered.state.stuckAttempts, 0);
  assert.equal(recovered.state.offset, 2, 'expected the previously-stuck update to finally be delivered and acked');
});

test('a whole-cycle getUpdates failure never touches stuckAttempts (a distinct failure mode from a per-message delivery failure)', async () => {
  const adapters = { getUpdates: async () => ({ success: false, updates: [], error: 'down' }) };
  const cycle = await runPollCycle({ offset: 0, consecutiveFailures: 0, stuckAttempts: 2 }, PRINCIPAL_ID, adapters, STUCK_CONFIG);
  assert.equal(cycle.state.stuckAttempts, 2, 'expected stuckAttempts left untouched by a getUpdates-level failure');
  assert.equal(cycle.escalateStuckDelivery, false);
});

// ── applyPollCycleResult's escalate callback (BL-369) ────────────────────

test('applyPollCycleResult calls escalate when escalateStuckDelivery is true, and waits/warns independently as usual', async () => {
  const escalateCalls = [];
  const cycle = { state: { offset: 0, consecutiveFailures: 0, stuckAttempts: 3 }, delayMs: 0, degradedWarning: false, escalateStuckDelivery: true };
  await applyPollCycleResult(
    cycle,
    () => {
      throw new Error('no warning expected here');
    },
    async () => {},
    async () => {
      escalateCalls.push(true);
    }
  );
  assert.equal(escalateCalls.length, 1);
});

test('applyPollCycleResult never calls escalate when escalateStuckDelivery is false', async () => {
  const escalateCalls = [];
  const cycle = { state: { offset: 0, consecutiveFailures: 0, stuckAttempts: 0 }, delayMs: 0, degradedWarning: false, escalateStuckDelivery: false };
  await applyPollCycleResult(
    cycle,
    () => {},
    async () => {},
    async () => escalateCalls.push(true)
  );
  assert.deepEqual(escalateCalls, []);
});

test('applyPollCycleResult defaults escalate to a no-op when the caller does not supply one (back-compat)', async () => {
  const cycle = { state: { offset: 0, consecutiveFailures: 0, stuckAttempts: 3 }, delayMs: 0, degradedWarning: false, escalateStuckDelivery: true };
  await assert.doesNotReject(() => applyPollCycleResult(cycle, () => {}, async () => {}));
});

// ── BL-370: isPollCycleStale (pure) ───────────────────────────────────────

test('front-desk-liveness-01: no completed poll within the stall window is stale', () => {
  assert.equal(isPollCycleStale(1000, 92000, 90000), true);
});

test('front-desk-liveness-01: exactly AT the stall window boundary is stale (inclusive, mirrors front_desk_supervisor_lib.bb)', () => {
  assert.equal(isPollCycleStale(1000, 91000, 90000), true);
});

test('front-desk-liveness-02: a heartbeat just inside the stall window is NOT stale - a quiet night must never read as dead', () => {
  assert.equal(isPollCycleStale(1000, 90999, 90000), false);
});

test('front-desk-liveness-02: a heartbeat from the same instant as now is not stale', () => {
  assert.equal(isPollCycleStale(50000, 50000, 90000), false);
});

test('a bot that has never completed a single poll cycle (no heartbeat at all) is stale', () => {
  assert.equal(isPollCycleStale(undefined, 90000, 90000), true);
});

// ── BL-370: applyPollCycleResult's recordHeartbeat callback ──────────────

test('applyPollCycleResult calls recordHeartbeat on every completed cycle, success or failure alike', async () => {
  const beats = [];
  const okCycle = { state: { offset: 2, consecutiveFailures: 0, stuckAttempts: 0 }, delayMs: 0, degradedWarning: false, escalateStuckDelivery: false };
  await applyPollCycleResult(okCycle, () => {}, async () => {}, async () => {}, () => beats.push('ok'));
  const failedCycle = { state: { offset: 0, consecutiveFailures: 1, stuckAttempts: 0 }, delayMs: 2000, degradedWarning: false, escalateStuckDelivery: false };
  await applyPollCycleResult(failedCycle, () => {}, async () => {}, async () => {}, () => beats.push('failed'));
  assert.deepEqual(beats, ['ok', 'failed']);
});

test('applyPollCycleResult defaults recordHeartbeat to a no-op when the caller does not supply one (back-compat)', async () => {
  const cycle = { state: { offset: 0, consecutiveFailures: 0, stuckAttempts: 0 }, delayMs: 0, degradedWarning: false, escalateStuckDelivery: false };
  await assert.doesNotReject(() => applyPollCycleResult(cycle, () => {}, async () => {}));
});
