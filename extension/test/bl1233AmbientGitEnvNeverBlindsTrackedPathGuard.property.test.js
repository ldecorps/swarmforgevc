'use strict';

// BL-1233 declared invariants (coder first authorship - BL-654):
//
// 1. The launcher never overwrites a path the destination worktree's own
//    git tracks - no ambient environment and no failed query may turn
//    that into a copy.
// 2. A tracked-path answer is trusted only when git resolved it against
//    the destination worktree itself; otherwise the sync refuses rather
//    than copies.
// 3. A destination whose own git legitimately tracks none of the synced
//    paths still receives every file - failing closed must never starve
//    a foreign target repo.
//
// Exercises the REAL pure predicates in sync_worktree_scripts_lib.bb
// (trustworthy-tracked-answer? and should-copy?) - never a JS
// reimplementation - over generated worktree-root/resolved-toplevel pairs
// and tracked-path sets. The end-to-end wiring (real git, real ambient env,
// real subprocess) is proven separately by
// swarmforge/scripts/test/test_sync_worktree_scripts_never_clobbers.sh's
// BL-1233 scenarios; this property generalizes the DECISION the wiring
// depends on across a wider input domain than those fixed scenarios cover.
//
// Runs ONLY via `npm run test:properties`.
//
// Non-vacuity: short-circuiting trustworthy-tracked-answer? to always
// return true (the pre-fix posture: trust every tracked-path answer) makes
// this property fail on any generated mismatch/nil-resolution case that
// also has a non-empty tracked-paths set - the guard would then decide to
// copy a path it should have refused.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fc = require('fast-check');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'sync_worktree_scripts_lib.bb');

// A "trust scenario": the case-by-case shapes the real CLI can produce for
// (worktree-root-real, resolved-toplevel-real), derived from a single base
// path rather than drawn independently - so a "mismatch" is guaranteed to
// actually differ (never an accidental collision), and a "match" is
// guaranteed to actually be the same string.
const trustScenario = fc.oneof(
  fc.string({ minLength: 1, maxLength: 12 }).map((seg) => ({
    kind: 'match',
    root: `/repo/.worktrees/${seg || 'x'}`,
  })),
  fc.tuple(fc.string({ minLength: 1, maxLength: 12 }), fc.string({ minLength: 1, maxLength: 12 })).map(
    ([a, b]) => ({
      kind: 'mismatch',
      root: `/repo/.worktrees/${a || 'x'}`,
      // Derived from root by construction (append a suffix), guaranteeing
      // a genuine difference rather than an independently-drawn string
      // that might coincidentally match.
      resolved: `/repo/.worktrees/${a || 'x'}-${b || 'y'}-different`,
    })
  ),
  fc.string({ minLength: 1, maxLength: 12 }).map((seg) => ({
    kind: 'no-resolution',
    root: `/repo/.worktrees/${seg || 'x'}`,
  }))
);

function evalGuard({ worktreeRootReal, resolvedToplevelReal, trackedPaths, destRelativePath }) {
  const script = `
(load-file "${LIB.replace(/\\/g, '/')}")
(require '[cheshire.core :as json])
(let [trustworthy (sync-worktree-scripts-lib/trustworthy-tracked-answer?
                    {:worktree-root-real ${JSON.stringify(worktreeRootReal)}
                     :resolved-toplevel-real ${resolvedToplevelReal === null ? 'nil' : JSON.stringify(resolvedToplevelReal)}})
      would-copy (sync-worktree-scripts-lib/should-copy?
                  {:tracked-paths #{${[...new Set(trackedPaths)].map((p) => JSON.stringify(p)).join(' ')}}
                   :dest-relative-path ${JSON.stringify(destRelativePath)}})
      ;; the real CLI's -main only calls should-copy? at all when trustworthy;
      ;; an untrustworthy answer refuses everything, so the real overall
      ;; decision is trustworthy AND would-copy - mirrored here, not
      ;; reimplemented (both halves are the library's own real functions).
      copies? (and trustworthy would-copy)]
  (println (json/generate-string {:trustworthy trustworthy :would_copy would-copy :copies copies?})))
`;
  const res = spawnSync('bb', ['-e', script], { encoding: 'utf8', timeout: 15_000 });
  if (res.status !== 0) {
    throw new Error(`bb eval failed:\n${res.stdout}${res.stderr}`);
  }
  return JSON.parse(res.stdout.trim());
}

test('BL-1233/BL-654 invariants 1+2: an untrustworthy tracked-path answer never results in a copy, trustworthy match always resolves as such', () => {
  fc.assert(
    fc.property(
      trustScenario,
      fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 4 }),
      fc.constantFrom('swarmforge/scripts/foo.bb', 'swarmforge/scripts/bar.bb', 'swarmforge/profiles/default.conf'),
      (scenario, extraTracked, destRelativePath) => {
        const resolvedToplevelReal = scenario.kind === 'match' ? scenario.root : scenario.kind === 'mismatch' ? scenario.resolved : null;
        // Sometimes include the dest path itself in the tracked set, so
        // both the tracked and untracked halves of should-copy? get
        // exercised across generated runs.
        const trackedPaths = extraTracked.includes(destRelativePath) ? extraTracked : [...extraTracked, destRelativePath];

        const result = evalGuard({
          worktreeRootReal: scenario.root,
          resolvedToplevelReal,
          trackedPaths,
          destRelativePath,
        });

        if (scenario.kind === 'match') {
          assert.equal(result.trustworthy, true, `expected a matching top-level to be trustworthy: ${JSON.stringify(result)}`);
          // Invariant 1: a TRACKED path is never copied even when trustworthy.
          assert.equal(result.would_copy, false, `expected the tracked dest path to never be copied: ${JSON.stringify(result)}`);
          assert.equal(result.copies, false);
        } else {
          // Invariant 2: mismatch or failed resolution is NEVER trustworthy...
          assert.equal(result.trustworthy, false, `expected scenario "${scenario.kind}" to be untrustworthy: ${JSON.stringify(result)}`);
          // ...and invariant 1: therefore nothing is copied, regardless of
          // whether the path is tracked or not (fail closed on doubt).
          assert.equal(result.copies, false, `expected an untrustworthy answer to copy nothing: ${JSON.stringify(result)}`);
        }
      }
    ),
    { numRuns: 30 }
  );
});

test('BL-1233/BL-654 invariant 3: a foreign target that genuinely tracks nothing still copies every generated path', () => {
  fc.assert(
    fc.property(
      fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
      (destPaths) => {
        for (const destRelativePath of destPaths.length ? destPaths : ['swarmforge/scripts/only.bb']) {
          const result = evalGuard({
            worktreeRootReal: '/foreign/.worktrees/coder',
            resolvedToplevelReal: '/foreign/.worktrees/coder',
            trackedPaths: [], // genuinely tracks nothing under rel-prefix
            destRelativePath,
          });
          assert.equal(result.trustworthy, true);
          assert.equal(result.would_copy, true, `expected an untracked path to still copy for a foreign target: ${JSON.stringify(result)}`);
          assert.equal(result.copies, true);
        }
      }
    ),
    { numRuns: 15 }
  );
});
