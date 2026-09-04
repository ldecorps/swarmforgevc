'use strict';

// BL-1395 declared invariants (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`.
//
//   1. No commit reaches main carrying a Babashka script that fails SCI
//      analysis: every .bb a commit or land changes is load-filed against the
//      tree under test, and a failure names the file, line and symbol and
//      refuses - a grep for a label is never accepted as proof a file loads.
//   2. handoffd in particular is BOOTED from the tree under test, not merely
//      analysed, because SCI analyses each defn eagerly and a forward
//      reference inside a defn is only proven absent by loading the whole
//      file in order.
//   3. The guard's verdict is a function of the tree under test alone, never
//      of the checking worktree: a script that loads in the checker's
//      worktree but not on the tree refuses.
//
// GENERATOR REACH (BL-654): every generated case is a defect candidate BY
// CONSTRUCTION - the caller's body is DERIVED from the callee's name, so a
// wrongly-ordered pair is always a real forward reference rather than one the
// generator has to stumble onto. Invariant 2's generator emits handoffd
// shapes whose defect sits AFTER the early-exit top level, the one region a
// load-only probe can never reach; a guard that analysed instead of booting
// would pass every one of them.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_bb_scripts_load.sh');

const NAME = fc.stringMatching(/^[a-z][a-z0-9]{2,6}$/);

// These fixtures build throwaway repositories, and an inherited GIT_DIR would
// redirect every `git -C <fixture>` onto the caller's repo - the shape that
// let this ticket's shell suite commit onto a live branch. In this suite the
// ambient strip is already done once at load by helpers/gitEnvGuardSetup.js
// (BL-1196), so fixtures inherit a clean environment; the decoy below sets one
// deliberately, for the guard child alone.
function git(cwdArgs) {
  return spawnSync('git', cwdArgs, { encoding: 'utf8' });
}

// A per-invocation root stamped with its owner pid, removed in a finally.
// Never a blind prefix sweep (BL-1385/BL-1390): a concurrent sibling's root
// is not this run's to delete.
function withFixture(fn) {
  const work = mkTmpDir('bl1395-prop-');
  try {
    fs.writeFileSync(path.join(work, '.fixture-owner-pid'), `${process.pid}\n`);
    return fn(work);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// A tree under test: `files` are written under swarmforge/scripts and
// committed, so the guard's default "what did HEAD change" selection sees
// them exactly as it would on a real commit.
function makeTree(work, label, files) {
  const root = path.join(work, label);
  const scripts = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(scripts, name), body);
  }
  const gitc = (...args) => git(['-C', root, ...args]);
  gitc('init', '-q', '-b', 'main');
  gitc('config', 'user.email', 't@t');
  gitc('config', 'user.name', 't');
  gitc('config', 'commit.gpgsign', 'false');
  gitc('add', '-A');
  gitc('commit', '-qm', 'seed');
  return root;
}

