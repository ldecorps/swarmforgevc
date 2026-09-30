'use strict';

// BL-1823 declared invariant (coder first authorship - BL-654):
//
// "The hook-mode guard lets a merge through without judging the
// art-director lane only when roles.tsv has no art-director row and no
// swarmforge-art-director branch exists; in every other state it resolves
// a ref and judges it, or refuses naming why."
//
// Drives the REAL check_art_director_tip.sh through a REAL
// pre-merge-commit hook chain (core.hooksPath), never a reimplementation
// of its decision logic. Sweeps whether the swarmforge-art-director
// convention branch exists, and (when it does) whether the merged tip is
// in-lane or carries an out-of-lane path, with no roles.tsv row in either
// case (the roster-row dimension is BL-1657's own invariants, not this
// one's).
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeAndAdd(root, relPath) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${relPath}\n`);
  git(root, 'add', relPath);
}

// A minimal fixture: no roles.tsv, real pre-merge-commit hooksPath, the
// one guard under test wired directly (never the full guard chain -
// this property is about check_art_director_tip.sh's own decision, not
// the other guards on the chain).
function mkFixtureRepo() {
  const root = mkTmpDir('sfvc-bl1823-prop-');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');

  const hooksDir = path.join(root, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const guardSrc = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_art_director_tip.sh');
  const guardDst = path.join(root, 'check_art_director_tip.sh');
  fs.copyFileSync(guardSrc, guardDst);
  fs.chmodSync(guardDst, 0o755);
  // The guard sources this beside itself (SCRIPT_DIR) for hook-mode's
  // MERGE_HEAD resolution.
  fs.copyFileSync(
    path.join(REPO_ROOT, 'swarmforge', 'scripts', 'incoming_merge_parent_lib.sh'),
    path.join(root, 'incoming_merge_parent_lib.sh')
  );
  fs.writeFileSync(
    path.join(hooksDir, 'pre-merge-commit'),
    '#!/usr/bin/env bash\nset -e\nexec bash "$(git rev-parse --show-toplevel)/check_art_director_tip.sh"\n'
  );
  fs.chmodSync(path.join(hooksDir, 'pre-merge-commit'), 0o755);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed hook');
  git(root, 'config', 'core.hooksPath', 'hooks');
  git(root, 'checkout', '-q', '-b', 'landing', 'main');
  return root;
}

function mergeWithNoFf(root, ref) {
  const result = spawnSync('git', ['merge', '--no-ff', '-q', '-m', 'merge', ref], { cwd: root, encoding: 'utf8' });
  const rc = result.status ?? 1;
  if (rc !== 0) {
    spawnSync('git', ['merge', '--abort'], { cwd: root });
  }
  return { rc, out: (result.stdout || '') + (result.stderr || '') };
}

const SHAPES = ['no-branch', 'branch-in-lane', 'branch-out-of-lane'];
const TOTAL_RUNS = 6;
const PER_CELL = runsPerCell(TOTAL_RUNS, SHAPES.length);

function exerciseShape(shape) {
  const root = mkFixtureRepo();

  if (shape !== 'no-branch') {
    git(root, 'branch', 'swarmforge-art-director', 'main');
    git(root, 'checkout', '-q', 'swarmforge-art-director');
    if (shape === 'branch-in-lane') {
      writeAndAdd(root, 'docs/design/system.md');
    } else {
      writeAndAdd(root, 'extension/src/out_of_lane.ts');
    }
    git(root, 'commit', '-q', '-m', `tip for ${shape}`);
    git(root, 'checkout', '-q', 'landing');
  } else {
    git(root, 'checkout', '-q', '-b', 'feature', 'main');
    writeAndAdd(root, 'extension/src/ordinary.ts');
    git(root, 'commit', '-q', '-m', 'ordinary change');
    git(root, 'checkout', '-q', 'landing');
  }

  const ref = shape === 'no-branch' ? 'feature' : 'swarmforge-art-director';
  const { rc, out } = mergeWithNoFf(root, ref);

  if (shape === 'no-branch') {
    assert.equal(rc, 0, `expected pass-through with no roster row and no convention branch, got rc=${rc}: ${out}`);
  } else if (shape === 'branch-in-lane') {
    assert.equal(rc, 0, `expected an in-lane tip on an existing branch to pass, got rc=${rc}: ${out}`);
  } else {
    assert.notEqual(rc, 0, `expected an out-of-lane tip on an existing branch to refuse, got rc=${rc}: ${out}`);
    assert.match(out, /extension\/src\/out_of_lane\.ts/, `expected the refusal to name the path, got: ${out}`);
  }
}

test(
  'BL-1823/BL-654 invariant: hook mode passes through only with no roster row and no convention branch; otherwise it judges the lane',
  () => {
    // BL-1584/BL-1062: coverage of all three shapes is reached BY
    // CONSTRUCTION - one fc.assert per shape, each run PER_CELL times -
    // never hoped for from a single random fc.constantFrom draw.
    const coverage = {};
    for (const shape of SHAPES) {
      fc.assert(
        fc.property(fc.constant(shape), (s) => {
          coverage[s] = (coverage[s] || 0) + 1;
          exerciseShape(s);
        }),
        { numRuns: PER_CELL }
      );
    }
    assertReachFloor(coverage, SHAPES, PER_CELL, 'shape');
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
