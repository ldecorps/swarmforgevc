const assert = require('node:assert/strict');
const {
  isFromPrincipal,
  topicIdOf,
  messageTextOf,
  subjectForTopic,
  topicForSubject,
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

// ── decideUpdateAction (pure) — BL-281 telegram-topic-01/05, BL-294 auto-open-01..04 ──

test('BL-281 telegram-topic-01: a principal message on a MAPPED topic posts under the resolved subjectId', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7, text: 'any update?' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, (topicId) => (topicId === 7 ? 'SUP-1' : undefined));
  assert.deepEqual(decision, { action: 'post-existing', subjectId: 'SUP-1', text: 'any update?' });
});

test('BL-281 telegram-topic-05 / BL-294 auto-open-04: a non-principal message is dropped, never posted or opened', () => {
  const update = mkUpdate({ fromId: 999, topicId: 7, text: 'let me in' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, () => 'SUP-1');
  assert.deepEqual(decision, { action: 'drop', reason: 'not-principal' });
});

test('BL-294 auto-open-01: a principal DM (no topic) with no default subject yet opens the default subject', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, text: 'hello from a DM' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, () => undefined);
  assert.deepEqual(decision, { action: 'open-default', text: 'hello from a DM' });
});

test('BL-294 auto-open-02: a principal message on an unmapped topic opens a subject FOR that topic', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'new conversation' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, () => undefined);
  assert.deepEqual(decision, { action: 'open-for-topic', topicId: 42, text: 'new conversation' });
});

test('a textless update (e.g. a sticker/photo) is dropped, never posted or opened with undefined text', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 7 });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, () => 'SUP-1');
  assert.deepEqual(decision, { action: 'drop', reason: 'no-text' });
});

// ── BL-298 topic-reply-01/02/03: BL-### topic replies route as Operator context ──

test('BL-298 topic-reply-01: a reply on a topic mapped to a backlog item routes as operator context, not a support subject', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'here is an update' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, () => undefined, (topicId) => (topicId === 42 ? 'BL-123' : undefined));
  assert.deepEqual(decision, { action: 'operator-context', backlogId: 'BL-123', text: 'here is an update' });
});

test('BL-298: a topic mapped to BOTH a SUP-### subject and a backlog item resolves to the subject (support-thread priority, no regression)', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'ambiguous' });
  const decision = decideUpdateAction(
    update,
    PRINCIPAL_ID,
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
    (topicId) => (topicId === 7 ? 'SUP-1' : undefined),
    () => undefined
  );
  assert.deepEqual(decision, { action: 'post-existing', subjectId: 'SUP-1', text: 'any update?' });
});

test('BL-298 topic-reply-03: a non-principal reply on a backlog item\'s topic is still dropped, never routed as context', () => {
  const update = mkUpdate({ fromId: 999, topicId: 42, text: 'let me in' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, () => undefined, () => 'BL-123');
  assert.deepEqual(decision, { action: 'drop', reason: 'not-principal' });
});

test('an unmapped topic with no backlog mapping either still opens a fresh SUP-### subject (unrelated brand-new topic, unchanged)', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 99, text: 'brand new' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, () => undefined, () => undefined);
  assert.deepEqual(decision, { action: 'open-for-topic', topicId: 99, text: 'brand new' });
});

test('decideUpdateAction called with only 3 args (no backlogForTopic) behaves exactly as before BL-298 - existing callers are unaffected', () => {
  const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: 99, text: 'brand new' });
  const decision = decideUpdateAction(update, PRINCIPAL_ID, () => undefined);
  assert.deepEqual(decision, { action: 'open-for-topic', topicId: 99, text: 'brand new' });
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
    getUpdates: async () => ({ success: false, updates: [], error: 'network error' }),
    postToBridge: async () => true,
    subjectForTopic: () => undefined,
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
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
    openSubjectAndRecord: stubOpenSubjectAndRecord(),
    nextOffset: (updates, current) => current + updates.length,
  });
  assert.equal(result.posted, 0);
  assert.equal(result.dropped, 1);
});

// ── pollAndForward open-and-record path — BL-294 auto-open-01/02/03 ──────

