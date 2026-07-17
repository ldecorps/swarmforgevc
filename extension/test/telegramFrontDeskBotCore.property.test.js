const assert = require('node:assert/strict');
const fc = require('fast-check');
const { composeAskButtons, decideCallbackQueryAction } = require('../out/tools/telegramFrontDeskBotCore');

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
