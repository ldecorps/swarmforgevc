const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  composeAskButtons,
  decideCallbackQueryAction,
  decideCursorBridgeExclusion,
  pollAndForward,
  recordApprovalDecisionAndClose,
  relaySseReplies,
  roleAskThreadId,
  roleFromAskThreadId,
  ROLE_ASK_THREAD_PREFIX,
} = require('../out/tools/telegramFrontDeskBotCore');

// BL-483: composeAskButtons (encode: option -> callback_data) and
// decideCallbackQueryAction (decode: callback_data -> {threadId, optionIndex})
// are the two halves of one wire round-trip - a tap must always resolve back
// to the exact option it was rendered for, across ANY threadId/options shape,
// not just the two hand-picked examples telegramFrontDeskBotCore.test.js pins.
// threadId is constrained to exclude ':' per composeAskButtons/
// ASK_CALLBACK_DATA_PATTERN's own documented contract (a SUP-### id never
// contains one - the pattern's trailing `:<digits>` is what makes the split
// unambiguous). Runs ONLY via `npm run test:properties`; excluded from the
// normal unit/coverage/mutation run.
const PRINCIPAL_ID = 111;
const MY_CHAT_ID = '1';

function mkCallbackUpdate(data) {
  return { id: 'cbq-1', data, from: { id: PRINCIPAL_ID }, message: { chat: { id: 1 } } };
}

const threadIdArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/);
const optionArb = fc.record(
  { label: fc.string({ minLength: 1, maxLength: 40 }), description: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }) },
  { requiredKeys: ['label'] }
);
const optionsArb = fc.array(optionArb, { minLength: 1, maxLength: 8 });

test('property: every button composeAskButtons renders decodes back to its own threadId and index via decideCallbackQueryAction', () => {
  fc.assert(
    fc.property(threadIdArb, optionsArb, (threadId, options) => {
      const rows = composeAskButtons(threadId, options);
      rows.forEach((row, index) => {
        const callbackData = row[0].callbackData;
        const decision = decideCallbackQueryAction(mkCallbackUpdate(callbackData), PRINCIPAL_ID, MY_CHAT_ID);
        assert.deepEqual(decision, { action: 'answer-ask', threadId, optionIndex: index });
      });
    }),
    { numRuns: 200 }
  );
});

// BL-496: closeApprovalAskIfPossible's bounded retry-after retry loop
// (editApprovalAskWithBoundedRateLimitRetry, private - reached only through
// the exported recordApprovalDecisionAndClose) has an invariant the hand-
// picked unit tests each pin at one budget/outcome-sequence combination:
// the loop attempts at most `budget` edits, stops at the FIRST attempt that
// either succeeds or fails WITHOUT a retry-after (never over-retrying a
// terminal rejection), and retries every OTHER attempt exactly once,
// waiting exactly that attempt's own told-you-so retryAfterSeconds. This
// property generalizes that stopping rule across arbitrary budgets and
// arbitrary outcome sequences rather than the handful of examples the unit
// suite pins. Runs ONLY via `npm run test:properties`.
const rateLimitedOutcomeArb = fc.integer({ min: 1, max: 5 }).map((retryAfterSeconds) => ({ type: 'rateLimited', retryAfterSeconds }));
const terminalOutcomeArb = fc.string({ minLength: 1, maxLength: 20 }).map((error) => ({ type: 'terminal', error }));
const outcomeArb = fc.oneof(fc.constant({ type: 'success' }), rateLimitedOutcomeArb, terminalOutcomeArb);
const budgetAndOutcomesArb = fc
  .integer({ min: 1, max: 6 })
  .chain((budget) => fc.tuple(fc.constant(budget), fc.array(outcomeArb, { minLength: budget, maxLength: budget })));

// Mirrors editApprovalAskWithBoundedRateLimitRetry's own stopping rule, to
// compute what the loop SHOULD do for a given outcome sequence/budget.
function expectedRetryBehavior(outcomes, budget) {
  const waits = [];
  for (let attempt = 1; attempt <= budget; attempt += 1) {
    const outcome = outcomes[attempt - 1];
    if (outcome.type !== 'rateLimited') {
      return { stopAttempt: attempt, outcome, waits };
    }
    if (attempt < budget) {
      waits.push(outcome.retryAfterSeconds * 1000);
    }
  }
  return { stopAttempt: budget, outcome: outcomes[budget - 1], waits };
}

