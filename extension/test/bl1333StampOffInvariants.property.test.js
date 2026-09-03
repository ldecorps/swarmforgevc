'use strict';

// BL-1333's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  The redundancy proof is read-only: it compares the
//                working-tree blob hash against origin/main's blob at that
//                path and writes nothing, so running the proof alone can
//                never change the repository.
//   invariant 2  A path the proof does not positively establish as redundant
//                is left exactly as found and still blocks the reconcile,
//                and the main-sync deadlock alert names only the
//                still-blocking paths.
//   invariant 3  This stamp-off never reimplements, rewrites or reverts the
//                hotfix - it confirms or refutes landed commits f57795b6d2
//                and d5739d84cc only.
//
// Invariants 1 and 2 are properties of the LANDED code and drive the real
// handoffd.bb against a real git fixture with a real bare origin. Invariant
// 3 quantifies over THIS PARCEL rather than over a pure function, so it is a
// property of the working tree and is checked against it directly - the
// alternative is not encoding it at all, and a declared invariant is never
// silently unencoded.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  REPO_ROOT,
  makeFixture,
  removeFixture,
  landOnOrigin,
  fetchOrigin,
  runReconcileTick,
  callLandedFns,
  status,
  write,
} = require('../../specs/pipeline/steps/lib/bl1333ReconcileStampFixture');

const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');

// The files the hotfix landed in. A stamp-off that edited any of them would
// be reimplementing what it is supposed to be reviewing.
const REVIEWED_SOURCES = [
  'swarmforge/scripts/handoffd.bb',
  'swarmforge/scripts/master_main_reconcile_lib.bb',
  'swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh',
  'swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb',
  'swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb',
];

const INCOMING = { 'dup.txt': 'landed by QA\n', 'shared.txt': 'incoming\n' };

// One fixture per property case: origin one commit ahead on both overlap
// paths, the working tree dirtied as the drawn case describes.
function withFixture(caseSpec, body) {
  const fx = makeFixture();
  try {
    landOnOrigin(fx, INCOMING);
    for (const [rel, content] of Object.entries(caseSpec.tree)) write(fx.root, rel, content);
    fetchOrigin(fx.root);
    return body(fx);
  } finally {
    removeFixture(fx);
  }
}

test('BL-1333/BL-654 invariant 1: running the redundancy proof alone never changes the repository', () => {
  // GENERATOR REACH (asserted AND guaranteed by construction, not hoped
  // for): the run fails unless it reached every shape whose handling the
  // proof distinguishes - a path whose content matches origin, one that
  // differs, one origin does not carry at all (the fail-closed corner), and
  // one that is not in the working tree either. A weighted draw over these
  // leaves the rare corners at a few percent per run, which is how a
  // property passes hundreds of times against a live defect.
  const reach = { matches: 0, differs: 0, notInOrigin: 0, absent: 0 };

  const SHAPES = {
    matches: fc.constant({
      tree: { 'dup.txt': INCOMING['dup.txt'] },
      ask: ['dup.txt'],
      expected: ['dup.txt'],
    }),
    differs: fc.string({ minLength: 1, maxLength: 12 })
      .filter((s) => `${s}\n` !== INCOMING['shared.txt'])
      .map((s) => ({
        tree: { 'shared.txt': `${s}\n`, 'dup.txt': INCOMING['dup.txt'] },
        ask: ['shared.txt', 'dup.txt'],
        expected: ['dup.txt'],
      })),
    // origin/main carries no blob at this path: unprovable, so unproven.
    notInOrigin: fc.constant({
      tree: { 'local-only.txt': 'never landed\n' },
      ask: ['local-only.txt'],
      expected: [],
    }),
    // and a path that is in neither tree - the proof must not create it.
    absent: fc.constant({ tree: {}, ask: ['nowhere.txt'], expected: [] }),
  };

  for (const [shape, arbitrary] of Object.entries(SHAPES)) {
    fc.assert(
      fc.property(arbitrary, (caseSpec) => {
        reach[shape] += 1;
        return withFixture(caseSpec, (fx) => {
          const before = status(fx.root);
          const treeBefore = Object.fromEntries(
            Object.keys(caseSpec.tree).map((rel) => [rel, fs.readFileSync(path.join(fx.root, rel), 'utf8')]),
          );
          const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fx.root, encoding: 'utf8' });

          const [proven] = callLandedFns(
            fx,
            `(emit (vec (sort (#'handoffd/master-main-reconcile-redundant-paths! ${JSON.stringify(caseSpec.ask)}))))`,
          );

          assert.deepEqual(proven, caseSpec.expected, `the proof's answer changed for ${JSON.stringify(caseSpec.ask)}`);
          assert.equal(status(fx.root), before, 'the proof changed the working tree');
          assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fx.root, encoding: 'utf8' }), headBefore);
          for (const [rel, content] of Object.entries(treeBefore)) {
            assert.equal(fs.readFileSync(path.join(fx.root, rel), 'utf8'), content, `the proof rewrote ${rel}`);
          }
          assert.ok(!fs.existsSync(path.join(fx.root, 'nowhere.txt')), 'the proof created a path it was asked about');
          return true;
        });
      }),
      { numRuns: 2 },
    );
  }

  assert.ok(reach.matches > 0, 'never exercised a path whose content matches origin');
  assert.ok(reach.differs > 0, 'never exercised a path whose content differs');
  assert.ok(reach.notInOrigin > 0, 'never exercised a path origin does not carry - the fail-closed corner');
  assert.ok(reach.absent > 0, 'never exercised a path absent from the working tree');
});

