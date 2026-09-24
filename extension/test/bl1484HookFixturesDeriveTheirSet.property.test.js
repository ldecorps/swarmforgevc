'use strict';

// BL-1484 declared invariants (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`.
//
//   1. Every hook-installing fixture's copy set is a function of the hooks it
//      installs and the runner they exec, read at run time through BL-1398's
//      helper - never a list in the test: a guard added to the pre-commit
//      chain or to commit-msg is copied and run without editing any test.
//   3. A guard a hook or the runner names but the tree lacks fails the
//      fixture loud, naming the guard - never silently skipped: no fixture
//      runs a chain narrower than production's.
//
// (Invariant 2 - "exactly one reader of each hook line shape" - is a
// stated-reason invariant, not a property test here: see
// backlog/evidence/BL-1484-coder-20260913.md.)
//
// BL-1398's own property test already proves both invariants for the
// `run_guard` chain-lib shape (pre-commit/pre-merge-commit). What is NEW
// here is the shape BL-1484 added to the helper: commit-msg's direct call
// (`"$REPO_ROOT/swarmforge/scripts/<script>" "$1"`), with no runner and no
// chain lib in its chain at all. Every case below is run against BOTH
// shapes, so a regression that breaks one shape while leaving the other
// green cannot pass unnoticed.
//
// GENERATOR REACH, constructed rather than hoped for: every case draws a
// base set of guard names and then DERIVES its variant from that set - the
// added guard is a name not in the base, the removed one is drawn FROM the
// base, and invariant 3's absent guard is a member of the named list whose
// file is deliberately not planted. So every generated case is a real add,
// a real removal, or a real absence by construction, and both shapes and
// both directions of invariant 1 are asserted to have been reached.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { deriveCommitGuardFixtureSet } = require('./helpers/commitGuardFixtureSet');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CHAIN_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'commit_guard_chain_lib.sh');

const GUARD_NAME = fc.stringMatching(/^[a-z]{3,6}$/).map((s) => `check_${s}.sh`);

// A seam tree in one of the two chain-source shapes the helper recognises.
// `directCall: true` builds a commit-msg-shaped hook (no runner, no chain
// lib); `directCall: false` builds the run_commit_guards.sh + chain-lib
// shape BL-1398's own test already covers, reused here so both shapes run
// through the exact same generator and assertions.
function makeSeam(root, named, planted, directCall) {
  const scripts = path.join(root, 'swarmforge', 'scripts');
  const hooks = path.join(root, 'swarmforge', 'git-hooks');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(hooks, { recursive: true });
  for (const g of planted) {
    fs.writeFileSync(path.join(scripts, g), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  }
  if (directCall) {
    fs.writeFileSync(
      path.join(hooks, 'commit-msg'),
      [
        '#!/usr/bin/env bash',
        'REPO_ROOT="$(pwd)"',
        'status=0',
        ...named.map((g) => `"$REPO_ROOT/swarmforge/scripts/${g}" "$1" || status=$?`),
        'exit "$status"',
        '',
      ].join('\n'),
    );
    return { repoRoot: root, runnerRel: null, hookRels: ['swarmforge/git-hooks/commit-msg'] };
  }
  fs.copyFileSync(CHAIN_LIB, path.join(scripts, 'commit_guard_chain_lib.sh'));
  fs.writeFileSync(
    path.join(scripts, 'run_commit_guards.sh'),
    ['#!/usr/bin/env bash', 'SCRIPT_DIR="$(dirname "$0")"', 'GUARD_DIR="$SCRIPT_DIR"',
     '. "$SCRIPT_DIR/commit_guard_chain_lib.sh"', ...named.map((g) => `run_guard ${g}`), ''].join('\n'),
  );
  for (const h of ['pre-commit', 'pre-merge-commit']) {
    fs.writeFileSync(path.join(hooks, h), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  }
  return { repoRoot: root };
}

function derivedGuards(root, named, planted, directCall) {
  return deriveCommitGuardFixtureSet(makeSeam(root, named, planted, directCall)).guards;
}

function withRoot(fn) {
  const root = mkTmpDir('bl1484-prop-');
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('BL-1484 declared invariants', () => {
  it('inv1: the set follows either chain shape in both directions, with no test edited', () => {
    // BL-1691: the 2x2 product (added/removed x directCall/runGuard)
    // constructed as four cells, both axes fixed per cell.
    const DIRECTION_CELLS = { added: true, removed: false };
    const SHAPE_CELLS = { directCall: true, runGuard: false };
    const CELLS = Object.keys(DIRECTION_CELLS).flatMap((d) => Object.keys(SHAPE_CELLS).map((s) => `${d}-${s}`));
    const PER_CELL_RUNS = runsPerCell(30, CELLS.length);
    const reach = { added: 0, removed: 0, directCall: 0, runGuard: 0 };
    for (const direction of Object.keys(DIRECTION_CELLS)) {
      for (const shape of Object.keys(SHAPE_CELLS)) {
        const addNotRemoveConst = DIRECTION_CELLS[direction];
        const directCallConst = SHAPE_CELLS[shape];
        fc.assert(
          fc.property(
            fc.uniqueArray(GUARD_NAME, { minLength: 2, maxLength: 5 }),
            GUARD_NAME,
            fc.constant(addNotRemoveConst),
            fc.constant(directCallConst),
            (base, extra, addNotRemove, directCall) => {
              fc.pre(!base.includes(extra));
              const named = addNotRemove ? [...base, extra] : base.slice(0, base.length - 1);
              const dropped = addNotRemove ? null : base[base.length - 1];
              reach[addNotRemove ? 'added' : 'removed'] += 1;
              reach[directCall ? 'directCall' : 'runGuard'] += 1;

              withRoot((root) => {
                const guards = derivedGuards(root, named, [...base, extra], directCall);
                assert.deepEqual(guards, named, `the derived set must be exactly what the chain names (directCall=${directCall})`);
                if (addNotRemove) {
                  assert.ok(guards.includes(extra), 'a guard added to the chain must appear');
                } else {
                  assert.ok(!guards.includes(dropped), 'a guard the chain no longer names must not appear');
                }
              });
            },
          ),
          { numRuns: PER_CELL_RUNS },
        );
      }
    }
    assertReachFloor(reach, ['added', 'removed', 'directCall', 'runGuard'], PER_CELL_RUNS, 'inv1-shape');
  }, 120000);

  it('inv3: a guard the chain names but the tree lacks refuses, naming it - for either shape', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(GUARD_NAME, { minLength: 2, maxLength: 5 }),
        fc.nat(),
        fc.boolean(),
        (named, pick, directCall) => {
          const absent = named[pick % named.length];
          const planted = named.filter((g) => g !== absent);

          withRoot((root) => {
            assert.throws(
              () => derivedGuards(root, named, planted, directCall),
              (err) => err.message.includes(absent),
              `the derivation must refuse naming ${absent} (directCall=${directCall})`,
            );

            // Non-vacuity: planting it derives cleanly and names it, so the
            // refusal above is the absence, not a seam that could never work.
            assert.deepEqual(derivedGuards(root, named, named, directCall), named);
          });
        },
      ),
      { numRuns: 30 },
    );
  }, 120000);
});
