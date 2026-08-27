const assert = require('node:assert/strict');
const fc = require('fast-check');
const { isCursorAgentGone, shouldResetCursorAgentSession } = require('../out/tools/telegramCursorBridgeCore');

const agentIdSuffixArb = fc.array(
  fc.constantFrom(...'0123456789abcdef'.split('')),
  { minLength: 8, maxLength: 16 }
).map((chars) => `agent-${chars.join('')}`);

function goneMessage(agentId, variant) {
  const core = `Agent ${agentId} not found`;
  switch (variant) {
    case 'canonical':
      return `${core}.`;
    case 'no-stop':
      return core;
    case 'upper':
      return core.toUpperCase() + '.';
    case 'prose':
      return `Something went wrong: ${core}. Please retry.`;
    default:
      return core;
  }
}

test('property: a message naming an agent id as not found is gone regardless of surface formatting', () => {
  fc.assert(
    fc.property(agentIdSuffixArb, fc.constantFrom('canonical', 'no-stop', 'upper', 'prose'), (agentId, variant) => {
      const message = goneMessage(agentId, variant);
      assert.equal(isCursorAgentGone(message), true, `expected gone for ${variant}: ${message}`);
      assert.equal(shouldResetCursorAgentSession(message), true);
    }),
    { numRuns: 200 }
  );
});

test('property: bare not-found without an agent id is never classified gone', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 40 }), (prefix) => {
      const message = `${prefix}Agent not found.`.slice(-80);
      if (/\bagent\s+agent-[a-z0-9-]+\s+not found\b/i.test(message)) {
        return;
      }
      assert.equal(isCursorAgentGone(message), false, `must not match without agent id: ${message}`);
    }),
    { numRuns: 200 }
  );
});

test('property: removing case-insensitivity would miss capitalized vendor prose', () => {
  const agentId = 'agent-deadbeef';
  const upper = `AGENT ${agentId.toUpperCase()} NOT FOUND.`;
  assert.equal(isCursorAgentGone(upper), true);
  assert.equal(/\bagent\s+agent-[a-z0-9-]+\s+not found\b/.test(upper), false);
});