test('BL-1333/BL-654 invariant 2: an unproven path is left as found, still blocks, and is the only one named', () => {
  // The dangerous direction of this hotfix is the drop, so the cases are
  // built to make an over-broad drop VISIBLE: every one of them mixes a path
  // the proof can establish with one it cannot, or is entirely unprovable.
  // A collision-shaped draw (both sides drawn independently) would mostly
  // produce two divergent paths and never test the mix, so each case
  // derives the redundant side from origin's own content by construction.
  const reach = { mixed: 0, allUnproven: 0, unrelatedDirt: 0 };

  const SHAPES = {
    mixed: fc.string({ minLength: 1, maxLength: 10 })
      .filter((s) => `${s}\n` !== INCOMING['shared.txt'])
      .map((s) => ({
        tree: { 'dup.txt': INCOMING['dup.txt'], 'shared.txt': `${s}\n` },
        blocking: ['shared.txt'],
        proven: ['dup.txt'],
      })),
    allUnproven: fc.string({ minLength: 1, maxLength: 10 })
      .filter((s) => `${s}\n` !== INCOMING['dup.txt'] && `${s}\n` !== INCOMING['shared.txt'])
      .map((s) => ({
        tree: { 'dup.txt': `${s}\n`, 'shared.txt': `${s}x\n` },
        blocking: ['dup.txt', 'shared.txt'],
        proven: [],
      })),
    unrelatedDirt: fc.constant({
      tree: { 'shared.txt': 'a local edit\n', 'elsewhere.txt': 'dirt the merge never carries\n' },
      blocking: ['shared.txt'],
      proven: [],
    }),
  };

  for (const [shape, arbitrary] of Object.entries(SHAPES)) {
    fc.assert(
      fc.property(arbitrary, (caseSpec) => {
        reach[shape] += 1;
        return withFixture(caseSpec, (fx) => {
          const before = status(fx.root);
          const treeBefore = Object.fromEntries(
            Object.keys(caseSpec.tree).map((rel) => [rel, fs.readFileSync(path.join(fx.root, rel), 'utf8')]),
          );

          const tick = runReconcileTick(fx);
          assert.equal(tick.status, 0, `the reconcile tick failed: ${tick.out.slice(-500)}`);
          assert.match(tick.log, /master-main-reconcile dirty-blocked/, `the reconcile did not block: ${tick.log}`);
          assert.doesNotMatch(tick.log, /master-main-reconcile reconciled/, 'an unproven path did not block the merge');
          assert.equal(status(fx.root), before, 'the blocked reconcile changed the working tree');
          for (const [rel, content] of Object.entries(treeBefore)) {
            assert.equal(fs.readFileSync(path.join(fx.root, rel), 'utf8'), content, `the blocked reconcile rewrote ${rel}`);
          }

          // The coordinator note is capped at 80 characters and summarizes
          // more than one path by COUNT (landed surface-message), so what it
          // proves is the negative half: it never names a path the proof
          // established, nor dirt outside the overlap.
          const surfaced = tick.log.split('\n').filter((l) => l.includes('master-main-reconcile-surfaced')).join('\n');
          for (const dropped of caseSpec.proven) {
            assert.ok(!surfaced.includes(dropped), `the block message names the proven-redundant ${dropped}: ${surfaced}`);
          }
          assert.ok(!surfaced.includes('elsewhere.txt'), `the block message names dirt outside the overlap: ${surfaced}`);

          // The naming half is the operator alert, built from the same
          // blocking-overlap the landed adapters compute: overlap minus the
          // proven set, whatever the case drew.
          const [computed] = callLandedFns(
            fx,
            `(let [dirty (#'handoffd/master-main-reconcile-dirty-paths!)
                   mc (#'handoffd/master-main-reconcile-merge-changed-paths!)
                   overlap (master-main-reconcile-lib/overlapping-paths dirty mc)
                   proven (#'handoffd/master-main-reconcile-redundant-paths! overlap)
                   blocking (vec (sort (master-main-reconcile-lib/blocking-overlap dirty mc proven)))]
               (emit {:proven (vec (sort proven))
                      :blocking blocking
                      :alert (master-main-reconcile-lib/deadlock-alert-text
                              {:ahead 0 :behind 1 :reason "dirty" :overlapping-paths blocking})}))`,
          );
          assert.deepEqual(computed.proven, caseSpec.proven, 'the proof established a different set than the case describes');
          assert.deepEqual(computed.blocking, caseSpec.blocking, 'the blocking overlap is not the overlap minus the proven set');
          for (const blocked of caseSpec.blocking) {
            assert.ok(computed.alert.includes(blocked), `the alert omits the blocking ${blocked}: ${computed.alert}`);
          }
          for (const dropped of caseSpec.proven) {
            assert.ok(!computed.alert.includes(dropped), `the alert names the dropped ${dropped}: ${computed.alert}`);
          }
          assert.ok(!computed.alert.includes('elsewhere.txt'), `the alert names dirt outside the overlap: ${computed.alert}`);
          return true;
        });
      }),
      { numRuns: 2 },
    );
  }

  assert.ok(reach.mixed > 0, 'never exercised a proven path alongside an unproven one');
  assert.ok(reach.allUnproven > 0, 'never exercised an overlap the proof establishes nothing in');
  assert.ok(reach.unrelatedDirt > 0, 'never exercised dirt outside the overlap');
});