test('BL-294 auto-open-01: a DM with no default subject yet opens one via openSubjectAndRecord and counts it posted', async () => {
  const opened = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, text: 'hello' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a fresh open - openSubjectAndRecord already delivered it');
    },
    subjectForTopic: () => undefined,
    openSubjectAndRecord: async (topicId, text) => {
      opened.push({ topicId, text });
      return 'SUP-500';
    },
    nextOffset: (updates, current) => current + updates.length,
  });
  assert.deepEqual(opened, [{ topicId: undefined, text: 'hello' }]);
  assert.equal(result.posted, 1);
  assert.equal(result.dropped, 0);
});

test('BL-294 auto-open-02: an unmapped topic opens a subject FOR that topic via openSubjectAndRecord', async () => {
  const opened = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
    getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: 42, text: 'new topic' })] }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a fresh open');
    },
    subjectForTopic: () => undefined,
    openSubjectAndRecord: async (topicId, text) => {
      opened.push({ topicId, text });
      return 'SUP-501';
    },
    nextOffset: (updates, current) => current + updates.length,
  });
  assert.deepEqual(opened, [{ topicId: 42, text: 'new topic' }]);
  assert.equal(result.posted, 1);
});

test('BL-294 auto-open-03: a second message in an already-mapped context posts to the SAME subject, opening no second one', async () => {
  let opens = 0;
  const posted = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
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

test('BL-298 topic-reply-02: a SUP-### subject\'s topic still posts via postToBridge (no regression), never postOperatorContext', async () => {
  const posted = [];
  const result = await pollAndForward(0, PRINCIPAL_ID, {
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

test('relaySseReplies posts a telegram-reply record into its mapped topic', async () => {
  const sent = [];
  await relaySseReplies('', {
    readChunk: mkChunkReader(['event: telegram-reply\ndata: {"threadId":"SUP-1","text":"hello"}\n\n']),
    sendReply: async (topicId, text) => {
      sent.push({ topicId, text });
    },
    topicForSubject: (subjectId) => (subjectId === 'SUP-1' ? 42 : undefined),
  });
  assert.deepEqual(sent, [{ topicId: 42, text: 'hello' }]);
});

test('relaySseReplies drops a reply for an unmapped thread id, never throws', async () => {
  const sent = [];
  await relaySseReplies('', {
    readChunk: mkChunkReader(['event: telegram-reply\ndata: {"threadId":"SUP-9","text":"hi"}\n\n']),
    sendReply: async (topicId, text) => {
      sent.push({ topicId, text });
    },
    topicForSubject: () => undefined,
  });
  assert.deepEqual(sent, []);
});

test('relaySseReplies ignores a record that is not a telegram-reply event', () => {
  const sent = [];
  return relaySseReplies('', {
    readChunk: mkChunkReader(['event: some-other-event\ndata: {"threadId":"SUP-1","text":"hi"}\n\n']),
    sendReply: async (topicId, text) => {
      sent.push({ topicId, text });
    },
    topicForSubject: () => 42,
  }).then(() => assert.deepEqual(sent, []));
});

test('relaySseReplies drains multiple records buffered across chunks before reading the next one', async () => {
  const sent = [];
  await relaySseReplies('', {
    readChunk: mkChunkReader([
      'event: telegram-reply\ndata: {"threadId":"SUP-1","text":"first"}\n\nevent: telegram-reply\ndata: {"threadId":"SUP-2","text":"second"}\n\n',
    ]),
    sendReply: async (topicId, text) => {
      sent.push({ topicId, text });
    },
    topicForSubject: (subjectId) => ({ 'SUP-1': 1, 'SUP-2': 2 })[subjectId],
  });
  assert.deepEqual(sent, [
    { topicId: 1, text: 'first' },
    { topicId: 2, text: 'second' },
  ]);
});

test('relaySseReplies returns cleanly once readChunk reports done', async () => {
  await relaySseReplies('', {
    readChunk: mkChunkReader([]),
    sendReply: async () => {
      throw new Error('should never be called');
    },
    topicForSubject: () => 1,
  });
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
  const cycle = await runPollCycle({ offset: 0, consecutiveFailures: 2 }, PRINCIPAL_ID, fakeCycleAdapters({ success: true, updates: [update] }), BACKOFF_CONFIG);
  assert.equal(cycle.state.offset, 1);
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
