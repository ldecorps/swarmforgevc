'use strict';

// BL-1200: step handlers for "a shell test fixture writes to its own
// repository, never to whatever repository an ambient redirect names".
//
// Drives the REAL expedite_fixture.sh and run_bb_suite.sh against a REAL
// decoy git repository named only by an inherited GIT_DIR/GIT_WORK_TREE -
// the exact shape of the incident this ticket fixes (backlog/evidence/
// master-checkout-detached-by-expedite-fixture-20260827.md), never a
// reimplementation of git env handling.
//
// Scenario Outline 02 checks run_bb_suite.sh's own wiring POSITIONALLY
// (the guard is sourced before the inventory gate) rather than by driving
// a full `run_bb_suite.sh` (no args) - that mode enumerates and spawns
// EVERY standing test, some of which drive real tmux (the run_bb_suite.sh
// header's own warning: "a full sweep run from inside an agent pane killed
// all eight live swarm sessions"), which an unattended acceptance run must
// never risk. `--list` is driven for real below; it never spawns a child.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE =
  'a shell test fixture writes to its own temp repository, never to whatever repository an ambient redirect names';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');
const FIXTURE_SCRIPT = path.join(SCRIPTS_TEST_DIR, 'expedite_fixture.sh');
const RUN_SUITE_SCRIPT = path.join(SCRIPTS_TEST_DIR, 'run_bb_suite.sh');

function cleanGitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function git(cwd, args, env) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: env || cleanGitEnv() }).trim();
}

function buildDecoyRepo() {
  const root = fs.realpathSync(mkSocketFixtureRoot('bl1200-decoy-'));
  git(root, ['init', '-q', '-b', 'main', '.']);
  git(root, ['config', 'user.email', 'decoy@example.com']);
  git(root, ['config', 'user.name', 'decoy']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'decoy: initial']);
  return root;
}

function redirectEnv(decoyRoot) {
  const env = cleanGitEnv();
  env.GIT_DIR = path.join(decoyRoot, '.git');
  env.GIT_WORK_TREE = decoyRoot;
  return env;
}

function decoyLogCount(decoyRoot) {
  const log = git(decoyRoot, ['log', '--oneline']);
  return log.split('\n').filter(Boolean).length;
}

function readRef(decoyRoot, refName) {
  if (refName === 'HEAD') {
    return git(decoyRoot, ['rev-parse', 'HEAD']);
  }
  if (refName === 'current branch') {
    return git(decoyRoot, ['symbolic-ref', '--short', 'HEAD']);
  }
  throw new Error(`bl1200: unrecognized <ref> example value "${refName}"`);
}

function cleanupFixtureState(ctx) {
  const st = ctx.bl1200;
  if (!st) return;
  if (st.decoyRoot) {
    fs.rmSync(st.decoyRoot, { recursive: true, force: true });
    releaseSocketFixtureRoot(st.decoyRoot);
  }
  if (st.fixtureRoot) {
    fs.rmSync(st.fixtureRoot, { recursive: true, force: true });
    releaseSocketFixtureRoot(st.fixtureRoot);
  }
  ctx.bl1200 = null;
}