test('property: the ask-close retry loop stops at the first success/terminal outcome, bounded by its budget, waiting each rate-limited attempt its own retry-after', () => {
  fc.assert(
    fc.asyncProperty(budgetAndOutcomesArb, async ([budget, outcomes]) => {
      const expected = expectedRetryBehavior(outcomes, budget);
      const edits = [];
      const waits = [];
      const errors = [];
      const adapters = {
        recordApprovalReply: async () => true,
        recordRejectionReply: async () => true,
        readApprovalAskMessage: async () => ({ topicId: 800, messageId: 999, text: 'BL-PROP needs your approval...' }),
        editApprovalAskMessage: async () => {
          const outcome = outcomes[edits.length];
          edits.push(outcome);
          if (outcome.type === 'success') {
            return { success: true };
          }
          if (outcome.type === 'rateLimited') {
            return { success: false, retryAfterSeconds: outcome.retryAfterSeconds };
          }
          return { success: false, error: outcome.error };
        },
        waitForAskCloseRetry: async (ms) => {
          waits.push(ms);
        },
        askCloseRetryBudget: budget,
      };
      const originalErrorWrite = process.stderr.write;
      process.stderr.write = (chunk) => {
        errors.push(chunk);
        return true;
      };
      let changed;
      try {
        changed = await recordApprovalDecisionAndClose(adapters, 'BL-PROP', { kind: 'approved' }, 0);
      } finally {
        process.stderr.write = originalErrorWrite;
      }

      assert.equal(changed, true, 'the decision recording succeeds regardless of how the edit resolves');
      assert.equal(edits.length, expected.stopAttempt, 'expected the loop to stop at the first success/terminal outcome, bounded by budget');
      assert.deepEqual(waits, expected.waits, 'expected exactly one wait per rate-limited attempt before the stop, each its own retry-after');

      if (expected.outcome.type === 'success') {
        assert.equal(errors.length, 0, 'a successful close must never log a failure');
      } else if (expected.outcome.type === 'terminal') {
        assert.ok(
          errors.some((e) => e.includes('BL-PROP') && e.includes(expected.outcome.error)),
          `expected the real terminal rejection reason logged, got: ${JSON.stringify(errors)}`
        );
      } else {
        assert.ok(
          errors.some((e) => e.includes('BL-PROP') && e.includes('rate-limited') && e.includes(String(expected.outcome.retryAfterSeconds))),
          `expected a loud rate-limit-exhausted warning naming the last retry-after, got: ${JSON.stringify(errors)}`
        );
      }
    }),
    { numRuns: 200 }
  );
});

// BL-607 (architect, property support): roleAskThreadId (a role -> the
// synthetic threadId its clarifying question's ask-message mapping and
// callback_data are keyed under) and roleFromAskThreadId (the inverse the
// button-tap / free-text answer path uses to recover WHICH role asked) are
// one encode/decode pair spanning the bb ask side (role_ask.bb writes the
// same ROLE_ASK_THREAD_PREFIX) and the TS answer side. The whole role-
// question mechanism silently MISROUTES an answer if the two ever drift, so
// the round-trip must hold for EVERY role name, not just the eight the unit
// examples pin. Runs ONLY via `npm run test:properties`.
const KNOWN_ROLES = ['coordinator', 'specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
// Role names are colon-free by contract (composeAskButtons/
// ASK_CALLBACK_DATA_PATTERN's `[^:]+` capture - see roleAskThreadId's own
// comment) - the arbitrary mirrors that, mixing the real roles with
// arbitrary colon-free names so a future role rename can never regress it.
const roleArb = fc.oneof(fc.constantFrom(...KNOWN_ROLES), fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/));

test('property: roleFromAskThreadId inverts roleAskThreadId for every role name', () => {
  fc.assert(
    fc.property(roleArb, (role) => {
      assert.equal(roleFromAskThreadId(roleAskThreadId(role)), role);
    }),
    { numRuns: 300 }
  );
});

