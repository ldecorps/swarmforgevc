'use strict';

// BL-1201 architect bounce round 3 D1 (backlog/evidence/BL-1201-architect-bounce-round3-20260828.md):
// the ticket's two declared invariants had no executable property test.
// Both are encoded here against generated asked_at_ms pairs and answer text.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { deliverRoleAnswer, roleAnswerFilePointerPath, roleAwaitingAnswerPath } = require('../out/tools/telegram-front-desk-bot');

function writeAwaiting(root, role, askedAtMs) {
  const abs = roleAwaitingAnswerPath(root, role);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ question: 'q', asked_at_ms: askedAtMs }));
}

function writeAnswer(root, role, { text, askedAtMs }) {
  const abs = path.join(root, roleAnswerFilePointerPath(role));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const record = { text, recordedAt: new Date().toISOString() };
  if (askedAtMs !== undefined) {
    record.askedAtMs = askedAtMs;
  }
  fs.writeFileSync(abs, JSON.stringify(record));
}

function readAnswer(root, role) {
  return JSON.parse(fs.readFileSync(path.join(root, roleAnswerFilePointerPath(role)), 'utf8'));
}

function awaitingExists(root, role) {
  return fs.existsSync(roleAwaitingAnswerPath(root, role));
}

const askedAtMsArb = fc.integer({ min: 0, max: 2_000_000_000_000 });

// BL-871 property-generator trap: two INDEPENDENTLY drawn large integers
// collide with vanishing probability, so an arbitrary built that way would
// never exercise the "matched" delivery path at all - the property would
// pass vacuously on the mismatch branch alone. answerAskedAtMs is instead
// DERIVED from pendingAskedAtMs: 'same' forces a genuine collision
// candidate, 'different' forces a guaranteed non-match, 'undefined' models
// "captured with no question pending" (the fail-closed case the ticket's
// own description calls out explicitly).
function deriveAnswerAskedAtMs(pendingAskedAtMs, mode) {
  if (mode === 'same') return pendingAskedAtMs;
  if (mode === 'different') return pendingAskedAtMs + 1;
  return undefined;
}
const askedAtMsModeArb = fc.constantFrom('same', 'different', 'undefined');
const answerTextArb = fc.oneof(
  fc.constant(''),
  fc.string({ maxLength: 200 }),
  fc.string({ minLength: 300, maxLength: 500 })
);

test('BL-1201 P1: delivery matches iff answer.askedAtMs === the pending question askedAtMs; the pending question survives every non-match', () => {
  fc.assert(
    fc.property(askedAtMsArb, askedAtMsModeArb, answerTextArb, (pendingAskedAtMs, mode, text) => {
      const answerAskedAtMs = deriveAnswerAskedAtMs(pendingAskedAtMs, mode);
      const root = mkTmpDir('sfvc-bl1201-p1-');
      const role = 'specifier';
      writeAwaiting(root, role, pendingAskedAtMs);
      writeAnswer(root, role, { text, askedAtMs: answerAskedAtMs });

      const result = deliverRoleAnswer(root, role);
      const shouldMatch = answerAskedAtMs !== undefined && answerAskedAtMs === pendingAskedAtMs;

      if (shouldMatch) {
        assert.equal(result.kind, 'delivered');
        assert.equal(result.text, text);
        assert.equal(awaitingExists(root, role), false, 'a matched delivery clears the pending question');
        const stored = readAnswer(root, role);
        assert.notEqual(stored.consumedAt, undefined, 'a matched delivery marks consumedAt');
      } else {
        assert.equal(result.kind, 'mismatch');
        assert.equal(awaitingExists(root, role), true, 'a mismatch never clears the pending question');
        const stored = readAnswer(root, role);
        assert.equal(stored.consumedAt, undefined, 'a mismatch never marks consumedAt');
        assert.equal(stored.text, text, 'a mismatch never alters the stored text');
      }
    }),
    { numRuns: 200 }
  );
});

test('BL-1201 P2: an answer\'s text is always recoverable from disk after ANY delivery attempt, matched or not - never destroyed', () => {
  fc.assert(
    fc.property(askedAtMsArb, askedAtMsModeArb, answerTextArb, fc.integer({ min: 1, max: 3 }), (pendingAskedAtMs, mode, text, attempts) => {
      const answerAskedAtMs = deriveAnswerAskedAtMs(pendingAskedAtMs, mode);
      const root = mkTmpDir('sfvc-bl1201-p2-');
      const role = 'specifier';
      writeAwaiting(root, role, pendingAskedAtMs);
      writeAnswer(root, role, { text, askedAtMs: answerAskedAtMs });

      for (let i = 0; i < attempts; i += 1) {
        deliverRoleAnswer(root, role);
        // Re-arm the pending question between attempts ONLY for the
        // mismatch case, so a repeated mismatch keeps exercising the same
        // "not consumed" path rather than degenerating into repeated
        // no-answer/already-consumed calls after the first delivery.
        if (!(answerAskedAtMs !== undefined && answerAskedAtMs === pendingAskedAtMs) && !awaitingExists(root, role)) {
          writeAwaiting(root, role, pendingAskedAtMs);
        }
        const stored = readAnswer(root, role);
        assert.equal(stored.text, text, `text must survive delivery attempt ${i + 1} of ${attempts} unchanged`);
      }
    }),
    { numRuns: 200 }
  );
});

// Non-vacuity (break-then-fix discipline): fixed cases proving each
// property is sensitive to the module's real output.
test('BL-1201 non-vacuity: a known match delivers and a known mismatch refuses', () => {
  const root1 = mkTmpDir('sfvc-bl1201-nv-');
  writeAwaiting(root1, 'coder', 5000);
  writeAnswer(root1, 'coder', { text: 'yes', askedAtMs: 5000 });
  const matched = deliverRoleAnswer(root1, 'coder');
  assert.equal(matched.kind, 'delivered');

  const root2 = mkTmpDir('sfvc-bl1201-nv-');
  writeAwaiting(root2, 'coder', 5000);
  writeAnswer(root2, 'coder', { text: 'yes', askedAtMs: 4999 });
  const mismatched = deliverRoleAnswer(root2, 'coder');
  assert.equal(mismatched.kind, 'mismatch');

  assert.throws(() => assert.equal(mismatched.kind, 'delivered'));
});
