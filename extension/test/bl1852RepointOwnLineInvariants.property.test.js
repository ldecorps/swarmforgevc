'use strict';

// BL-1852's two declared invariants (property authorship rests with the
// coder, first pass - BL-654):
//
//   1. "A re-point never re-applies a commit that reached QA's tip only
//      through a merge."
//   2. "A re-point never drops a commit QA made on its own line that is
//      not yet on origin/main, including one an earlier re-point carried
//      forward."
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Drives the REAL swarmforge/scripts/land_step_lib.bb (post-land-repoint!)
// against real git fixtures - never a JavaScript restatement of the
// own-line walk or the classification.
//
// GENERATOR REACH (by CONSTRUCTION, never by draw). One cell,
// 'two-round-repoint': the counts of QA's own commits in round 1, the
// merged-in bookkeeping commits a parcel brings in round 1, and QA's own
// commits in round 2 (run AFTER round 1's re-point already wrote a REAL
// `land-repoint.log` record - not a hand-authored fixture record, so this
// exercises the self-consistent repeated-call path: the record THIS
// ticket's own code writes, consumed by itself again). Round 2 proves
// invariant 2's "including one an earlier re-point carried forward" half
// directly - round 1's own commits must still be present after round 2's
// own delta-since-previous-new-tip walk, across the exact boundary that
// walk is bounded by. Every count varies 1-4 so a fix that only happens
// to work for a single fixed shape (e.g. exactly one merged commit)
// cannot hide.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const FIXTURE_PREFIX = 'bl1852-property-';

function git(root, ...args) {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
}

function gitOut(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function head(root) {
  return gitOut(root, 'rev-parse', 'HEAD');
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message);
  return head(root);
}

function initRepo(root) {
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  const excludeFile = path.join(root, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  fs.appendFileSync(excludeFile, '\n.swarmforge/\n');
}

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

function postLandRepoint(root) {
  const out = bb(
    `(require '[cheshire.core :as json])\n(load-file "${LIB}")\n(println (json/generate-string (land-step-lib/post-land-repoint! {:root "${root}"})))`
  );
  return JSON.parse(out.trim().split('\n').pop());
}

function ownCommits(root, prefix, count, start) {
  const shas = [];
  for (let i = 0; i < count; i += 1) {
    shas.push(
      commitFile(root, `backlog/evidence/BL-9701-${prefix}-${start + i}.md`, `own ${start + i}\n`, `BL-9701: own ${prefix} ${start + i}`)
    );
  }
  return shas;
}

function mergeEvidenceBranch(root, count) {
  const branch = `fixture-parcel-${Math.random().toString(36).slice(2)}`;
  git(root, 'checkout', '-q', '-b', branch);
  const shas = [];
  for (let i = 1; i <= count; i += 1) {
    shas.push(commitFile(root, `backlog/evidence/BL-9702-ev-${i}-${branch}.md`, `evidence ${i}\n`, `BL-9702: evidence ${i}`));
  }
  git(root, 'checkout', '-q', 'main');
  git(root, 'merge', '--no-ff', '-q', '-m', `Merge ${branch} into main.`, branch);
  git(root, 'branch', '-D', branch);
  return shas;
}

const CELLS = ['two-round-repoint'];

test('BL-1852/BL-654 invariants: a re-point never carries a merged-in commit forward, and never drops QA\'s own commits across two consecutive re-points', () => {
  const reach = { 'two-round-repoint': 0 };
  const CELL_RUNS = runsPerCell(4 * CELLS.length, CELLS.length);

  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 1, max: 4 }),
      (round1Own, merged, round2Own) => {
        reach['two-round-repoint'] += 1;
        const root = mkTmpDir(FIXTURE_PREFIX);
        try {
          initRepo(root);
          commitFile(root, 'seed.txt', 'seed\n', 'seed');
          git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

          const round1OwnShas = ownCommits(root, 'r1', round1Own, 1);
          const mergedShas = mergeEvidenceBranch(root, merged);

          const result1 = postLandRepoint(root);
          assert.equal(result1.action, 'repointed', `round 1: expected :repointed, got: ${JSON.stringify(result1)}`);
          const keptSubjects1 = (result1.kept || []).map((k) => k.subject);
          for (const sha of mergedShas) void sha; // merged commits are identified by subject below
          assert.ok(
            keptSubjects1.every((s) => !s.startsWith('BL-9702:')),
            `round 1: a merged-in commit was kept: ${JSON.stringify(keptSubjects1)}`
          );
          assert.equal(
            keptSubjects1.filter((s) => s.startsWith('BL-9701:')).length,
            round1Own,
            `round 1: expected exactly ${round1Own} own commits kept, got: ${JSON.stringify(keptSubjects1)}`
          );

          // Round 2: QA makes more of its own commits on top of round 1's
          // re-point, then re-points again - round 1's own commits must
          // still be carried (invariant 2's "carried forward" half),
          // and still none of the merged ones (invariant 1, still).
          ownCommits(root, 'r2', round2Own, 1);
          const result2 = postLandRepoint(root);
          assert.equal(result2.action, 'repointed', `round 2: expected :repointed, got: ${JSON.stringify(result2)}`);
          const keptSubjects2 = (result2.kept || []).map((k) => k.subject);
          assert.ok(
            keptSubjects2.every((s) => !s.startsWith('BL-9702:')),
            `round 2: a merged-in commit was kept: ${JSON.stringify(keptSubjects2)}`
          );
          assert.equal(
            keptSubjects2.filter((s) => s.startsWith('BL-9701:')).length,
            round1Own + round2Own,
            `round 2: expected all ${round1Own + round2Own} own commits (both rounds) kept, got: ${JSON.stringify(keptSubjects2)}`
          );

          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: CELL_RUNS }
  );

  assertReachFloor(reach, CELLS, CELL_RUNS, 'BL-1852 own-line-candidates cell');
}, propertyLaneTimeoutMs(60000));
