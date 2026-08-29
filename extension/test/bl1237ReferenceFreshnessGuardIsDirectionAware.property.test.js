'use strict';

// BL-1237 declared invariant 1 (coder first authorship - BL-654):
//
//   "A worktree is refused only for reference content it is MISSING
//    relative to main — never for content it carries that main does not
//    yet have."
//
// Drives the REAL swarmforge/scripts/reference_freshness_lib.bb
// (stale-paths, 3-arity) - never a JS reimplementation of the pure
// decision - over generated content-sha pairs and ancestry-absorbed
// booleans. The real git/ancestry wiring (path-ancestry-absorbed? in
// ready_for_next.bb) is proven end to end by the ticket's own acceptance
// scenarios (specs/pipeline/steps/bl1237ReferenceFreshnessDirectionSteps.js)
// against real git fixtures; this property generalizes the pure decision
// the wiring depends on across a wider input domain.
//
// Runs ONLY via `npm run test:properties`.
//
// Non-vacuity: reverting the "absorbed -> allow" branch (treating every
// content difference as stale regardless of ancestry, the pre-BL-1237
// posture) makes this property fail on every generated case where the
// worktree/main shas differ and absorbed=true.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'reference_freshness_lib.bb');

function evalStalePaths(worktreeSha, mainSha, absorbed) {
  const script = `
(load-file "${LIB.replace(/\\/g, '/')}")
(require '[cheshire.core :as json])
(println (json/generate-string
  (reference-freshness-lib/stale-paths
    {"ref.prompt" ${JSON.stringify(worktreeSha)}}
    {"ref.prompt" ${JSON.stringify(mainSha)}}
    {"ref.prompt" ${absorbed}})))
`;
  const res = spawnSync('bb', ['-e', script], { encoding: 'utf8', timeout: 15_000 });
  if (res.status !== 0) {
    throw new Error(`bb eval failed:\n${res.stdout}${res.stderr}`);
  }
  return JSON.parse(res.stdout.trim());
}

test('BL-1237/BL-654 invariant 1: an absorbed (ancestor) difference is never reported stale', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.length > 0),
      (base, suffix) => {
        const worktreeSha = base;
        const mainSha = `${base}-${suffix}`; // derived, guaranteed different
        const result = evalStalePaths(worktreeSha, mainSha, true);
        assert.deepEqual(result, [], `expected an absorbed difference to never be reported stale, got: ${JSON.stringify(result)}`);
      }
    ),
    { numRuns: 30 }
  );
});

test('BL-1237/BL-654 invariant 1 (control, BL-640-owned): an unabsorbed difference is still reported stale', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.length > 0),
      (base, suffix) => {
        const worktreeSha = base;
        const mainSha = `${base}-${suffix}`;
        const result = evalStalePaths(worktreeSha, mainSha, false);
        assert.deepEqual(result, ['ref.prompt'], `expected an unabsorbed difference to still refuse, got: ${JSON.stringify(result)}`);
      }
    ),
    { numRuns: 30 }
  );
});

test('BL-1237/BL-654 invariant 1: identical content is never stale, regardless of the ancestry answer', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 20 }), fc.boolean(), (sha, absorbed) => {
      const result = evalStalePaths(sha, sha, absorbed);
      assert.deepEqual(result, []);
    }),
    { numRuns: 15 }
  );
});
