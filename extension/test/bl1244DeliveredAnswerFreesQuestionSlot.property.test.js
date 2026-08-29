'use strict';

// BL-1244 declared invariant 1 (coder first authorship - BL-654):
//
//   "An answer that has been delivered to a role leaves that role able to
//    raise its next question."
//
// Invariant 2 ("the slot never opens on a mismatched/absent answer") is
// BL-1201's own guarantee, unchanged by this ticket - exercised here
// alongside invariant 1 as the fail-closed control case, never re-owned.
//
// Drives the REAL deliverRoleAnswer (extension/out/tools/telegram-front-
// desk-bot.js) against a real fixture directory - never a reimplementation
// of the pairing/consume logic - over a generated askedAtMs and answer
// text. This is exactly what confirmRoleAnswerDelivery (wired in
// telegramFrontDeskBotCore.ts's captureRoleAnswer, BL-1244) now calls once
// a dormant-pane note is successfully enqueued; enqueueRoleAnswerNote's
// own shell-out to swarm_handoff.bb is exercised separately by the
// pollAndForward-level unit tests in telegramFrontDeskBotCore.test.js
// (BL-1244: confirmRoleAnswerDelivery is invoked / never invoked), which
// prove the WIRING; this property generalizes the CONFIRM decision itself
// over a wide generated domain.
//
// The marker and answer files are written directly (fs.writeFileSync),
// the SAME convention deliverRoleAnswerCli.test.js's own writeAwaiting
// helper already uses for the marker - deliverRoleAnswer's own exported
// path helpers (roleAwaitingAnswerPath, roleAnswerFilePointerPath) are
// used verbatim, so only the file CONTENT is test-authored, never the path
// resolution.
//
// Runs ONLY via `npm run test:properties`.
//
// Non-vacuity: reverting deliverRoleAnswer's pairing check to always
// "delivered" (ignoring askedAtMs) makes the invariant-2 control property
// fail immediately - a changed marker would be wrongly cleared.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  roleAwaitingAnswerPath,
  roleAnswerFilePointerPath,
  readRoleAwaitingAnswer,
  deliverRoleAnswer,
} = require('../out/tools/telegram-front-desk-bot');

function writeAwaiting(root, role, askedAtMs) {
  const abs = roleAwaitingAnswerPath(root, role);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ question: 'which environment?', asked_at_ms: askedAtMs }));
}

function writeAnswer(root, role, text, askedAtMs) {
  const abs = path.join(root, roleAnswerFilePointerPath(role));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const record = { text, recordedAt: new Date().toISOString() };
  if (askedAtMs !== undefined) record.askedAtMs = askedAtMs;
  fs.writeFileSync(abs, JSON.stringify(record));
}

test('BL-1244/BL-654 invariant 1: a captured answer whose askedAtMs matches the pending question reopens the slot', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
      fc.string({ minLength: 1, maxLength: 40 }),
      (askedAtMs, answerText) => {
        const root = mkTmpDir('sfvc-bl1244-prop-');
        try {
          writeAwaiting(root, 'specifier', askedAtMs);
          // The exact moment enqueueRoleAnswerNote's own writeRoleAnswerFile
          // stamps the answer file - the currently-pending marker's own
          // askedAtMs, read at capture time.
          writeAnswer(root, 'specifier', answerText, askedAtMs);

          const result = deliverRoleAnswer(root, 'specifier');
          assert.equal(result.kind, 'delivered', `expected a matching askedAtMs to deliver, got: ${JSON.stringify(result)}`);
          assert.equal(result.text, answerText);

          // Invariant 1: the slot is open again - the role can raise its next question.
          assert.equal(readRoleAwaitingAnswer(root, 'specifier'), undefined);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 25 }
  );
});

test('BL-1244/BL-654 invariant 2 (control, BL-1201-owned): a marker that changed since capture leaves the slot shut', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 1_000_000_000 }),
      fc.integer({ min: 1, max: 1_000_000_000 }),
      fc.string({ minLength: 1, maxLength: 40 }),
      (askedAtMsAtCapture, laterAskedAtMs, answerText) => {
        fc.pre(askedAtMsAtCapture !== laterAskedAtMs);
        const root = mkTmpDir('sfvc-bl1244-prop-');
        try {
          writeAnswer(root, 'specifier', answerText, askedAtMsAtCapture);
          // A NEW question replaced the pending marker before anything
          // confirmed the old answer - the exact race BL-1201's pairing
          // check exists to refuse.
          writeAwaiting(root, 'specifier', laterAskedAtMs);

          const result = deliverRoleAnswer(root, 'specifier');
          assert.equal(result.kind, 'mismatch', `expected a changed marker to refuse delivery, got: ${JSON.stringify(result)}`);
          assert.notEqual(readRoleAwaitingAnswer(root, 'specifier'), undefined, 'the new question marker must survive a mismatched confirm attempt');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 25 }
  );
});

test('BL-1244/BL-654 invariant 2 (control): no answer recorded at all leaves the slot shut', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), (askedAtMs) => {
      const root = mkTmpDir('sfvc-bl1244-prop-');
      try {
        writeAwaiting(root, 'specifier', askedAtMs);
        const result = deliverRoleAnswer(root, 'specifier');
        assert.equal(result.kind, 'no-answer');
        assert.notEqual(readRoleAwaitingAnswer(root, 'specifier'), undefined);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 10 }
  );
});
