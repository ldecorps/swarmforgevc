'use strict';

// BL-1323's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  This stamp-off never reimplements, rewrites or reverts the
//                hotfix - review confirms or refutes landed commit
//                9c94735f03 only.
//   invariant 2  Green tests alone never write certified or waived into the
//                hotfix ledger; only a recorded human decision does (BL-848).
//   invariant 3  The reviewed code's overlapping-paths gather never silently
//                swallows a git shell-out failure into an empty, unlabeled
//                hint - the specific defect this hotfix fixes must not
//                regress.
//
// Invariants 1 and 2 quantify over THIS PARCEL rather than over a pure
// function, so they are properties of the working tree and are checked
// against it directly - the alternative is not encoding them at all, and a
// declared invariant is never silently unencoded. Invariant 3 is a property
// of the landed code and drives the REAL master_main_reconcile_lib.bb.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const RECONCILE_LIB = path.join(SCRIPTS, 'master_main_reconcile_lib.bb');
const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');
const HOTFIX = '9c94735f03';

// The files the hotfix landed in. A stamp-off that edited any of them would
// be reimplementing what it is supposed to be reviewing.
const REVIEWED_SOURCES = [
  'swarmforge/scripts/babysitter_check.bb',
  'swarmforge/scripts/handoffd.bb',
  'swarmforge/scripts/master_main_reconcile_lib.bb',
  'swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb',
  'swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb',
];

function reconcileLib(expression) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${RECONCILE_LIB}")
(println (json/generate-string ${expression}))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('BL-1323/BL-654 invariant 1: the stamp-off parcel never edits the code it reviews', () => {
  // Measured against origin/main rather than asserted in prose: whatever this
  // parcel changed, none of it may be the hotfix's own sources.
  const changed = execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  for (const reviewed of REVIEWED_SOURCES) {
    assert.ok(
      !changed.includes(reviewed),
      `the stamp-off parcel edits ${reviewed}, which it is meant only to review`,
    );
  }
});

test('BL-1323/BL-654 invariant 2: no green suite writes a decision into the hotfix ledger', () => {
  const before = fs.readFileSync(LEDGER, 'utf8');
  const row = before.slice(before.indexOf(`- commit: ${HOTFIX}`));
  const rowEnd = row.indexOf('\n- commit:');
  const thisRow = rowEnd === -1 ? row : row.slice(0, rowEnd);

  assert.ok(/state: stamp-open/.test(thisRow), `the row is no longer stamp-open:\n${thisRow}`);
  assert.ok(/human_decision: null/.test(thisRow), `a decision was written without a human:\n${thisRow}`);
  assert.ok(
    !/certified|waived/.test(thisRow),
    `certified/waived appears on a row no human has decided:\n${thisRow}`,
  );

  // And the suite itself is inert on the ledger: running the reviewing
  // acceptance feature leaves the file byte-identical.
  const run = spawnSync('bash', [path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh'),
    'specs/features/BL-1323-main-sync-deadlock-hints-name-overlaps-and-teach-swarm-heal.feature'],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300000 });
  const runOut = `${run.stdout || ''}${run.stderr || ''}`;
  // Proof the suite actually RAN: an inert ledger is only evidence if
  // something happened that could have written to it.
  assert.equal(run.status, 0, `the reviewing feature did not run cleanly: ${runOut.slice(-800)}`);
  assert.match(runOut, /# pass \d+/, `no scenario results came back: ${runOut.slice(-800)}`);
  assert.doesNotMatch(runOut, /# fail [1-9]/, `the reviewing feature is red: ${runOut.slice(-800)}`);
  assert.equal(fs.readFileSync(LEDGER, 'utf8'), before, 'running the review suite changed the hotfix ledger');
});

test('BL-1323/BL-654 invariant 3: the hint never comes back empty and unlabeled, whatever the overlap', () => {
  // The defect the hotfix fixed was a swallowed shell-out that produced a
  // hint naming nothing at all. So: for ANY overlap the gather can hand the
  // formatter - none, some, more than the display cap, and the
  // unknown-dirty sentinel that stands for "the git read failed" - the
  // operator hint must still say something actionable, and must always
  // teach the recovery command.
  //
  // GENERATOR REACH (asserted AND guaranteed, not hoped for): the run fails
  // unless it reached the empty case, the over-cap case, and the failed-read
  // sentinel - the three the pre-hotfix code could not tell apart, since all
  // three came out as the same empty hint. Each is reached by construction
  // below rather than by a weighted draw.
  const reach = { empty: 0, overCap: 0, sentinel: 0, ordinary: 0 };

  // The SHAPE is drawn by the loop, not by the generator: each of the four
  // corners gets its own dedicated property pass, so "did we reach the
  // failed-read sentinel" is settled by construction. An fc.oneof over
  // weighted shapes left the two low-weight corners at ~1/6 per draw, so a
  // 20-run pass missed one about 5% of the time and the floor assertion red
  // the suite for no reason (architect bounce D1, 2026-09-02) - the same
  // defect shape fixed in BL-1343 earlier the same day. A floor that bites
  // spuriously is the mirror image of a vacuous one, and on the machinery
  // that carries the operator's only deadlock signal, a spurious red is how
  // "just re-run it" becomes the habit this review exists to prevent.
  const SHAPES = {
    empty: fc.constant([]),
    sentinel: fc.constant(['?']),
    ordinary: fc.array(fc.constantFrom('a.txt', 'b/c.bb', 'd/e/f.md'), { minLength: 1, maxLength: 5 }),
    overCap: fc.integer({ min: 9, max: 20 }).map((n) =>
      Array.from({ length: n }, (_, i) => `over/cap-${String(i).padStart(2, '0')}.txt`)),
  };

  for (const [shape, arbitrary] of Object.entries(SHAPES)) {
    fc.assert(
      fc.property(arbitrary, fc.constantFrom('dirty', 'diverged'), (paths, reason) => {
        reach[shape] += 1;

        const hint = String(
          reconcileLib(
            `(master-main-reconcile-lib/operator-deadlock-hint {:ahead 1 :behind 1 :reason "${reason}" :overlapping-paths ${JSON.stringify(paths)}})`,
          ),
        );

        assert.ok(hint.trim().length > 0, 'the hint is empty');
        assert.ok(hint.includes('./swarm heal'), `the hint does not teach the recovery command: ${hint}`);
        if (paths.length === 0) {
          // Nothing to name is still not nothing to say.
          assert.match(hint, /git status/i);
        }
        return true;
      }),
      { numRuns: 5 },
    );
  }

  assert.ok(reach.empty > 0, 'never exercised an empty overlap - the pre-hotfix failure shape went untested');
  assert.ok(reach.overCap > 0, 'never exercised an over-cap overlap');
  assert.ok(reach.sentinel > 0, 'never exercised the failed-read sentinel');
  assert.ok(reach.ordinary > 0, 'never exercised an ordinary overlap');
});
