const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  composeAskButtons,
  decideCallbackQueryAction,
  recordApprovalDecisionAndClose,
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