// Positional check mirroring the ticket's own qa_e2e_procedure step 3: a
// guard sourced nowhere effective (here, AFTER the one git-adjacent gate it
// exists to protect) is the same failure as never having been added.
function assertGuardSourcedBeforeInventoryGate() {
  const content = fs.readFileSync(RUN_SUITE_SCRIPT, 'utf8');
  const lines = content.split('\n');
  const guardLine = lines.findIndex((l) => /source.*git_env_guard\.sh/.test(l));
  const inventoryLine = lines.findIndex((l) => l.includes('"$INVENTORY"'));
  assert.ok(guardLine !== -1, `run_bb_suite.sh no longer sources git_env_guard.sh: ${RUN_SUITE_SCRIPT}`);
  assert.ok(inventoryLine !== -1, `could not locate the inventory-gate invocation in ${RUN_SUITE_SCRIPT}`);
  assert.ok(
    guardLine < inventoryLine,
    `git_env_guard.sh is sourced at line ${guardLine + 1}, AFTER the inventory gate at line ${inventoryLine + 1}`
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^GIT_DIR and GIT_WORK_TREE are set in the environment and name a live repository$/, (ctx) => {
    const decoyRoot = buildDecoyRepo();
    ctx.bl1200 = {
      decoyRoot,
      env: redirectEnv(decoyRoot),
      decoyHeadBefore: git(decoyRoot, ['rev-parse', 'HEAD']),
      decoyLogCountBefore: decoyLogCount(decoyRoot),
    };
  });

  // ── 01: a shell fixture's git writes land in its own temp repo ─────────

  scoped(/^a shell test fixture creates its temp repository and commits to it$/, (ctx) => {
    const st = ctx.bl1200;
    const fixtureRoot = fs.realpathSync(mkSocketFixtureRoot('bl1200-fixture-'));
    const fixtureDest = path.join(fixtureRoot, 'dest');
    st.fixtureRoot = fixtureRoot;
    st.fixtureDest = fixtureDest;
    st.fixtureResult = spawnSync('bash', [FIXTURE_SCRIPT, fixtureDest], { encoding: 'utf8', env: st.env });
  });

  scoped(/^the commit is in the fixture's temp repository$/, (ctx) => {
    const st = ctx.bl1200;
    assert.equal(
      st.fixtureResult.status,
      0,
      `expedite_fixture.sh exited ${st.fixtureResult.status}: ${st.fixtureResult.stdout}${st.fixtureResult.stderr}`
    );
    const log = git(st.fixtureDest, ['log', '--oneline']);
    assert.match(log, /fixture: initial/, `expected the fixture's own commit in its own repo, got: ${log}`);
  });

  scoped(/^the live repository named by the redirect gains no commit$/, (ctx) => {
    const st = ctx.bl1200;
    try {
      const headAfter = git(st.decoyRoot, ['rev-parse', 'HEAD']);
      assert.equal(
        headAfter,
        st.decoyHeadBefore,
        `the decoy repository's HEAD changed: before=${st.decoyHeadBefore} after=${headAfter}`
      );
      const logCountAfter = decoyLogCount(st.decoyRoot);
      assert.equal(
        logCountAfter,
        st.decoyLogCountBefore,
        `the decoy repository gained a commit: before=${st.decoyLogCountBefore} after=${logCountAfter}`
      );
    } finally {
      cleanupFixtureState(ctx);
    }
  });

  // ── 02: a suite run under the redirect leaves the live repo's ref state
  //    alone ──────────────────────────────────────────────────────────────

  scoped(/^the live repository's (.+) is recorded before the run$/, (ctx, refName) => {
    const st = ctx.bl1200;
    st.refName = refName;
    st.refValueBefore = readRef(st.decoyRoot, refName);
  });

  scoped(/^the standing shell suite is run under the redirect$/, (ctx) => {
    const st = ctx.bl1200;
    // Real invocation, --list only (never spawns a child - see file header).
    st.listResult = spawnSync('bash', [RUN_SUITE_SCRIPT, '--list'], { encoding: 'utf8', env: st.env });
    // The actual discriminator: wiring order, independent of whatever a
    // given checkout's own suite-manifest.tsv drift (BL-973, out of this
    // ticket's scope) does to run_bb_suite.sh's own exit code.
    assertGuardSourcedBeforeInventoryGate();
  });

  scoped(/^the live repository's (.+) is unchanged$/, (ctx, refName) => {
    const st = ctx.bl1200;
    try {
      assert.equal(refName, st.refName, `Then step asks about "${refName}" but Given recorded "${st.refName}"`);
      const after = readRef(st.decoyRoot, refName);
      assert.equal(
        after,
        st.refValueBefore,
        `the decoy repository's ${refName} changed: before=${st.refValueBefore} after=${after}`
      );
    } finally {
      cleanupFixtureState(ctx);
    }
  });
}

module.exports = { registerSteps };
