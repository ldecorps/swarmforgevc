'use strict';

// BL-1767 declared invariant (coder first authorship - BL-654):
//
// "Every planted passing-certification scorecard in the four files carries
// every member of model_steward_lib's safety-critical-competencies as
// pass, read from the lib when the test runs or asserted equal to it
// (BL-897), so adding a competency to that set leaves all four files
// green."
//
// The durable, generically-testable half of that invariant is the pure
// transform every one of the four fixture sites now shares
// (specs/pipeline/steps/lib/modelStewardSafetyCard.js's
// passingSafetyEntries): whatever the lib's safety-critical-competencies
// set turns out to be at run time, building a scorecard's safety entries
// from it (rather than a hand-copied literal) always marks every member of
// that set as `pass`, with no member dropped, added, or given any other
// status. That is exactly the property that makes a future competency
// addition leave the fixtures green without a fixture edit - three of the
// four sites (bl547, bl556, bl1079) call this function directly; the
// fourth (the bash script) mirrors the same algorithm reading the same
// live source (evaluated by the real acceptance/shell runs, not this
// property - see the coder evidence for the non-encodability note on the
// wiring half).
//
// Generator reach: every draw is a fresh set of distinct, non-blank
// competency-name strings (0-20 of them), so the empty set, a single
// competency, and many competencies are all reachable by construction -
// not by hoping a random corpus happens to include the edge sizes.
//
// Non-vacuity (staged-first restore, recorded in the parcel commit):
//   break 1 - passingSafetyEntries ignores its argument and always returns
//     [] : RED on the first draw with any competency (missing-length
//     assertion fires).
//   break 2 - passingSafetyEntries drops the last name (`.slice(0, -1)`):
//     RED on the first non-empty draw (length assertion fires).
//   break 3 - passingSafetyEntries hardcodes status "fail": RED on the
//     first non-empty draw (status assertion fires).
// All three restored byte-for-byte; ALL PROPERTIES HOLD.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { passingSafetyEntries } = require('../../specs/pipeline/steps/lib/modelStewardSafetyCard');

function competencyNameArb() {
  return fc.uniqueArray(fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0), {
    minLength: 0,
    maxLength: 20,
  });
}

describe('BL-1767: passingSafetyEntries builds a full, exact, all-passing safety card', () => {
  it('carries every given competency, none dropped or added, every status "pass"', () => {
    fc.assert(
      fc.property(competencyNameArb(), (names) => {
        const entries = passingSafetyEntries(names);

        assert.equal(entries.length, names.length, 'entry count must match the given competency count exactly');

        const gotNames = entries.map((e) => e.competency);
        assert.deepEqual(gotNames, names, 'competency names must match the input, same order, none dropped or added');

        for (const entry of entries) {
          assert.equal(entry.status, 'pass', `every built entry must be status "pass", got: ${JSON.stringify(entry)}`);
        }

        // The property this exists to protect: adding a competency to the
        // set (simulated here by re-deriving from names + one more) still
        // yields a full, all-passing card - no site-specific ceiling.
        const grown = [...names, `${names.length}-extra-competency`];
        const grownEntries = passingSafetyEntries(grown);
        assert.equal(grownEntries.length, grown.length);
        assert.ok(
          grownEntries.every((e) => e.status === 'pass'),
          'a grown competency set must still yield an all-passing card'
        );
      }),
      { numRuns: 200 }
    );
  });
});
