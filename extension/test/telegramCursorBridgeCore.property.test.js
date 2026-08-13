const assert = require('node:assert/strict');
const fc = require('fast-check');
const { shouldUseCursorBridgeInboundQueue, parseCursorBridgeState } = require('../out/tools/telegramCursorBridgeCore');

// BL-764 invariant #1: "At most one process calls Telegram getUpdates for a
// given bot token; any second consumer of that token reads its updates from
// the on-disk fan-out instead." shouldUseCursorBridgeInboundQueue is the
// config decision that keeps the bridge off getUpdates whenever it might be
// sharing a token with the front desk. The unit suite pins five hand-picked
// env combinations; this property drives the whole input space (arbitrary
// flag strings, not just '0'/'1', and arbitrary tokens, not just set/unset)
// and checks the invariant's actual shape: the bridge only ever calls
// getUpdates itself (returns false) when an operator EXPLICITLY forced it
// off or configured its own exclusive token - never as a default/fallback
// that could leave a shared token polled from two places. Runs ONLY via
// `npm run test:properties`.
const flagArb = fc.oneof(
  fc.constant(undefined),
  fc.constant('0'),
  fc.constant('1'),
  fc.string({ maxLength: 6 }),
  fc.constantFrom(' 0 ', ' 1 ', '0 ', ' 1', '01', 'true', 'false')
);
const tokenArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.constant('   '),
  fc.string({ minLength: 1, maxLength: 20 })
);

test('property: shouldUseCursorBridgeInboundQueue only skips the queue (returns false) when explicitly forced off or an exclusive token is configured', () => {
  fc.assert(
    fc.property(flagArb, tokenArb, (flag, token) => {
      const env = { CURSOR_BRIDGE_INBOUND_QUEUE: flag, CURSOR_BRIDGE_BOT_TOKEN: token };
      const result = shouldUseCursorBridgeInboundQueue(env);
      const forcedOn = flag?.trim() === '1';
      const forcedOff = flag?.trim() === '0';
      const hasExclusiveToken = Boolean(token?.trim());

      if (forcedOn) {
        assert.equal(result, true, 'an explicit "1" must always win, even with an exclusive token configured');
        return;
      }
      if (forcedOff) {
        assert.equal(result, false, 'an explicit "0" must always force getUpdates mode');
        return;
      }
      assert.equal(
        result,
        !hasExclusiveToken,
        'absent an explicit flag, queue mode must track whether an exclusive token is configured - never default to false (getUpdates) with no justification'
      );
    }),
    { numRuns: 300 }
  );
});

// BL-767 invariant #2: "A bridge state file written before this change
// still parses and still drains; a missing origin topic is a fallback,
// never a parse failure and never a dropped prompt." Sweeps arbitrary
// persisted records with and without originTopicId through the parser -
// a pre-BL-767 state file (field entirely absent) is one point in this
// space, not a special case. Runs ONLY via `npm run test:properties`.

const validTopicIdArb = fc.integer({ min: 1, max: 1_000_000 });
const malformedOriginArb = fc.oneof(
  fc.string(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.integer(), { maxLength: 3 }),
  fc.dictionary(fc.string(), fc.integer())
);
// undefined here means "field entirely absent from the raw record" - the
// exact shape of a pre-BL-767 state file.
const rawOriginArb = fc.oneof(fc.constant(undefined), validTopicIdArb, malformedOriginArb);

function withOriginField(base, originValue) {
  return originValue === undefined ? base : { ...base, originTopicId: originValue };
}

test('property: parseCursorBridgeState never throws and never drops a queued prompt or choice poll over an absent/malformed originTopicId', () => {
  fc.assert(
    fc.property(
      validTopicIdArb, // cursorTopicId
      fc.string({ minLength: 1, maxLength: 40 }), // prompt text
      rawOriginArb, // prompt's raw originTopicId field
      rawOriginArb, // choice poll's raw originTopicId field
      (cursorTopicId, promptText, promptOrigin, pollOrigin) => {
        const rawPrompt = withOriginField(
          { id: 'qp-1', text: promptText, createdAtMs: 1000 },
          promptOrigin
        );
        const rawPoll = withOriginField(
          { pollId: 'poll-1', question: 'Which?', options: ['a', 'b'], createdAtMs: 1000 },
          pollOrigin
        );
        const raw = {
          updateOffset: 5,
          cursorTopicId,
          pendingPrompts: [rawPrompt],
          pendingChoicePolls: [rawPoll],
        };

        // Never a parse failure — must not throw, on any input shape.
        const state = parseCursorBridgeState(raw);

        // Never a dropped prompt / poll — both survive regardless of
        // whether their origin field was absent, valid, or malformed.
        assert.equal(state.pendingPrompts?.length, 1, 'a queued prompt must never be dropped for its origin field alone');
        assert.equal(state.pendingChoicePolls?.length, 1, 'a choice poll must never be dropped for its origin field alone');

        // A missing/malformed origin is a FALLBACK (field simply absent
        // from the parsed record) - never carried through as garbage.
        const expectPromptOrigin = typeof promptOrigin === 'number' ? promptOrigin : undefined;
        const expectPollOrigin = typeof pollOrigin === 'number' ? pollOrigin : undefined;
        assert.equal(state.pendingPrompts[0].originTopicId, expectPromptOrigin);
        assert.equal(state.pendingChoicePolls[0].originTopicId, expectPollOrigin);
      }
    ),
    { numRuns: 300 }
  );
});

test('property: parseCursorBridgeState parses a pre-BL-767 file (originTopicId absent from every record) exactly as before - no crash, no field', () => {
  fc.assert(
    fc.property(validTopicIdArb, fc.string({ minLength: 1, maxLength: 40 }), (cursorTopicId, promptText) => {
      const raw = {
        updateOffset: 1,
        cursorTopicId,
        pendingPrompts: [{ id: 'qp-legacy', text: promptText, createdAtMs: 1 }],
        pendingPromptPoll: { pollId: 'poll-legacy', itemIds: ['qp-legacy'] },
      };
      const state = parseCursorBridgeState(raw);
      assert.equal(state.cursorTopicId, cursorTopicId);
      assert.equal(state.pendingPrompts.length, 1);
      assert.equal(state.pendingPrompts[0].originTopicId, undefined);
      assert.equal(state.pendingPromptPoll.pollId, 'poll-legacy');
    }),
    { numRuns: 100 }
  );
});
