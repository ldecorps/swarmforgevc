'use strict';

// BL-1200 declared invariant: "A test fixture's git writes land in the
// repository the fixture created, never in a repository named only by an
// inherited environment variable."
//
// Runs ONLY via `npm run test:properties`.
//
// This tree has no property-test framework wired for shell-fixture side
// effects the way it does for pure JS functions (fast-check) - the same gap
// test_tmp_cleanup_lib.sh's own BL-654 note records for plain bash. Rather
// than skip the invariant on that ground, this drives the REAL
// expedite_fixture.sh (no reimplementation of its git handling) across a
// deliberately varied MATRIX - decoy branch name, decoy history depth,
// fixture destination nesting, and --active/--paused/--hold ticket shape -
// so the generator provably reaches more than the one hand-picked case
// scenario 04 of test_git_env_guard_lib.sh already covers. Each cell is its
// own `test()` so a failing cell is individually reported, not averaged away.
//
// Non-vacuity: temporarily removing expedite_fixture.sh's
// `source ".../git_env_guard.sh"` line (verified by hand while authoring
// this file) makes every cell below fail - the decoy's HEAD/branch changes
// and the fixture's own commit lands in the decoy's history instead.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const FIXTURE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'expedite_fixture.sh');

function cleanGitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function git(cwd, args, env) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: env || cleanGitEnv() }).trim();
}

function buildDecoyRepo(branchName, historyDepth) {
  const root = fs.realpathSync(mkTmpDir('bl1200-prop-decoy-'));
  git(root, ['init', '-q', '-b', branchName, '.']);
  git(root, ['config', 'user.email', 'decoy@example.com']);
  git(root, ['config', 'user.name', 'decoy']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  for (let i = 0; i < historyDepth; i += 1) {
    fs.writeFileSync(path.join(root, `seed-${i}.txt`), `seed ${i}\n`);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', `decoy: seed ${i}`]);
  }
  return root;
}

function decoySnapshot(root) {
  return {
    head: git(root, ['rev-parse', 'HEAD']),
    branch: git(root, ['symbolic-ref', '--short', 'HEAD']),
    logCount: git(root, ['log', '--oneline']).split('\n').filter(Boolean).length,
  };
}

// The generator axis: branch name, decoy history depth, DEST nesting depth,
// and the ticket-shape argv expedite_fixture.sh itself branches on
// (ACTIVE/PAUSED/HOLD loops). Reaches: an empty argv (the loops are no-ops),
// a single ticket in one bucket, and multiple tickets spread across all
// three buckets in one call - the states expedite_fixture.sh's own argv
// parsing loop actually varies over.
const MATRIX = [
  { branchName: 'main', historyDepth: 1, destDepth: 1, active: [], paused: [], hold: [] },
  { branchName: 'trunk', historyDepth: 3, destDepth: 1, active: ['BL-9001'], paused: [], hold: [] },
  {
    branchName: 'main',
    historyDepth: 1,
    destDepth: 3,
    active: ['BL-9002', 'BL-9003'],
    paused: ['BL-9004'],
    hold: ['BL-9005'],
  },
  { branchName: 'release-42', historyDepth: 2, destDepth: 2, active: [], paused: ['BL-9006'], hold: [] },
];

for (const [index, cell] of MATRIX.entries()) {
  test(`BL-1200 property [${index}]: expedite_fixture.sh writes stay out of a decoy named only by GIT_DIR/GIT_WORK_TREE (branch=${cell.branchName} historyDepth=${cell.historyDepth} destDepth=${cell.destDepth})`, () => {
    const decoyRoot = buildDecoyRepo(cell.branchName, cell.historyDepth);
    const fixtureParent = fs.realpathSync(mkTmpDir('bl1200-prop-fixture-'));
    let dest = fixtureParent;
    for (let i = 0; i < cell.destDepth; i += 1) {
      dest = path.join(dest, `nest-${i}`);
    }

    const before = decoySnapshot(decoyRoot);

    const env = cleanGitEnv();
    env.GIT_DIR = path.join(decoyRoot, '.git');
    env.GIT_WORK_TREE = decoyRoot;

    const argv = [FIXTURE, dest];
    for (const t of cell.active) argv.push('--active', t);
    for (const t of cell.paused) argv.push('--paused', t);
    for (const t of cell.hold) argv.push('--hold', t);

    try {
      const result = spawnSync('bash', argv, { encoding: 'utf8', env });
      assert.equal(
        result.status,
        0,
        `expedite_fixture.sh exited ${result.status}: ${result.stdout}${result.stderr}`
      );

      // The invariant's positive half: the fixture's own commit is in its
      // OWN repo.
      const fixtureLog = git(dest, ['log', '--oneline']);
      assert.match(fixtureLog, /fixture: initial/, `expected the fixture's own commit, got: ${fixtureLog}`);

      // The invariant's negative half: the decoy - named only by the
      // inherited GIT_DIR/GIT_WORK_TREE - gained nothing at all.
      const after = decoySnapshot(decoyRoot);
      assert.deepEqual(
        after,
        before,
        `decoy repository changed: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
      );
    } finally {
      fs.rmSync(decoyRoot, { recursive: true, force: true });
      fs.rmSync(fixtureParent, { recursive: true, force: true });
    }
  });
}