test('BL-1333/BL-654 invariant 3: the stamp-off parcel never edits the code it reviews', () => {
  // Measured, not asserted in prose: whatever THIS PARCEL changed, none of it
  // may be the hotfix's own sources. Scoped to the stamp-off's own commits,
  // never a branch-wide diff - a later, unrelated ticket on the same branch
  // legitimately edits handoffd.bb, and the invariant is about this parcel.
  const commits = execFileSync('git', ['log', '--format=%H', '--grep', 'BL-1333', 'origin/main..HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  // No BL-1333 commit in range means the parcel has landed and the question
  // is settled elsewhere - not that it edited something.
  if (commits.length === 0) return;

  const changed = commits
    .flatMap((sha) =>
      execFileSync('git', ['show', '--first-parent', '--name-only', '--format=', sha], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean),
    )
    .filter((v, i, a) => a.indexOf(v) === i);

  for (const reviewed of REVIEWED_SOURCES) {
    assert.ok(!changed.includes(reviewed), `the stamp-off parcel edits ${reviewed}, which it is meant only to review`);
  }

  // And the review is inert on the ledger: no green suite writes a decision
  // only a human may write (BL-848).
  const ledger = fs.readFileSync(LEDGER, 'utf8');
  for (const commit of ['f57795b6d2', 'd5739d84cc']) {
    const start = ledger.indexOf(`- commit: ${commit}`);
    assert.ok(start >= 0, `no ledger row for ${commit}`);
    const rest = ledger.slice(start + 1);
    const end = rest.indexOf('\n- commit:');
    const row = end === -1 ? rest : rest.slice(0, end);
    assert.doesNotMatch(row, /state:\s*(certified|waived)\b/, `a decided state appears on ${commit}:\n${row}`);
    assert.match(row, /human_decision: null/, `a decision was written without a human on ${commit}:\n${row}`);
  }
});