// The other half of the same guard: a threadId that does NOT carry the
// role-ask prefix - in particular a real Operator SUP-### ask threadId -
// must NEVER be misread as a role, or scenario 06's "the Operator's
// SUP-thread ask path stays byte-identical" regression guarantee breaks (a
// role question and an Operator question would contend for delivery). Any
// non-prefixed string resolves to undefined, keeping the two ask worlds
// disjoint. Runs ONLY via `npm run test:properties`.
const nonRolePrefixedArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !s.startsWith(ROLE_ASK_THREAD_PREFIX));

test('property: a threadId without the role-ask prefix (a real Operator SUP-### ask) never resolves to a role', () => {
  fc.assert(
    fc.property(nonRolePrefixedArb, (threadId) => {
      assert.equal(roleFromAskThreadId(threadId), undefined);
    }),
    { numRuns: 300 }
  );
});

// BL-764 invariant #2: "An inbound update addressed to a bridge-owned topic
// is either forwarded to that bridge or explicitly dropped with a recorded
// reason - never routed to SUP/Operator, and never silently discarded."
// decideCursorBridgeExclusion is the pure gate; pollAndForward is where a
// wrongly-routed update would actually reach SUP/Operator. This drives
// arbitrary Host/Bubble topic configurations and arbitrary candidate topic
// ids through the gate (generalizing past the handful of fixed topic ids
// telegramFrontDeskBotCore.test.js pins), then drives an owned-topic update
// through the real poll loop with the SUP/Operator adapters (postToBridge,
// openSubjectAndRecord, postOperatorContext) wired to throw if invoked -
// a misroute fails the run loudly instead of passing silently. Runs ONLY
// via `npm run test:properties`.
const CB_PRINCIPAL_ID = 111;
function cbUpdate(topicId) {
  return {
    update_id: 1,
    message: { message_id: 1, chat: { id: 1 }, from: { id: CB_PRINCIPAL_ID }, message_thread_id: topicId, text: 'hi' },
  };
}
const ownedTopicsArb = fc.record({
  cursorTopicId: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
  bubbleTopicId: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
});
const candidateTopicIdArb = fc.oneof(fc.integer({ min: 1, max: 100000 }), fc.constant(undefined));

test('property: decideCursorBridgeExclusion drops iff the update topic is owned (Host or Bubble), for any owned-topic combination', () => {
  fc.assert(
    fc.property(ownedTopicsArb, candidateTopicIdArb, (owned, topicId) => {
      const decision = decideCursorBridgeExclusion(cbUpdate(topicId), [owned.cursorTopicId, owned.bubbleTopicId]);
      const isOwned = topicId !== undefined && (topicId === owned.cursorTopicId || topicId === owned.bubbleTopicId);
      assert.equal(decision, isOwned ? 'drop' : 'not-applicable');
    }),
    { numRuns: 300 }
  );
});

const forwardModeArb = fc.constantFrom('wired-ok', 'wired-fail', 'unwired');

test('property: pollAndForward never routes an owned-topic update to SUP/Operator, for any Host/Bubble topic and any forward outcome', async () => {
  await fc.assert(
    fc.asyncProperty(ownedTopicsArb, forwardModeArb, async (owned, forwardMode) => {
      fc.pre(owned.cursorTopicId !== undefined || owned.bubbleTopicId !== undefined);
      const targetTopicId = owned.cursorTopicId ?? owned.bubbleTopicId;
      const forwarded = [];
      const adapters = {
        chatId: '1',
        cursorBridgeTopicId: async () => owned.cursorTopicId,
        bubbleTopicId: async () => owned.bubbleTopicId,
        getUpdates: async () => ({ success: true, updates: [cbUpdate(targetTopicId)] }),
        subjectForTopic: () => 'SUP-12',
        backlogForTopic: () => undefined,
        postToBridge: async () => {
          throw new Error('SUP/Operator postToBridge must never be called for an owned topic');
        },
        openSubjectAndRecord: async () => {
          throw new Error('SUP/Operator openSubjectAndRecord must never open a subject for an owned topic');
        },
        postOperatorContext: async () => {
          throw new Error('SUP/Operator postOperatorContext must never be called for an owned topic');
        },
        ...(forwardMode === 'unwired'
          ? {}
          : {
              forwardCursorBridgeUpdate: async (u) => {
                forwarded.push(u);
                return forwardMode === 'wired-ok';
              },
            }),
      };
      const result = await pollAndForward(0, CB_PRINCIPAL_ID, adapters);
      if (forwardMode === 'wired-ok') {
        assert.equal(result.posted, 1, 'a successfully forwarded update must be counted posted');
        assert.equal(forwarded.length, 1);
      } else if (forwardMode === 'wired-fail') {
        assert.equal(result.failed, 1, 'a failed forward must be counted failed, not silently dropped');
      } else {
        assert.equal(result.dropped, 1, 'an unwired bridge topic must be an explicit, counted drop');
      }
      assert.equal(result.posted + result.dropped + result.failed, 1, 'exactly one outcome recorded for the one update - never lost, never double-counted');
    }),
    { numRuns: 150 }
  );
});