function runGuard(root, cwd, extraEnv) {
  const r = spawnSync('bash', [GUARD, root], {
    encoding: 'utf8',
    cwd: cwd || REPO_ROOT,
    env: { ...process.env, BB_LOAD_TIMEOUT: '60', BB_BOOT_TIMEOUT: '90', ...(extraEnv || {}) },
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

// A decoy repository standing in for the checker's own: a pre-commit hook
// exports GIT_DIR and GIT_INDEX_FILE, and this guard is wired into that hook.
function makeDecoy(work) {
  const decoy = path.join(work, 'decoy');
  fs.mkdirSync(decoy, { recursive: true });
  const gitd = (...a) => git(['-C', decoy, ...a]);
  git(['init', '-q', '-b', 'main', decoy]);
  gitd('config', 'user.email', 't@t');
  gitd('config', 'user.name', 't');
  gitd('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(decoy, 'file.txt'), 'decoy\n');
  // Pending content, deliberately: an inherited-GIT_DIR commit only lands when
  // the caller's index has something to record, which is why the live incident
  // needed a staged tree to show itself.
  fs.writeFileSync(path.join(decoy, 'pending.txt'), 'pending\n');
  gitd('add', '-A');
  gitd('commit', '-qm', 'decoy');
  fs.writeFileSync(path.join(decoy, 'later.txt'), 'later\n');
  const head = () => git(['-C', decoy, 'rev-parse', 'HEAD']).stdout.trim();
  return {
    head,
    env: {
      GIT_DIR: path.join(decoy, '.git'),
      GIT_WORK_TREE: decoy,
      GIT_INDEX_FILE: path.join(decoy, '.git', 'index'),
    },
  };
}

describe('BL-1395 declared invariants', () => {
  it('inv1: a changed .bb that fails SCI analysis refuses, naming file, line and symbol', () => {
    fc.assert(
      fc.property(NAME, (sfx) => {
        // Constructed collision: the caller's body IS the callee's name, so
        // ordering it first is a genuine eager-analysis failure every time.
        const callee = `g${sfx}`;
        const caller = `f${sfx}`;
        const file = `lib${sfx}.bb`;
        const defCallee = `(defn ${callee} [] 1)\n`;
        const defCaller = `(defn ${caller} [] (${callee}))\n`;

        withFixture((work) => {
          const broken = makeTree(work, 'broken', { [file]: defCaller + defCallee });
          const bad = runGuard(broken);
          assert.notEqual(bad.code, 0, `forward reference must refuse:\n${bad.out}`);
          assert.match(bad.out, /BB_LOAD_BLOCK/);
          assert.ok(bad.out.includes(file), `refusal must name the file:\n${bad.out}`);
          assert.ok(bad.out.includes(callee), `refusal must name the symbol:\n${bad.out}`);
          assert.match(bad.out, /:\d+:\d+|:line \d+/, `refusal must name the line:\n${bad.out}`);

          // Same two definitions, correct order: the guard must not refuse a
          // healthy tree - a guard that refuses everything proves nothing.
          const good = makeTree(work, 'good', { [file]: defCallee + defCaller });
          const ok = runGuard(good);
          assert.equal(ok.code, 0, `well-ordered file must pass:\n${ok.out}`);
        });
      }),
      { numRuns: 6 },
    );
  }, 240000);

  it('inv2: handoffd is booted, so a defect past its early-exit top level is caught', () => {
    fc.assert(
      fc.property(NAME, fc.integer({ min: 0, max: 3 }), (sfx, padding) => {
        const missing = `nope${sfx}`;
        // The shape that matters: handoffd's top level exits when it is run
        // with no arguments, so a bare load-file stops there. Everything
        // below is reachable only by BOOTING the file.
        const head = '(when (empty? *command-line-args*) (System/exit 3))\n';
        const pad = ';; filler\n'.repeat(padding);
        const tail = '(println "sweep-once done")\n';
        const broken = `${head}${pad}(defn probe${sfx} [] (${missing}))\n${tail}`;
        const healthy = `${head}${pad}(defn probe${sfx} [] 1)\n${tail}`;

        withFixture((work) => {
          // Non-vacuity, asserted rather than assumed: a load-only probe sees
          // nothing wrong with the broken file, so any pass below would be a
          // guard that analysed instead of booting.
          const probeFile = path.join(work, 'probe.bb');
          fs.writeFileSync(probeFile, broken);
          const loadOnly = spawnSync('bb', ['-e', `(load-file "${probeFile}")`], {
            encoding: 'utf8',
          });
          assert.doesNotMatch(
            `${loadOnly.stdout || ''}${loadOnly.stderr || ''}`,
            /Unable to resolve symbol/,
            'the fixture must be invisible to a load-only probe, or invariant 2 is untested',
          );

          const badTree = makeTree(work, 'brokend', { 'handoffd.bb': broken });
          const bad = runGuard(badTree);
          assert.notEqual(bad.code, 0, `broken handoffd must refuse:\n${bad.out}`);
          assert.ok(bad.out.includes('handoffd.bb'), `refusal must name handoffd:\n${bad.out}`);

          const goodTree = makeTree(work, 'goodd', { 'handoffd.bb': healthy });
          const good = runGuard(goodTree);
          assert.equal(good.code, 0, `booting handoffd must pass:\n${good.out}`);
        });
      }),
      { numRuns: 5 },
    );
  }, 240000);

  it('inv3: the verdict follows the tree under test, never the checking worktree', () => {
    fc.assert(
      fc.property(NAME, (sfx) => {
        const helperFile = `help${sfx}.bb`;
        const mainFile = `use${sfx}.bb`;
        const fn = `hfn${sfx}`;
        const helper = `(defn ${fn} [] 1)\n`;
        const user = `(load-file "${helperFile}")\n(defn caller${sfx} [] (${fn}))\n`;

        withFixture((work) => {
          // The checker's side has the helper; the tree under test does not.
          const checker = path.join(work, 'checker');
          fs.mkdirSync(checker, { recursive: true });
          fs.writeFileSync(path.join(checker, helperFile), helper);

          const treeWithout = makeTree(work, 'without', { [mainFile]: user });
          const refused = runGuard(treeWithout, checker);
          assert.notEqual(
            refused.code,
            0,
            `a file that loads only in the checker's worktree must refuse:\n${refused.out}`,
          );
          assert.ok(refused.out.includes(mainFile), `refusal must name the file:\n${refused.out}`);

          // Mirror: the tree has the helper and the checker's side does not.
          const bare = path.join(work, 'bare');
          fs.mkdirSync(bare, { recursive: true });
          const treeWith = makeTree(work, 'with', {
            [helperFile]: helper,
            [mainFile]: user,
          });
          // The leak that actually happened: under an inherited GIT_DIR,
          // `git init <fixture>` initialises the CHECKER's repository, so the
          // guard's own fixture commit lands on the checker's branch and its
          // changed-file listing reads the checker's HEAD. Both directions of
          // invariant 3 are asserted: the verdict still follows the tree, and
          // the leaked repository is left untouched.
          const decoy = makeDecoy(work);
          const decoyBefore = decoy.head();
          const leaked = runGuard(treeWithout, checker, decoy.env);
          assert.notEqual(
            leaked.code,
            0,
            `a leaked git environment must not steer the verdict:\n${leaked.out}`,
          );
          assert.equal(
            decoy.head(),
            decoyBefore,
            'the guard committed its fixture into the leaked repository',
          );

          const passed = runGuard(treeWith, bare);
          assert.equal(
            passed.code,
            0,
            `a tree that is whole must pass whatever the checker's worktree holds:\n${passed.out}`,
          );
        });
      }),
      { numRuns: 6 },
    );
  }, 240000);
});
