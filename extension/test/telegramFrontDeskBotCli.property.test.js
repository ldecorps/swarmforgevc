const assert = require('node:assert/strict');
const fc = require('fast-check');
const { composeRoleAnswerNoteMessage } = require('../out/tools/telegram-front-desk-bot');

// BL-607 (architect, property support): composeRoleAnswerNoteMessage builds
// the single-line `message:` header of the note that carries a human's
// clarifying-question answer back to a DORMANT role (dormant-pane leg 2).
// That header is embedded verbatim into a swarm_handoff.bb draft, whose
// grammar is strictly one `field: value` per line and caps `message:` at 80
// chars - so a raw newline or other control char in the answer turns the
// 2nd line into a bogus header and swarm_handoff.bb REJECTS the whole draft,
// silently dropping exactly the answer the role is waiting for. That is the
// defect this ticket bounced on twice (architect bounce 2): the hand-picked
// examples in telegramFrontDeskBotCli.test.js pin the failure at one 2-line
// string, but the invariant is universal - for ANY answer text a human can
// type, the produced header must be a valid single-line swarm_handoff.bb
// `message:` value: NO control character and <= 80 chars, routing anything
// that would not fit through the pointer-file fallback instead.
//
// This property generalizes that whole safety contract across the entire
// input space (control chars at arbitrary positions, multiple newlines,
// unicode, arbitrary length) rather than the four points the example suite
// pins. Runs ONLY via `npm run test:properties`; excluded from the normal
// unit/coverage/mutation run per engineering.prompt's separation rule.

// Role is a controlled value drawn from the eight real swarm roles (the
// topic map's own key set - see roleTopicMapStore); the UNTRUSTED input is
// the answer text, which is what the property stresses. Kept consistent with
// telegramFrontDeskBotCore.property.test.js's KNOWN_ROLES.
const KNOWN_ROLES = ['coordinator', 'specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
const roleArb = fc.constantFrom(...KNOWN_ROLES);

// An answer-text arbitrary that deliberately peppers control characters
// (newlines, CR, tab, NUL, DEL, other C0) among ordinary printable and
// unicode text, so the sanitization is exercised at arbitrary positions and
// lengths - not just the single mid-string newline the example pins.
const printableCharArb = fc.constantFrom(...'abcXYZ0123 ./-_:é中');
const controlCharArb = fc.constantFrom('\n', '\r', '\t', '\x00', '\x0b', '\x1f', '\x7f');
const answerCharArb = fc.oneof({ weight: 3, arbitrary: printableCharArb }, { weight: 1, arbitrary: controlCharArb });
const answerTextArb = fc.oneof(
  fc.array(answerCharArb, { maxLength: 200 }).map((cs) => cs.join('')),
  // fast-check v4: `unit: 'binary'` draws arbitrary UTF-16 code units,
  // including every C0/C1 control char and DEL - broad coverage of any
  // byte a human's typed answer could carry.
  fc.string({ unit: 'binary', maxLength: 200 }),
);

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /[\x00-\x1f\x7f]/;

test('property: composeRoleAnswerNoteMessage always yields a valid single-line swarm_handoff.bb message header (no control char, <= 80 chars) for any answer text', () => {
  fc.assert(
    fc.property(roleArb, answerTextArb, (role, text) => {
      const message = composeRoleAnswerNoteMessage(role, text);
      assert.doesNotMatch(message, CONTROL_CHAR, `the queued note message must be a single control-char-free line, got: ${JSON.stringify(message)}`);
      assert.ok(message.length <= 80, `the queued note message must fit swarm_handoff.bb's 80-char cap, got ${message.length}: ${JSON.stringify(message)}`);
    }),
    { numRuns: 500 }
  );
});
