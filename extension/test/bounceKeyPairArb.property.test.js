const assert = require('node:assert/strict');
const fc = require('fast-check');
const { bounceAttribution } = require('../out/quality/qaBounce');
const { pairArb, classifyPair, assertPairCoverage, CATEGORY_NAMES, keyComponentsMatch } = require('./support/bounceKeyPairArb');

// BL-768 coder-authored property tests (BL-654) for this ticket's two
// declared invariants. These are about the GENERATOR itself
// (bounceKeyPairArb.js), not about bounceNaturalKey's own behavior - that
// stays covered, unchanged, by bounceNaturalKey.property.test.js's three
// existing properties.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

// Invariant 1: "The coverage guard is satisfied by how pairs are
// constructed, not by how many are drawn: every category is reached at
// fast-check's default run count, for every seed." Quantify over an
// arbitrary seed (not a fixed handful) at fc.sample's default numRuns
// (100), and assert every category is reached for THAT seed. Before
// BL-768, this was true for ~97.4% of seeds, not "for every seed" - this
// property is non-vacuous exactly because it used to be able to fail: with
// the pre-BL-768 free-form-only generator, this same property (run
// against that generator) failed on roughly 1 seed in 39.
test('property (BL-768 declared invariant 1): every near-collision category is reached at the default run count, for any seed - coverage does not depend on which seed came up', () => {
  fc.assert(
    fc.property(fc.integer(), (seed) => {
      const samples = fc.sample(pairArb, { numRuns: 100, seed });
      const seen = new Set();
      for (const [a, b] of samples) {
        for (const name of classifyPair(a, b)) {
          seen.add(name);
        }
      }
      // Reuse the production guard itself, not a re-implementation of it -
      // a drifted copy here would let the guard degrade unnoticed.
      assertPairCoverage(seen);
    })
  );
});

// Invariant 2: "The restructured generator does not weaken the property -
// it still fails when the natural key is made coarser than its five
// components (pooling distinct bounces) or finer (breaking idempotency)."
// This is a property ABOUT the generator's adequacy: for a sample drawn at
// the default run count, the generator must produce at least one pair that
// would expose a COARSER key (here: dropping `by`, the failure BL-635/
// BL-590 exist to prevent) as wrong, and at least one pair that would
// expose a FINER key (here: keeping the full `at` instead of just its
// date, the failure that breaks backfill idempotency) as wrong. If the
// restructuring in BL-768 had accidentally narrowed pairArb to only the
// "happy path" categories, one or both of these would stop being reached
// and this test would fail.
function coarserKey(record) {
  // Drops `by` from the key entirely - two bounces on the same
  // ticket/day/class/commit but different attribution would wrongly pool.
  const dateOnly = record.at.slice(0, 10);
  return `${record.ticket}|${dateOnly}|${record.failureClass}|${record.commit}`;
}

function finerKey(record) {
  // Keeps the FULL `at` (time-of-day included) instead of just its date -
  // two bounces that are the SAME key would wrongly be treated as distinct.
  return `${record.ticket}|${record.at}|${record.failureClass}|${record.commit}|${bounceAttribution(record)}`;
}

test('property (BL-768 declared invariant 2): the generator still reaches a witness against a coarser key (drops `by`) and a finer key (keeps full `at`) - restructuring pairArb did not weaken what the property can catch', () => {
  let coarserWitnessFound = false;
  let finerWitnessFound = false;

  fc.assert(
    fc.property(pairArb, ([a, b]) => {
      // A coarser key would wrongly COLLAPSE this pair (equal under the
      // coarser key) even though the real key partition says they differ.
      if (coarserKey(a) === coarserKey(b) && !keyComponentsMatch(a, b)) {
        coarserWitnessFound = true;
      }
      // A finer key would wrongly SPLIT this pair (unequal under the finer
      // key) even though the real key partition says they are the same.
      if (finerKey(a) !== finerKey(b) && keyComponentsMatch(a, b)) {
        finerWitnessFound = true;
      }
    })
  );

  assert.equal(coarserWitnessFound, true, 'the generator never produced a pair that would expose a `by`-dropping (coarser) key as wrong');
  assert.equal(finerWitnessFound, true, 'the generator never produced a pair that would expose a full-`at` (finer) key as wrong');
});

// Non-vacuity companion for invariant 2's own two assertions: a generator
// that only ever produces IDENTICAL pairs (a === b in every field) would
// vacuously make both witness flags false forever - proving the property
// above is not trivially satisfiable by an empty or degenerate generator.
test('property (BL-768 non-vacuity companion): a degenerate generator that never varies its pair would fail invariant 2 - the witnesses above are not free', () => {
  const identityPairArb = pairArb.map(([a]) => [a, a]);
  let coarserWitnessFound = false;
  let finerWitnessFound = false;

  fc.assert(
    fc.property(identityPairArb, ([a, b]) => {
      if (coarserKey(a) === coarserKey(b) && !keyComponentsMatch(a, b)) {
        coarserWitnessFound = true;
      }
      if (finerKey(a) !== finerKey(b) && keyComponentsMatch(a, b)) {
        finerWitnessFound = true;
      }
    })
  );

  assert.equal(coarserWitnessFound, false, 'an identical pair can never expose a coarser key as wrong - both keys trivially match');
  assert.equal(finerWitnessFound, false, 'an identical pair can never expose a finer key as wrong - both keys trivially match');
});

// Non-vacuity companion for invariant 1: confirm the coverage guard itself
// still fails (rather than passing everything) when a category is
// genuinely missing - proven directly against a hand-built under-covering
// sample, independent of the acceptance suite's own version of this check.
test('property (BL-768 non-vacuity companion): the coverage guard fails, naming the gap, when a category is genuinely never reached', () => {
  const incompleteSeen = new Set(CATEGORY_NAMES.slice(1));
  assert.throws(() => assertPairCoverage(incompleteSeen), new RegExp(CATEGORY_NAMES[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
