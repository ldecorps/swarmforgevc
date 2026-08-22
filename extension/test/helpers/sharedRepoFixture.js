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
const { execFileSync } = require('child_process');

// Pinned, never inherited. `git init` takes its branch name from the HOST's
// init.defaultBranch, so a template that did not pin one would make every
// fixture host-dependent - green on a machine configured for `main`, red on
// one still defaulting to `master`. A shared fixture that varies by host is a
// worse foundation than the per-scenario seeding it replaces.
const SEEDED_BRANCH = 'main';

// Two shapes, because callers genuinely need different ones. Handing a caller
// the wrong shape is a coverage loss dressed as a speed win: config.test.js
// exercises initializeTargetRepo against a FRESHLY-INITIALIZED repo, and its
// `git log` assertion reads exactly the history an unrelated seeded commit
// would pollute - so seeding one there would change the subject under test,
// not just its setup.
const SHAPES = {
  committed: 'committed',   // initialized, identity set, one empty commit
  // Initialized and NOTHING else - no identity, no commits. Exactly what a
  // plain `git init` leaves behind, which is what makes it a behaviour-
  // preserving replacement for one.
  //
  // Setting identity here looked harmless and was not: config.test.js's
  // BL-443 cases exercise "the target has NO git identity configured" and
  // assert a fallback author is used. A seeded identity silently satisfied
  // the precondition and the assertions inverted - a coverage loss dressed as
  // a speed win, which is the exact failure invariant 3 forbids. Callers that
  // want identity still set it themselves, as they always did.
  empty: 'empty',
  bare: 'bare',             // a bare repository, for callers needing a push target
};

const templates = new Map();
let seedings = 0;

function gitIn(dir, args) {
  execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * The template, seeded at most once per process. Callers never touch it - they
 * only ever receive copies - so it can be reused for the whole run.
 */
function seedTemplateOnce(shape = SHAPES.committed) {
  const cached = templates.get(shape);
  if (cached && fs.existsSync(cached)) return cached;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bl1039-seed-${shape}-`));
  if (shape === SHAPES.bare) {
    // A push target. Served rather than exempted: an exemption may only name a
    // shape this fixture CANNOT provide, and a bare repo is cheap to seed once
    // like any other.
    gitIn(dir, ['init', '-q', '--bare', '-b', SEEDED_BRANCH]);
    templates.set(shape, dir);
    seedings += 1;
    return dir;
  }
  gitIn(dir, ['init', '-q', '-b', SEEDED_BRANCH]);
  if (shape === SHAPES.committed) {
    // Identity belongs to the committed shape only: it needs one to make the
    // commit. The empty shape must stay a bare `git init` equivalent.
    gitIn(dir, ['config', 'user.email', 't@t']);
    gitIn(dir, ['config', 'user.name', 't']);
    gitIn(dir, ['commit', '-q', '-m', 'init', '--allow-empty']);
  }
  templates.set(shape, dir);
  seedings += 1;
  return dir;
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
function checkoutSeededRepo(prefix = 'bl1039-repo-', register = null, shape = SHAPES.committed) {
  const template = seedTemplateOnce(shape);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
function copySeededRepoInto(dir, shape = SHAPES.committed) {
  const template = seedTemplateOnce(shape);
  fs.cpSync(template, dir, { recursive: true });
  return dir;
}

/** How many times the template was seeded this process - scenario 05's fact. */
function seedCount() {
  return seedings;
}

/** Test-only: forget the template so a test can observe a fresh seeding. */
function resetForTest() {
  templates.clear();
  seedings = 0;
}

module.exports = { checkoutSeededRepo, copySeededRepoInto, seedTemplateOnce, seedCount, resetForTest, SHAPES, SEEDED_BRANCH };