// BL-708 invariant #2 (coder-authored, ticket-declared): "A question record
// the front desk cannot deliver leaves a surfaced trace (log line or
// counter) before its id is acked - never a silent ack that reads as
// delivered." deliverRoleQuestion (relayOneRecord's roleQuestion branch) is
// the only place a roleQuestion record can become undeliverable -
// roleTopicIdFor resolving undefined for a role absent from
// role-topic-map.json - and relayOneRecord always acks afterward regardless
// (the bridge cannot distinguish "decided to drop" from "never seen"; see
// deliverRoleQuestion's own comment). This property drives arbitrary role
// names and arbitrary roleTopicIdFor outcomes (mapped vs unmapped, and an
// arbitrary topic id when mapped) through the real relaySseReplies wiring
// and asserts: whenever the role is unmapped, exactly one console.error
// trace naming that role fires strictly before ackReply; whenever it is
// mapped, no trace ever fires and delivery proceeds before the ack.
// telegramFrontDeskBotCore.test.js pins this at one fixed role name
// ("nobody"); this generalizes across role names fast-check constructs.
//
// Non-vacuous: removing the console.error call from deliverRoleQuestion's
// undefined-topicId branch fails this property on the first unmapped case
// generated - confirmed manually before restoring the fix.
//
// Generator reach: mappedArb independently forces both the unmapped branch
// (no topic id) and the mapped branch (an arbitrary topic id) on every run,
// so both of deliverRoleQuestion's two outcomes are reachable by
// construction, not by sampling luck. Runs ONLY via `npm run test:properties`.
function mkSingleChunkReader(chunk) {
  let sent = false;
  return async () => {
    if (sent) {
      return { done: true, chunk: '' };
    }
    sent = true;
    return { done: false, chunk };
  };
}

const undeliverableRoleArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/);
const mappedArb = fc.boolean();
const topicIdArb = fc.integer({ min: 1, max: 100000 });

test('property: an undeliverable roleQuestion always surfaces exactly one trace naming the role BEFORE ackReply; a deliverable one never traces at all', async () => {
  await fc.assert(
    fc.asyncProperty(undeliverableRoleArb, mappedArb, topicIdArb, async (role, mapped, topicId) => {
      const order = [];
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        order.push('trace');
      });
      const record = { id: 'r1', threadId: `role-ask-${role}`, text: 'which environment?', roleQuestion: role };
      const sse = `event: telegram-reply\ndata: ${JSON.stringify(record)}\n\n`;
      try {
        await relaySseReplies(
          '',
          {
            readChunk: mkSingleChunkReader(sse),
            sendReply: async () => {
              order.push('send');
            },
            roleTopicIdFor: async () => (mapped ? topicId : undefined),
            resolveDelivery: () => {
              throw new Error('resolveDelivery must never be consulted for a roleQuestion record');
            },
            ackReply: async () => {
              order.push('ack');
            },
          },
          new Set()
        );

        // Read the spy's recorded calls BEFORE mockRestore() below - restore
        // also clears mock.calls (same as mockReset), so asserting on it
        // afterward would always see zero calls regardless of what happened.
        if (mapped) {
          assert.equal(errorSpy.mock.calls.length, 0, 'a deliverable roleQuestion must never surface an undeliverable trace');
          assert.deepEqual(order, ['send', 'ack']);
        } else {
          assert.equal(errorSpy.mock.calls.length, 1, 'an undeliverable roleQuestion must leave exactly one surfaced trace');
          assert.match(errorSpy.mock.calls[0][0], new RegExp(role), 'the trace must name the role the question could not be delivered to');
          assert.deepEqual(order, ['trace', 'ack'], 'the trace must fire strictly before the ack - never a silent ack that reads as delivered');
        }
      } finally {
        errorSpy.mockRestore();
      }
    }),
    { numRuns: 200 }
  );
});

