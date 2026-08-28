'use strict';

// BL-1211 architect bounce round 2 D1 (backlog/evidence/BL-1211-architect-bounce-round2-20260828.md):
// the ticket's three declared invariants had no property test. Encoded here
// against generated BounceResurrectionFact arrays.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  isUnauthorizedResurrection,
  decideRecoveryFilter,
  decideQuarantineLift,
} = require('../out/quality/bounceResurrectionVerdict');

const contentWords = ['alpha', 'bravo', 'charlie', 'delta'];
const roleArb = fc.constantFrom('coder', 'cleaner', 'architect', 'hardener', 'documenter', 'qa');

// BL-871 property-generator trap: candidateContent must be DERIVED from
// bouncedContent, not drawn independently - two independently-chosen
// content strings essentially never collide, which would leave the
// "byte-identical" branch (the entire point of these invariants) almost
// never exercised.
const contentModeArb = fc.constantFrom('same-as-bounced', 'different', 'null');

function deriveCandidateContent(bouncedContent, mode) {
  if (mode === 'null') return null;
  if (mode === 'same-as-bounced' && bouncedContent !== null) return bouncedContent;
  // 'different', or 'same-as-bounced' when bouncedContent is itself null
  // (nothing to collide with) - either way, pick a word guaranteed not to
  // equal bouncedContent.
  return contentWords.find((w) => w !== bouncedContent) ?? 'zzz-never-collides';
}

const factArb = fc
  .record({
    ticket: fc.stringMatching(/^BL-[0-9]{1,5}$/),
    path: fc.stringMatching(/^[a-z][a-z0-9/_.-]{0,20}$/),
    bouncedContent: fc.option(fc.constantFrom(...contentWords), { nil: null }),
    contentMode: contentModeArb,
    authoredBackBy: fc.option(fc.record({ commit: fc.stringMatching(/^[0-9a-f]{10}$/), role: roleArb }), { nil: null }),
  })
  .map((r) => ({
    ticket: r.ticket,
    path: r.path,
    bouncedContent: r.bouncedContent,
    candidateContent: deriveCandidateContent(r.bouncedContent, r.contentMode),
    authoredBackBy: r.authoredBackBy,
  }));

// The specification, computed independently of isUnauthorizedResurrection -
// never call the function under test to build its own expectation.
function expectedUnauthorized(fact) {
  return (
    fact.bouncedContent !== null &&
    fact.candidateContent !== null &&
    fact.candidateContent === fact.bouncedContent &&
    fact.authoredBackBy === null
  );
}

test('BL-1211 P1 (invariants 1 & 3): unauthorized iff byte-identical to what the bounce introduced AND nothing authored it back', () => {
  fc.assert(
    fc.property(factArb, (fact) => {
      const expected = expectedUnauthorized(fact);
      assert.equal(isUnauthorizedResurrection(fact), expected);

      const [decision] = decideRecoveryFilter([fact]);
      assert.equal(decision.path, fact.path);
      assert.equal(decision.restore, !expected, 'a recovery holds back a path iff it is an unauthorized resurrection');
    }),
    { numRuns: 300 }
  );
});

test('BL-1211 P2 (invariant 2): the lift refuses iff ANY generated fact is an unauthorized resurrection, and names every one', () => {
  fc.assert(
    fc.property(fc.array(factArb, { minLength: 0, maxLength: 6 }), (facts) => {
      const expectedUnauthorizedFacts = facts.filter(expectedUnauthorized);
      const verdict = decideQuarantineLift(facts);

      if (expectedUnauthorizedFacts.length > 0) {
        assert.equal(verdict.granted, false);
        const expectedTickets = [...new Set(expectedUnauthorizedFacts.map((f) => f.ticket))];
        assert.deepEqual([...verdict.refusedTickets].sort(), expectedTickets.sort());
        assert.deepEqual(
          [...verdict.refusedPaths].sort(),
          expectedUnauthorizedFacts.map((f) => f.path).sort()
        );
        assert.deepEqual(verdict.authorizedBy, []);
      } else {
        assert.equal(verdict.granted, true);
        assert.deepEqual(verdict.refusedTickets, []);
        assert.deepEqual(verdict.refusedPaths, []);
      }
    }),
    { numRuns: 300 }
  );
});

// Non-vacuity (break-then-fix discipline): fixed cases proving each
// property is sensitive to the module's real output.
test('BL-1211 non-vacuity: a byte-identical unauthorized resurrection refuses; an authored-back one lifts', () => {
  const unauthorized = { ticket: 'BL-1', path: 'a.ts', bouncedContent: 'x', candidateContent: 'x', authoredBackBy: null };
  const authorized = { ticket: 'BL-2', path: 'b.ts', bouncedContent: 'x', candidateContent: 'x', authoredBackBy: { commit: '1234567890', role: 'coder' } };
  const differentContent = { ticket: 'BL-3', path: 'c.ts', bouncedContent: 'x', candidateContent: 'y', authoredBackBy: null };

  assert.equal(isUnauthorizedResurrection(unauthorized), true);
  assert.equal(isUnauthorizedResurrection(authorized), false);
  assert.equal(isUnauthorizedResurrection(differentContent), false);

  const verdict = decideQuarantineLift([authorized, differentContent]);
  assert.equal(verdict.granted, true);

  const refusedVerdict = decideQuarantineLift([unauthorized, authorized]);
  assert.equal(refusedVerdict.granted, false);
  assert.deepEqual(refusedVerdict.refusedTickets, ['BL-1']);

  assert.throws(() => assert.equal(refusedVerdict.granted, true));
});
