const assert = require('node:assert/strict');
const fc = require('fast-check');
const { decisionLineFor, composeDecidedAskText } = require('../out/concierge/approvalAskClosing');

// BL-484: composeDecidedAskText's own explicit contract - "Keeps the
// original ask text ABOVE the appended decision line" - is a formatting-
// stability invariant across ANY original ask text (arbitrary length,
// arbitrary characters, including embedded newlines), not just the two
// hand-picked strings approvalAskClosing.test.js pins. Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs); excluded from
// the normal unit/coverage/mutation run.
const verdictArb = fc.oneof(
  fc.constant({ kind: 'approved' }),
  fc.string().map((reason) => ({ kind: 'rejected', reason }))
);

test('property: composeDecidedAskText always preserves the original text verbatim as a prefix, with the decision line appended verbatim after it', () => {
  fc.assert(
    fc.property(fc.string(), verdictArb, fc.integer({ min: 0, max: 8640000000000 }), (original, verdict, nowMs) => {
      const composed = composeDecidedAskText(original, verdict, nowMs);
      const expectedLine = decisionLineFor(verdict, nowMs);
      assert.equal(composed, `${original}\n${expectedLine}`);
    }),
    { numRuns: 200 }
  );
});
