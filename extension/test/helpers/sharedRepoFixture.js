'use strict';

// BL-1039: seed ONE git repository per run and hand each caller an independent
// working copy, instead of every scenario paying init/config/commit itself.
//
// Seventeen unit-lane files shelled out to real `git init` and then built real
// commits, most once per scenario - measured ~165.9s of a 533.8s lane, the
// single largest fixed block. The shape is uniform: `git init -q`, two `git
// config`, one `--allow-empty` commit. Four process spawns before the
// behaviour under test is even reached, repeated across every test in the
// file (36 of them in epicReorderBridge alone).
//
// THE SHARING IS THE WHOLE SAVING AND ALSO THE WHOLE RISK. A fixture that
// leaked one test's commits into another's view would have traded a slow suite
// for a lying one, so isolation here is STRUCTURAL rather than disciplined:
// each caller receives its own directory, copied from the template. Two tests
// cannot see each other's commits because they are not looking at the same
// repository - there is no cleanup step to forget and no ordering to get
// right.
//
// The copy is a plain recursive filesystem copy, not `git clone`: cloning
// would put a git spawn back into every caller, which is the cost being
// removed. A .git directory copies faithfully - it is just files.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { mkTmpDir, mkProcessTmpDir } = require('./tmpDir');
const { execFileSync } = require('child_process');

let templateDir = null;
let seedings = 0;

function gitIn(dir, args) {
  execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * The template, seeded at most once per process. Callers never touch it - they
 * only ever receive copies - so it can be reused for the whole run.
 */
function seedTemplateOnce() {
  if (templateDir && fs.existsSync(templateDir)) return templateDir;
  // mkProcessTmpDir, not mkTmpDir: BL-420's helper sweeps per TEST and its
  // shared sibling per FILE, and the template must outlive both or the saving
  // evaporates - it is seeded once and reused across files. Allocated through
  // the shared helper all the same, so this file carries no raw mkdtemp.
  const dir = mkProcessTmpDir('bl1039-seed-template-');
  // `-b main` deliberately, not bare `init`: the template's branch name is part
  // of the contract callers see. Without it the branch is whatever the host's
  // `init.defaultBranch` happens to be, so a caller doing `git checkout main`
  // passes or fails by machine configuration rather than by its own subject -
  // and several callers do exactly that (bounceRevertCheck's `initRepo` seeded
  // `init -q -b main` for this reason before it was converted).
  gitIn(dir, ['init', '-q', '-b', 'main']);
  gitIn(dir, ['config', 'user.email', 't@t']);
  gitIn(dir, ['config', 'user.name', 't']);
  gitIn(dir, ['commit', '-q', '-m', 'init', '--allow-empty']);
  templateDir = dir;
  seedings += 1;
  return templateDir;
}

/**
 * An independent working copy of the seeded repository: a real git repo with
 * identity configured and one initial commit, ready for a caller to add its
 * own content. Costs one filesystem copy and NO git spawn.
 *
 * `register` is injected so a caller can hand the directory to whatever
 * cleanup it already uses (mkTmpDir's sweep, a reaper, its own rmSync) -
 * this helper deliberately owns no cleanup policy of its own.
 */
function checkoutSeededRepo(prefix = 'bl1039-repo-', register = null) {
  const template = seedTemplateOnce();
  const dest = mkTmpDir(prefix);
  fs.cpSync(template, dest, { recursive: true });
  if (typeof register === 'function') register(dest);
  return dest;
}

/**
 * Seed an EXISTING directory from the shared template, in place.
 *
 * Most callers already own a root (from mkTmpDir, with its cleanup already
 * registered) and only want the repository put into it. Copying the template's
 * contents there gives them a real repo with identity configured and one
 * commit, for one filesystem copy and no git spawn - and keeps their existing
 * cleanup exactly as it was.
 *
 * Isolation is the same structural guarantee as checkoutSeededRepo: the
 * caller's directory is its own, so no two callers share a repository.
 */
function copySeededRepoInto(dir) {
  const template = seedTemplateOnce();
  fs.cpSync(template, dir, { recursive: true });
  return dir;
}

/** How many times the template was seeded this process - scenario 05's fact. */
function seedCount() {
  return seedings;
}

/** Test-only: forget the template so a test can observe a fresh seeding. */
function resetForTest() {
  templateDir = null;
  seedings = 0;
}

module.exports = { checkoutSeededRepo, copySeededRepoInto, seedTemplateOnce, seedCount, resetForTest };