// ── GH-26: an undeliverable roleQuestion must ALSO rewrite the role's own
// awaiting marker (markRoleQuestionUndeliverable) - never leaving it in its
// original pending shape, which is what wedges the asking role in
// "already-pending" forever behind a guard that thinks its question is
// still in flight. Generalizes BL-708's own mapped/unmapped property above
// to also assert the marker-rewrite side: exactly one call, naming the SAME
// role/question/options the record carried (forensics preserved
// byte-for-byte, GH-26's approval_context choice 1), strictly before
// ackReply; a deliverable roleQuestion never calls it at all.
//
// Non-vacuous: removing the markRoleQuestionUndeliverable call from
// deliverRoleQuestion's undefined-topicId branch fails this property on the
// first unmapped case generated - confirmed manually before restoring the
// fix.
//
// Generator reach: mappedArb independently forces both the unmapped branch
// (marker must be rewritten) and the mapped branch (marker must be left
// alone) on every run; optionsOrNilArb independently forces both an
// options-carrying and a bare question, so all four (mapped x has-options)
// combinations are reachable by construction, not by sampling luck. Runs
// ONLY via `npm run test:properties`.
const questionTextArb = fc.string({ minLength: 1, maxLength: 60 });
const optionsOrNilArb = fc.option(optionsArb, { nil: undefined });

test('property: an undeliverable roleQuestion always rewrites the awaiting marker (exactly once, forensics preserved) BEFORE ackReply; a deliverable one never touches it', async () => {
  await fc.assert(
    fc.asyncProperty(undeliverableRoleArb, mappedArb, topicIdArb, questionTextArb, optionsOrNilArb, async (role, mapped, topicId, text, options) => {
      const order = [];
      const marked = [];
      const record = { id: 'r1', threadId: `role-ask-${role}`, text, roleQuestion: role, ...(options ? { options } : {}) };
      const sse = `event: telegram-reply\ndata: ${JSON.stringify(record)}\n\n`;
      // options travels the SAME JSON round trip real records do (outbox
      // JSONL -> SSE -> JSON.parse in relayOneRecord) before deliverRoleQuestion
      // ever sees it - normalizing the expectation the same way makes this
      // an apples-to-apples comparison regardless of fast-check's own
      // internal representation of a generated record (e.g. a null-prototype
      // object, which JSON never distinguishes from a plain one).
      const expectedOptions = options === undefined ? undefined : JSON.parse(JSON.stringify(options));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await relaySseReplies(
          '',
          {
            readChunk: mkSingleChunkReader(sse),
            sendReply: async () => {
              order.push('send');
            },
            roleTopicIdFor: async () => (mapped ? topicId : undefined),
            resolveDelivery: () => {
              throw new Error('resolveDelivery must never be consulted for a roleQuestion record');
            },
            ackReply: async () => {
              order.push('ack');
            },
            markRoleQuestionUndeliverable: async (r, q, o) => {
              marked.push({ role: r, question: q, options: o });
              order.push('mark');
            },
          },
          new Set()
        );

        if (mapped) {
          assert.deepEqual(marked, [], 'a deliverable roleQuestion must never rewrite the awaiting marker');
          assert.deepEqual(order, ['send', 'ack']);
        } else {
          assert.deepEqual(
            marked,
            [{ role, question: text, options: expectedOptions }],
            'the marker rewrite must name the SAME role/question/options the record carried'
          );
          assert.deepEqual(order, ['mark', 'ack'], 'the marker rewrite must fire strictly before the ack');
        }
      } finally {
        errorSpy.mockRestore();
      }
    }),
    { numRuns: 200 }
  );
});
