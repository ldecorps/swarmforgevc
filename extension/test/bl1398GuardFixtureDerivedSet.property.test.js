'use strict';

// BL-1398 declared invariants (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`.
//
//   1. The fixture's guard set is a function of run_commit_guards.sh (and the
//      pre-merge-commit hook) read at test time - never a list in the test: a
//      guard added to or removed from the runner is reflected without editing
//      the test.
//   2. A guard the runner names but the tree lacks fails the test loud, naming
//      the guard - it is never silently skipped, and the fixture never runs a
//      guard chain narrower than production's.
//
// GENERATOR REACH, constructed rather than hoped for: every case draws a base
// set of guard names and then DERIVES its variant from that set - the added
// guard is a name not in the base, the removed one is drawn FROM the base, and
// invariant 2's absent guard is a member of the named list whose file is
// deliberately not planted. So every generated case is a real add, a real
// removal, or a real absence by construction, and both directions of
// invariant 1 are asserted to have been reached.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { deriveCommitGuardFixtureSet } = require('./helpers/commitGuardFixtureSet');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CHAIN_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'commit_guard_chain_lib.sh');

const GUARD_NAME = fc.stringMatching(/^[a-z]{3,6}$/).map((s) => `check_${s}.sh`);

// A seam tree: a runner naming `named`, guard files planted for `planted`, and
// the two hooks. Only ever written under a fixture root this test owns; the
// live runner is read, never written.
function makeSeam(root, named, planted) {
  const scripts = path.join(root, 'swarmforge', 'scripts');
  const hooks = path.join(root, 'swarmforge', 'git-hooks');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(hooks, { recursive: true });
  fs.copyFileSync(CHAIN_LIB, path.join(scripts, 'commit_guard_chain_lib.sh'));
  fs.writeFileSync(
    path.join(scripts, 'run_commit_guards.sh'),
    ['#!/usr/bin/env bash', 'SCRIPT_DIR="$(dirname "$0")"', 'GUARD_DIR="$SCRIPT_DIR"',
     '. "$SCRIPT_DIR/commit_guard_chain_lib.sh"', ...named.map((g) => `run_guard ${g}`), ''].join('\n'),
  );
  for (const g of planted) {
    fs.writeFileSync(path.join(scripts, g), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  }
  for (const h of ['pre-commit', 'pre-merge-commit']) {
    fs.writeFileSync(path.join(hooks, h), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  }
  return root;
}

function derivedGuards(root) {
  return deriveCommitGuardFixtureSet({ repoRoot: root }).guards;
}

function withRoot(fn) {
  const root = mkTmpDir('bl1398-prop-');
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('BL-1398 declared invariants', () => {
  it('inv1: the set follows the runner in both directions, with no test edited', () => {
    const reach = { added: 0, removed: 0 };
    fc.assert(
      fc.property(
        fc.uniqueArray(GUARD_NAME, { minLength: 2, maxLength: 5 }),
        GUARD_NAME,
        fc.boolean(),
        (base, extra, addNotRemove) => {
          // Constructed: the extra guard is one the base does not name, and
          // the removed guard is drawn FROM the base - never a coincidence.
          fc.pre(!base.includes(extra));
          const named = addNotRemove ? [...base, extra] : base.slice(0, base.length - 1);
          const dropped = addNotRemove ? null : base[base.length - 1];
          reach[addNotRemove ? 'added' : 'removed'] += 1;

          withRoot((root) => {
            makeSeam(root, named, [...base, extra]);
            const guards = derivedGuards(root);
            assert.deepEqual(guards, named, 'the derived set must be exactly what the runner names');
            if (addNotRemove) {
              assert.ok(guards.includes(extra), 'a guard added to the runner must appear');
            } else {
              // Still present ON THE TREE, no longer named: the set follows
              // the runner, not the directory listing.
              assert.ok(!guards.includes(dropped), 'a guard the runner no longer names must not appear');
              assert.ok(
                fs.existsSync(path.join(root, 'swarmforge', 'scripts', dropped)),
                'the removed guard must still be on the tree, or this case proves nothing',
              );
            }
          });
        },
      ),
      { numRuns: 25 },
    );
    assert.ok(reach.added > 0, `generator never reached an addition: ${JSON.stringify(reach)}`);
    assert.ok(reach.removed > 0, `generator never reached a removal: ${JSON.stringify(reach)}`);
  }, 120000);

  it('inv2: a guard the runner names but the tree lacks refuses, naming it', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(GUARD_NAME, { minLength: 2, maxLength: 5 }),
        fc.nat(),
        (named, pick) => {
          // The absent guard is a member of the named list by construction, so
          // every case is a genuine "runner names it, tree lacks it".
          const absent = named[pick % named.length];
          const planted = named.filter((g) => g !== absent);

          withRoot((root) => {
            makeSeam(root, named, planted);
            assert.throws(
              () => derivedGuards(root),
              (err) => err.message.includes(absent),
              `the derivation must refuse naming ${absent}`,
            );

            // Non-vacuity: with the guard planted, the same seam derives
            // cleanly and names it - so the refusal above is the absence, not
            // a seam that could never work.
            fs.writeFileSync(
              path.join(root, 'swarmforge', 'scripts', absent),
              '#!/usr/bin/env bash\nexit 0\n',
              { mode: 0o755 },
            );
            assert.deepEqual(derivedGuards(root), named);
          });
        },
      ),
      { numRuns: 25 },
    );
  }, 120000);
});
