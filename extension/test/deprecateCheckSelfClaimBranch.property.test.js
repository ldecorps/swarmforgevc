'use strict';

// BL-1268 invariant 1: "A ticket that names another ticket's disposition never
// holds on the generic-claim branch; a ticket that claims its own still does."
//
// Generator reach: the two states this quantifies over are (a) a claim about
// ANOTHER ticket and (b) a claim about THIS one, and the failure the invariant
// guards against sits at their boundary - a predicate that cannot tell them
// apart passes either half alone. The generator draws the subject class as an
// explicit oneof and asserts a floor on BOTH classes at the end of each
// property, so a shrink or a weighting accident that stopped generating one
// half turns the test red rather than quietly making it vacuous. The claim
// word, the carrying field and the surrounding filler are drawn independently,
// so neither class is tested through a single hard-coded sentence.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { findSelfClaim, evaluateDeprecatorFreshness } = require('../out/tools/deprecate-check');

const OWN_ID = 'BL-9';
const CLAIM_WORDS = ['superseded', 'retired', 'obsolete'];
const PROSE_FIELDS = ['description', 'notes', 'approval_context', 'constraints'];
const STRUCTURED_FIELDS = ['status', 'closed_as', 'superseded_by', 'disposition'];
const OTHER_IDS = ['BL-1', 'BL-800', 'BL-1173'];
const FILLER = [
  'Recorded while adjudicating the freshness hold.',
  'Background for the reader, not a disposition.',
  'See the epic tracker for the rest of the chain.',
];

function facts(yamlText, overrides = {}) {
  return {
    ticketId: OWN_ID,
    yamlText,
    pausedPathExists: true,
    dependsOnIds: [],
    dependsOnAllDone: false,
    doneClosureExists: false,
    retiredSurfaceHits: [],
    specGapBounceCount: 0,
    ...overrides,
  };
}

/** A notes/description line stating some OTHER ticket's disposition. */
function crossReferenceTicket(field, claim, otherId, filler) {
  return `id: ${OWN_ID}\n${field}: |\n  ${filler}\n  ${otherId} was ${claim} in 2026-08.\n`;
}

/** The same claim word, but predicated on this ticket. */
function selfClaimTicket(field, claim, structured, filler) {
  if (structured) {
    return `id: ${OWN_ID}\n${field}: ${claim}\n`;
  }
  return `id: ${OWN_ID}\n${field}: |\n  ${filler}\n  This ticket is ${claim}.\n`;
}

test('property: a claim about another ticket never holds, a claim about this one always does', () => {
  let sawCross = 0;
  let sawSelf = 0;
  fc.assert(
    fc.property(
      fc.constantFrom(...CLAIM_WORDS),
      fc.constantFrom(...OTHER_IDS),
      fc.constantFrom(...FILLER),
      fc.constantFrom(...PROSE_FIELDS),
      fc.constantFrom(...STRUCTURED_FIELDS),
      fc.boolean(),
      fc.boolean(),
      (claim, otherId, filler, proseField, structuredField, isSelf, structured) => {
        if (!isSelf) {
          sawCross += 1;
          const yamlText = crossReferenceTicket(proseField, claim, otherId, filler);
          assert.equal(findSelfClaim(yamlText, OWN_ID), null, `cross-reference read as a self-claim:\n${yamlText}`);
          assert.equal(evaluateDeprecatorFreshness(facts(yamlText)).decision, 'allow');
          return;
        }
        sawSelf += 1;
        const field = structured ? structuredField : proseField;
        const yamlText = selfClaimTicket(field, claim, structured, filler);
        const found = findSelfClaim(yamlText, OWN_ID);
        assert.ok(found, `self-claim went undetected:\n${yamlText}`);
        assert.equal(found.field, field);
        const decision = evaluateDeprecatorFreshness(facts(yamlText));
        assert.equal(decision.decision, 'hold');
        // The reason has to name the field, or the specifier is back to
        // grepping the whole ticket - which is most of what an adjudication cost.
        assert.ok(decision.reason.includes(`'${field}'`), decision.reason);
      }
    ),
    { numRuns: 300 }
  );
  // Reachability floor, asserted rather than hoped for: both halves of the
  // boundary must actually have been generated.
  assert.ok(sawCross > 40, `expected cross-reference tickets to be drawn, saw ${sawCross}`);
  assert.ok(sawSelf > 40, `expected self-claim tickets to be drawn, saw ${sawSelf}`);
});

test('property: a done closure clears the self-claim hold, and nothing else re-opens it', () => {
  let sawStructured = 0;
  let sawProse = 0;
  fc.assert(
    fc.property(
      fc.constantFrom(...CLAIM_WORDS),
      fc.constantFrom(...PROSE_FIELDS),
      fc.constantFrom(...STRUCTURED_FIELDS),
      fc.constantFrom(...FILLER),
      fc.boolean(),
      (claim, proseField, structuredField, filler, structured) => {
        structured ? (sawStructured += 1) : (sawProse += 1);
        const field = structured ? structuredField : proseField;
        const yamlText = selfClaimTicket(field, claim, structured, filler);
        assert.equal(evaluateDeprecatorFreshness(facts(yamlText)).decision, 'hold');
        assert.equal(
          evaluateDeprecatorFreshness(facts(yamlText, { doneClosureExists: true })).decision,
          'allow'
        );
      }
    ),
    { numRuns: 200 }
  );
  assert.ok(sawStructured > 30, `expected structured self-claims, saw ${sawStructured}`);
  assert.ok(sawProse > 30, `expected prose self-claims, saw ${sawProse}`);
});
