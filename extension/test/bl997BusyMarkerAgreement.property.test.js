'use strict';

// BL-997 declared invariant 2 (property authorship rests with the coder,
// first pass - BL-654): "when the check fails it names both literals, so
// the drift is diagnosable without reading both languages and without
// knowing which side moved." Drives the REAL checkAgreement
// (specs/pipeline/steps/lib/bl997AgreementCheck.js - the same function the
// acceptance steps and bl997BusyMarkerAgreement.test.js both call) over
// EVERY boolean pair - a small, exhaustively-coverable domain (fast-check
// still drives it generatively rather than a hand-written 4-case table, so
// it stays the project's standard property shape and is free to extend if
// this domain ever widens).
//
// Invariant 1 ("the busy definition exists in exactly one place per side,
// and a test asserts the two agree") has no separate property encoding
// here - it is a static code-organization fact (one Babashka function, one
// TypeScript function), not a parameterized behavior to sweep, and its
// executable encoding IS the agreement test itself
// (bl997BusyMarkerAgreement.test.js's both-sides-agree-01 tests, run
// against the real classifiers). Stated reason recorded per BL-654's own
// "admits no executable encoding" clause.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { checkAgreement } = require('../../specs/pipeline/steps/lib/bl997AgreementCheck');

test('BL-997/BL-654 invariant 2: agreement never throws, disagreement always throws naming both verdicts', () => {
  fc.assert(
    fc.property(fc.boolean(), fc.boolean(), (babashka, typescript) => {
      if (babashka === typescript) {
        assert.doesNotThrow(() => checkAgreement(babashka, typescript));
        return;
      }
      assert.throws(
        () => checkAgreement(babashka, typescript),
        (err) => {
          assert.match(err.message, new RegExp(`babashka=${babashka}\\b`));
          assert.match(err.message, new RegExp(`typescript=${typescript}\\b`));
          return true;
        }
      );
    }),
    { numRuns: 50 }
  );
});

// Non-vacuity (staged-first restore, run 2026-08-20, recorded in the parcel
// commit): break - checkAgreement's body replaced with a no-op (never
// throws) - RED on every disagreement draw (both directions). Restored,
// ALL PROPERTIES HOLD.
