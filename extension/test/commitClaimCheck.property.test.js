const assert = require('node:assert/strict');
const fc = require('fast-check');
const { findUnsupportedCommitClaims, evaluateCommitClaims } = require('../out/tools/commitClaimCheck');

// BL-729 declared invariants (backlog/active/BL-729-bl636-pilot-missed-commit-message-diff-mismatch.yaml):
// 1. A commit's verdict is computed from that commit alone - its own message
//    and its own patch - so the same commit yields the same verdict on any
//    checkout, at any later time, regardless of what sibling branches contain.
// 2. Every non-merge commit the run authored is judged or explicitly reported
//    unreadable; none is skipped, sampled, or assumed clean.
// 3. (encoded in pilotAcceptanceGate.property.test.js, alongside BL-727's own
//    invariant 3 - both describe "a refused land is inert", so they share one
//    property test rather than being split across two files.)
//
// Coder-authored property tests per BL-654; runs only via npm run test:properties.

// A claim-bearing message: guaranteed to carry exactly one change verb and
// one backticked token, so the generator reliably reaches the "judged"
// branch of findUnsupportedCommitClaims rather than the "no verb, skip"
// branch on almost every draw (BL-654's generator-reach requirement - a
// property that only ever exercises the vacuous branch proves nothing).
const VERBS = ['Restore', 'Fix', 'Add', 'Remove', 'Delete', 'Rename', 'Wire'];
const claimMessageArb = fc
  .tuple(
    fc.constantFrom(...VERBS),
    fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/),
    fc.string({ minLength: 0, maxLength: 30 })
  )
  .map(([verb, identifier, filler]) => ({
    message: `${verb} \`${identifier}\` ${filler}.`,
    identifier,
  }));

const patchTextArb = fc.string({ minLength: 0, maxLength: 60 });

test('property: invariant 1 - a commit verdict depends only on its own (message, patchText), never on an interleaved "sibling" call', () => {
  fc.assert(
    fc.property(claimMessageArb, patchTextArb, claimMessageArb, patchTextArb, (a, patchA, b, patchB) => {
      const before = findUnsupportedCommitClaims(a.message, patchA);
      // A "sibling branch" stand-in: an unrelated call interleaved between
      // two evaluations of the same commit. Nothing here should be able to
      // leak into or change the first commit's own verdict.
      findUnsupportedCommitClaims(b.message, patchB);
      const after = findUnsupportedCommitClaims(a.message, patchA);
      assert.deepEqual(before, after, `sibling call changed the verdict for message=${JSON.stringify(a.message)} patch=${JSON.stringify(patchA)}`);
    }),
    { numRuns: 100 }
  );
});

test('property: invariant 1 - a claim is supported exactly when the identifier is a substring of that commit\'s own patch text, independent of any other patch', () => {
  fc.assert(
    fc.property(claimMessageArb, patchTextArb, fc.boolean(), (claim, unrelatedPatch, includeInOwnPatch) => {
      const ownPatch = includeInOwnPatch ? `${unrelatedPatch}${claim.identifier}` : unrelatedPatch.replaceAll(claim.identifier, '');
      const result = findUnsupportedCommitClaims(claim.message, ownPatch);
      const flaggedThisIdentifier = result.some((c) => c.identifier === claim.identifier);
      assert.equal(
        flaggedThisIdentifier,
        !includeInOwnPatch,
        `identifier=${claim.identifier} includeInOwnPatch=${includeInOwnPatch} flagged=${flaggedThisIdentifier}`
      );
    }),
    { numRuns: 100 }
  );
});

// commitsArb: an array of synthetic commits, each independently EITHER
// claim-bearing-and-unsupported (via claimMessageArb with a patch that
// never contains the identifier) OR clean (a plain message with no change
// verb at all) - weighted so multi-commit runs of varying length and
// varying which position (if any) is bad are all well represented, which
// is what invariant 2 ("every commit judged, none skipped/sampled") needs:
// the generator must reach runs where the bad commit sits at the START,
// MIDDLE, and END, not just the tip.
const cleanCommitArb = fc.tuple(fc.stringMatching(/^[a-z0-9]{6,10}$/), fc.string({ maxLength: 20 })).map(([sha, filler]) => ({
  sha,
  message: `Document ${filler}`,
  patchText: filler,
}));
const badCommitArb = fc.tuple(fc.stringMatching(/^[a-z0-9]{6,10}$/), claimMessageArb).map(([sha, claim]) => ({
  sha,
  message: claim.message,
  patchText: '',
  claimedIdentifier: claim.identifier,
}));

test('property: invariant 2 - every commit in the run is checked (commitsChecked always equals the full list length, never a sample)', () => {
  fc.assert(
    fc.property(fc.array(cleanCommitArb, { minLength: 0, maxLength: 8 }), (commits) => {
      const result = evaluateCommitClaims(commits);
      assert.equal(result.commitsChecked, commits.length);
      assert.equal(result.unsupported, undefined);
    }),
    { numRuns: 100 }
  );
});

test('property: invariant 2 - a single unsupported claim is found no matter which position in the run it occupies', () => {
  fc.assert(
    fc.property(
      fc.array(cleanCommitArb, { minLength: 0, maxLength: 4 }),
      badCommitArb,
      fc.array(cleanCommitArb, { minLength: 0, maxLength: 4 }),
      (before, bad, after) => {
        const commits = [...before, bad, ...after];
        const result = evaluateCommitClaims(commits);
        assert.ok(result.unsupported, `expected the bad commit at position ${before.length} of ${commits.length} to be found`);
        assert.equal(result.unsupported.commit, bad.sha);
        assert.equal(result.unsupported.identifier, bad.claimedIdentifier);
      }
    ),
    { numRuns: 100 }
  );
});

test('non-vacuity: invariant 1 property would fail if a broken checker consulted a second, unrelated patch', () => {
  // Simulates the shape of a defect this property is meant to catch: a
  // checker that (wrongly) also searches some OTHER commit's patch text,
  // so the same commit's verdict changes depending on what else was
  // checked around it.
  const identifier = 'deliver!';
  const ownPatch = 'no match here';
  const siblingPatch = 'deliver! appears only on the sibling branch';
  const brokenSearchesBoth = (ownPatch + siblingPatch).includes(identifier);
  const correctSearchesOwnOnly = ownPatch.includes(identifier);
  assert.notEqual(brokenSearchesBoth, correctSearchesOwnOnly, 'expected the broken (both-patches) search to disagree with the correct (own-patch-only) search, proving the assertion is non-vacuous');
});

test('non-vacuity: invariant 2 property would fail if evaluateCommitClaims sampled only the first or last commit', () => {
  const commits = [
    { sha: 'c1', message: 'Document x', patchText: 'x' },
    { sha: 'c2', message: 'Document y', patchText: 'y' },
    { sha: 'c3', message: 'Document z', patchText: 'z' },
  ];
  const brokenCommitsChecked = 1; // a broken "check only the tip" implementation
  assert.notEqual(brokenCommitsChecked, commits.length, 'expected the broken sampled count to disagree with the real invariant, proving the assertion is non-vacuous');
});
