const assert = require('node:assert/strict');
const fc = require('fast-check');
const { shouldUseCursorBridgeInboundQueue } = require('../out/tools/telegramCursorBridgeCore');

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
