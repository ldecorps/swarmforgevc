'use strict';

// BL-1272 invariants 1 and 2, coder-authored per BL-654. Both drive the REAL
// land_step_lib.bb through specs/pipeline/steps/lib/bl1272LandDecisionCli.bb -
// invariant 2's cases each build a real repository with a real bare origin,
// because the defect only exists because a tip-pure replay is a DIFFERENT
// commit object, and a mocked git layer cannot exhibit that.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(
  REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'bl1272LandDecisionCli.bb'
);
const SIBLINGS = ['BL-9002', 'BL-9003'];

function batch(query, cases) {
  const out = execFileSync('bb', [CLI, query, JSON.stringify(cases)], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 300000,
  });
  return JSON.parse(out.trim().split('\n').pop());
}

describe('BL-1272 invariant 1: landed is a positive finding, never an inference', () => {
  it('reports landed only when a COMPLETE walk found every attributed path identical', () => {
    const caseArb = fc
      .array(fc.string({ minLength: 1, maxLength: 8 }).filter((s) => !s.includes(' ')), {
        maxLength: 4,
      })
      .chain((drawn) => {
        const paths = [...new Set(drawn)];
        return fc.record({
          paths: fc.constant(paths),
          complete: fc.boolean(),
          nilPaths: fc.boolean(),
          same: fc.array(fc.boolean(), { minLength: paths.length, maxLength: paths.length }),
        });
      });

    // One bb process for the whole property, not one per draw (BL-1556):
    // the 60 cases are drawn up front and answered in a single
    // landed-batch query. Shrinking is lost, so the seed is logged and
    // each case's own inputs are printed in its assertion message.
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
    const drawn = fc.sample(caseArb, { numRuns: 60, seed });
    console.log(`BL-1556 reach map (invariant 1): ${JSON.stringify({ cases: drawn.length, seed })}`);

    const results = batch(
      'landed-batch',
      drawn.map(({ paths, complete, nilPaths, same }) => ({
        paths: nilPaths ? null : paths,
        complete,
        same,
      }))
    );

    drawn.forEach(({ paths, complete, nilPaths, same }, i) => {
      const effectivePaths = nilPaths ? null : paths;
      const landed = results[i];

      // The claim, stated as an equivalence so neither direction can rot:
      // landed exactly when the walk RAN completely, found something, and
      // found all of it already identical.
      const expected =
        complete && effectivePaths !== null && effectivePaths.length > 0 && same.every(Boolean);
      assert.equal(
        landed,
        expected,
        `case ${i} (seed=${seed}): paths=${JSON.stringify(effectivePaths)} complete=${complete} same=${JSON.stringify(same)}`
      );

      // And the fail-closed half on its own, so a refactor that made the
      // equivalence accidentally true cannot hide it: an incomplete or
      // unrun check NEVER reports landed.
      if (!complete || effectivePaths === null || effectivePaths.length === 0) {
        assert.equal(
          landed,
          false,
          `case ${i} (seed=${seed}): an unanswered check reported the sibling as landed`
        );
      }
    });
  });

  it('is not vacuous: the identical, complete, non-empty case really does report landed', () => {
    const [landed] = batch('landed-batch', [
      { paths: ['a.txt', 'b.txt'], complete: true, same: [true, true] },
    ]);
    assert.equal(landed, true);
  });
});

describe('BL-1272 invariant 2: the land step action is unchanged', () => {
  it('decides the same action however many ancestor siblings have already landed', () => {
    // The space is every subset of the ancestor siblings, which is finite and
    // tiny, so it is ENUMERATED rather than sampled - a reach floor asserted
    // after a random draw can miss the all-landed subset on an unlucky seed,
    // and that subset is the one this invariant is really about.
    const subsets = [[], [SIBLINGS[0]], [SIBLINGS[1]], [...SIBLINGS]];
    const results = batch('action-batch', subsets.map((land) => ({ land })));

    for (const [i, result] of results.entries()) {
      const landed = subsets[i];
      assert.equal(
        result.action,
        'replay',
        `landing ${JSON.stringify(landed)} changed the action to ${result.action}`
      );
      // The decision input is untouched: every ancestor sibling is still in
      // :entangled, landed or not. Its original commit is still an ancestor
      // and may carry content the replay deliberately excluded.
      assert.deepEqual(result.entangled, [...SIBLINGS].sort());
      // Only the REPORT moves.
      assert.deepEqual(result.landed, [...landed].sort());
      assert.deepEqual(result.unlanded, SIBLINGS.filter((s) => !landed.includes(s)).sort());
    }

    // Non-vacuity of the comparison itself: the four cases really were
    // different situations, not four runs of the same one.
    assert.deepEqual(results.map((r) => r.landed.length), [0, 1, 1, 2]);
  });
});
