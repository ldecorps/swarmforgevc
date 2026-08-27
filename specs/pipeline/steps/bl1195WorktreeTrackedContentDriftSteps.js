'use strict';

// BL-1195: step handlers for "a pipeline worktree's tracked content
// silently diverging from its own HEAD is detected, not silently carried
// forward". Drives the REAL ready_for_next.bb pre-turn guard against a
// real git fixture (git init/commit/worktree, no mocked git) - same
// established pattern as test_worktree_drift_guard.sh (the shell sibling
// this file's scenarios also cover), because the guard's own contract is
// entirely about real git state (a worktree's working tree vs its own
// HEAD), which no stub can stand in for honestly.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = "a pipeline worktree's tracked content silently diverging from its own HEAD is detected, not silently carried forward";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const DRIFT_REL = 'swarmforge/scripts/fixture-drift-marker.txt';

function git(cwd, args) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], env });
}

function installScripts(wt) {
  const dest = path.join(wt, 'swarmforge', 'scripts');
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(REAL_SCRIPTS_DIR)) {
    if (name.endsWith('.bb') || name.endsWith('.sh')) {
      fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, name), path.join(dest, name));
    }
  }
}

function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1195-aps-'));
  git(root, ['init', '-q', '-b', 'main']);
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, DRIFT_REL), 'ORIGINAL: known-good content\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n');
  git(root, ['add', DRIFT_REL, '.gitignore']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base']);
  git(root, ['branch', 'swarmforge-coder']);

  const coderWt = path.join(root, '.worktrees', 'coder');
  git(root, ['worktree', 'add', '-q', coderWt, 'swarmforge-coder']);
  installScripts(coderWt);

  const swarmforgeDir = path.join(root, '.swarmforge');
  const inbox = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox');
  for (const sub of ['new', 'in_process', 'completed']) {
    fs.mkdirSync(path.join(inbox, sub), { recursive: true });
  }
  fs.mkdirSync(swarmforgeDir, { recursive: true });
  // "guard-boundary-only" is not a recognized receive mode - dispatch_lib.bb's
  // run-dispatch! fails closed with its own INVALID_RECEIVE_MODE once a turn
  // reaches it, proving control passed every pre-turn guard without ever
  // exec'ing the real dispatcher against this machine's live coder mailbox
  // (same technique test_reference_freshness_guard.sh's own fixture uses).
  fs.writeFileSync(
    path.join(swarmforgeDir, 'roles.tsv'),
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\tguard-boundary-only\n`
  );
  fs.writeFileSync(swarmforgeDir + '/swarm-identity', 'swarm_name\tprimary\nswarm_mode\tautonomous\n');

  ctx.root = root;
  ctx.coderWt = coderWt;
  ctx.inbox = inbox;
  return root;
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = undefined;
  }
}

function runReady(ctx) {
  const readyPath = path.join(ctx.coderWt, 'swarmforge', 'scripts', 'ready_for_next.bb');
  const env = { ...process.env, SWARMFORGE_ROLE: 'coder' };
  const result = require('node:child_process').spawnSync('bb', [readyPath], {
    cwd: ctx.coderWt,
    env,
    encoding: 'utf8',
  });
  ctx.rc = result.status;
  ctx.stdout = result.stdout || '';
  ctx.stderr = result.stderr || '';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a pipeline role worktree whose branch HEAD holds known-good content for a tracked path$/, (ctx) => {
    mkFixture(ctx);
  });

  scoped(/^a tracked file under the worktree differs from what its own HEAD commits$/, (ctx) => {
    fs.writeFileSync(path.join(ctx.coderWt, DRIFT_REL), 'DRIFTED: no commit authored this\n');
  });

  scoped(/^every tracked file under the worktree matches its own HEAD$/, () => {
    // The fixture's own base state IS this - nothing to do.
  });

  scoped(/^the role has no in-progress task whose work would explain that edit$/, () => {
    // The fixture's own base state IS this (empty in_process/) - nothing to do.
  });

  scoped(/^that edit belongs to the role's own in-progress task$/, (ctx) => {
    fs.writeFileSync(
      path.join(ctx.inbox, 'in_process', '00_resume1.handoff'),
      'id: resume1\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 00\ntype: git_handoff\ntask: BL-000-demo\ncommit: 0000000000\n\nbody\n'
    );
  });

  scoped(/^the worktree integrity check runs$/, (ctx) => {
    try {
      runReady(ctx);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^it reports the drifted path and refuses to treat the worktree as clean$/, (ctx) => {
    try {
      assert.notEqual(ctx.rc, 0, `expected a non-zero exit refusing the turn, got rc=${ctx.rc} stdout=${ctx.stdout}`);
      assert.match(ctx.stderr, /WORKTREE_DRIFT_DETECTED/);
      assert.match(ctx.stderr, new RegExp(DRIFT_REL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.ok(!/^TASK:/m.test(ctx.stdout), `expected no task to print on a refused turn, got: ${ctx.stdout}`);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^it instructs preserving the drifted content \(stash\), never discarding it$/, (ctx) => {
    try {
      assert.match(ctx.stderr, /stash/i);
      assert.equal(
        fs.readFileSync(path.join(ctx.coderWt, DRIFT_REL), 'utf8'),
        'DRIFTED: no commit authored this\n',
        'the guard must never discard or modify the drifted content itself'
      );
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^it does not report that path as drift$/, (ctx) => {
    try {
      assert.ok(!/WORKTREE_DRIFT_DETECTED/.test(ctx.stderr), `expected no drift report, got: ${ctx.stderr}`);
      assert.match(ctx.stderr, /INVALID_RECEIVE_MODE/, 'expected control to reach dispatch once the in-progress task explained the drift');
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^it reports no drift$/, (ctx) => {
    try {
      assert.ok(!/WORKTREE_DRIFT_DETECTED/.test(ctx.stderr), `expected a clean worktree to report no drift, got: ${ctx.stderr}`);
      assert.match(ctx.stderr, /INVALID_RECEIVE_MODE/, 'expected control to reach dispatch on a clean worktree');
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
