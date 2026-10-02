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

// BL-1867: the template's directory name carries ITS OWN creating process's
// pid (`<PREFIX><pid>-<random>`), the one naming shape
// tmpDir.js's sweepStaleTmpDirs (BL-971/BL-1385/BL-1390's owner-aware
// sweep) can target - never a bare mkdtemp random suffix, which carries no
// owner to check liveness against. A vitest fork worker that seeds this
// template is torn down without ever firing mkProcessTmpDir's own
// `process.once('exit')` handler (tinypool recycles/kills forks rather than
// letting them exit normally), so the directory this name scheme produces
// is swept instead by bl1039TemplateGlobalTeardown.js's own call to
// sweepStaleTmpDirs, once per vitest invocation, from the main process -
// the one process that reliably survives to the end of a run.
const TEMPLATE_PREFIX = 'bl1039-seed-template-';

let templateDir = null;
let seedings = 0;

function gitIn(dir, args) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'], env });
}

/**
 * The template, seeded at most once per process. Callers never touch it - they
 * only ever receive copies - so it can be reused for the whole run.
 */
function readCoreWorktree(dir) {
  try {
    return { value: execFileSync('git', ['config', 'core.worktree'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim() };
  } catch (err) {
    // `git config` exits 1 with empty stdout when the key is simply unset -
    // the common, healthy case, which execFileSync reports by THROWING
    // (non-zero exit), not by returning empty. Only THAT exact shape (exit
    // 1, nothing on stdout) means "no key"; any other failure (a different
    // exit status, or something on stdout despite the throw) is a genuine
    // read failure, left unhealthy.
    const stdout = (err && err.stdout && err.stdout.toString()) || '';
    if (err && err.status === 1 && stdout.trim() === '') {
      return { value: '' };
    }
    return null;
  }
}

function templateIsHealthy(dir) {
  if (!fs.existsSync(dir)) {
    return false;
  }
  const worktree = readCoreWorktree(dir);
  if (!worktree || worktree.value) {
    return false;
  }
  try {
    const tracked = execFileSync('git', ['ls-files'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return tracked.length === 0;
  } catch {
    return false;
  }
}

function seedTemplateOnce() {
  if (templateDir && !templateIsHealthy(templateDir)) {
    // BL-1867: a genuine re-seed (the template really went unhealthy) still
    // counts on top of what came before - seedCount() reports how many
    // templates THIS process created in total, not just "since the last
    // unhealthy one". Zeroing here was the reason seedCount() always read 1.
    templateDir = null;
  }
  if (templateDir && fs.existsSync(templateDir)) return templateDir;
  // mkProcessTmpDir, not mkTmpDir: BL-420's helper sweeps per TEST and its
  // shared sibling per FILE, and the template must outlive both or the saving
  // evaporates - it is seeded once and reused across files. Allocated through
  // the shared helper all the same, so this file carries no raw mkdtemp.
  const dir = mkProcessTmpDir(`${TEMPLATE_PREFIX}${process.pid}-`);
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
  // BL-1124/BL-1175 property runs can pollute the shared template with
  // core.worktree pointing at a foreign tmp dir; copies then look empty and
  // `git add` fails on paths from the foreign index (e.g. backlog/ submodule).
  try {
    gitIn(dir, ['config', '--unset', 'core.worktree']);
  } catch {
    // no worktree key — healthy copy
  }
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

module.exports = { checkoutSeededRepo, copySeededRepoInto, seedTemplateOnce, seedCount, resetForTest, TEMPLATE_PREFIX };
