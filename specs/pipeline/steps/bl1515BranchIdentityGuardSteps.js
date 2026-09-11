'use strict';

// BL-1515: step handlers for "a role's worktree can sit on a branch that is
// not the one roles.tsv names and nothing notices". Drives the REAL
// ready_for_next.bb pre-turn guard against a real git fixture (git init/
// worktree/branch, no mocked git) - same established pattern as
// bl1195WorktreeTrackedContentDriftSteps.js, because the guard's own
// contract is entirely about real branch/ref state, which no stub can
// stand in for honestly.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'BL-1515 a role checkout on the wrong branch is caught before the turn';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], env: gitEnv() });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, env: gitEnv(), encoding: 'utf8' });
}

function refExists(cwd, ref) {
  const result = spawnSync('git', ['-C', cwd, 'rev-parse', '--verify', '--quiet', ref], { env: gitEnv() });
  return result.status === 0;
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1515-aps-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n');
  git(root, ['add', 'README.md', '.gitignore']);
  git(root, ['commit', '-q', '-m', 'base']);
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

  ctx.root = root;
  ctx.coderWt = coderWt;
  ctx.inbox = inbox;
  return root;
}

function writeRolesTsv(ctx, session) {
  // "guard-boundary-only" is not a recognized receive mode - dispatch_lib.bb's
  // run-dispatch! fails closed with its own INVALID_RECEIVE_MODE once a turn
  // reaches it, proving control passed every pre-turn guard (this one
  // included) without ever exec'ing the real dispatcher (same technique
  // bl1195WorktreeTrackedContentDriftSteps.js's fixture uses).
  //
  // Written into BOTH the outer root's .swarmforge/ AND the coder worktree's
  // own .swarmforge/ - the live install carries an identical roles.tsv copy
  // in each worktree (dispatch-lib/git-root resolves to the WORKTREE's own
  // toplevel for a linked worktree, which is what this guard reads role-info
  // through), so only writing the outer copy would silently make the guard
  // find no roles.tsv row and skip itself on every scenario.
  const line = `coder\tcoder\t${ctx.coderWt}\t${session}\tCoder\tclaude\tguard-boundary-only\n`;
  const identity = 'swarm_name\tprimary\nswarm_mode\tautonomous\n';
  for (const base of [ctx.root, ctx.coderWt]) {
    fs.mkdirSync(path.join(base, '.swarmforge'), { recursive: true });
    fs.writeFileSync(path.join(base, '.swarmforge', 'roles.tsv'), line);
    fs.writeFileSync(path.join(base, '.swarmforge', 'swarm-identity'), identity);
  }
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = undefined;
  }
}

function snapshotRefs(root) {
  const branches = gitOut(root, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes']);
  const head = gitOut(root, ['rev-parse', 'HEAD']).trim();
  const symbolic = spawnSync('git', ['-C', root, 'symbolic-ref', '-q', 'HEAD'], { env: gitEnv(), encoding: 'utf8' });
  return {
    branches: branches.trim(),
    head,
    headSymbolic: symbolic.status === 0 ? symbolic.stdout.trim() : null,
  };
}

function runReady(ctx) {
  const readyPath = path.join(ctx.coderWt, 'swarmforge', 'scripts', 'ready_for_next.bb');
  const env = { ...gitEnv(), SWARMFORGE_ROLE: 'coder' };
  ctx.preSnapshot = snapshotRefs(ctx.coderWt);
  const result = spawnSync('bb', [readyPath], { cwd: ctx.coderWt, env, encoding: 'utf8' });
  ctx.rc = result.status;
  ctx.stdout = result.stdout || '';
  ctx.stderr = result.stderr || '';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository under mkdtemp with a coder worktree$/, (ctx) => {
    mkFixture(ctx);
  });

  scoped(/^roles\.tsv declares the coder's session as "([^"]+)"$/, (ctx, session) => {
    writeRolesTsv(ctx, session);
    ctx.declaredSession = session;
  });

  scoped(/^the coder worktree is checked out on "([^"]+)"$/, (ctx, branch) => {
    if (refExists(ctx.coderWt, `refs/heads/${branch}`)) {
      git(ctx.coderWt, ['checkout', branch]);
    } else {
      git(ctx.coderWt, ['checkout', '-b', branch]);
    }
  });

  scoped(/^the local ref "([^"]+)" does not exist$/, (ctx, ref) => {
    const currentBranch = gitOut(ctx.coderWt, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    if (currentBranch === ref) {
      const base = gitOut(ctx.coderWt, ['rev-parse', 'HEAD']).trim();
      git(ctx.coderWt, ['checkout', '--detach', base]);
    }
    if (refExists(ctx.coderWt, `refs/heads/${ref}`)) {
      git(ctx.coderWt, ['branch', '-D', ref]);
    }
  });

  scoped(/^"origin\/([^"]+)" is an ancestor of the checked-out branch "([^"]+)"$/, (ctx, declared, branch) => {
    if (refExists(ctx.coderWt, `refs/heads/${branch}`)) {
      git(ctx.coderWt, ['checkout', branch]);
    } else {
      git(ctx.coderWt, ['checkout', '-b', branch]);
    }
    const tip = gitOut(ctx.coderWt, ['rev-parse', 'HEAD']).trim();
    git(ctx.coderWt, ['update-ref', `refs/remotes/origin/${declared}`, tip]);
    ctx.preRunTip = tip;
  });

  scoped(/^the local ref "([^"]+)" exists at a commit that is not the checked-out tip$/, (ctx, ref) => {
    const base = gitOut(ctx.coderWt, ['rev-parse', 'HEAD']).trim();
    git(ctx.coderWt, ['checkout', '--detach', base]);
    const tree = gitOut(ctx.coderWt, ['rev-parse', `${base}^{tree}`]).trim();
    const advanced = gitOut(ctx.coderWt, ['commit-tree', tree, '-p', base, '-m', 'advance-declared']).trim();
    git(ctx.coderWt, ['update-ref', `refs/heads/${ref}`, advanced]);
    ctx.declaredTip = advanced;
    ctx.baseTip = base;
  });

  scoped(/^the coder worktree has a detached HEAD$/, (ctx) => {
    const base = gitOut(ctx.coderWt, ['rev-parse', 'HEAD']).trim();
    git(ctx.coderWt, ['checkout', '--detach', base]);
  });

  scoped(/^the guard has already renamed "([^"]+)" to "([^"]+)"$/, (ctx, from, to) => {
    const currentBranch = gitOut(ctx.coderWt, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    if (currentBranch !== from) {
      if (refExists(ctx.coderWt, `refs/heads/${from}`)) {
        git(ctx.coderWt, ['checkout', from]);
      } else {
        git(ctx.coderWt, ['checkout', '-b', from]);
      }
    }
    if (refExists(ctx.coderWt, `refs/heads/${to}`)) {
      git(ctx.coderWt, ['branch', '-D', to]);
    }
    git(ctx.coderWt, ['branch', '-m', from, to]);
  });

  scoped(/^ready_for_next runs as coder$/, (ctx) => {
    try {
      runReady(ctx);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^no BRANCH_DRIFT line is printed$/, (ctx) => {
    assert.ok(
      !/BRANCH_DRIFT_(REPAIRED|DETECTED)/.test(ctx.stdout + ctx.stderr),
      `expected no BRANCH_DRIFT line, got stdout=${ctx.stdout} stderr=${ctx.stderr}`
    );
  });

  scoped(/^the turn proceeds to read the inbox$/, (ctx) => {
    try {
      assert.match(
        ctx.stderr,
        /INVALID_RECEIVE_MODE/,
        `expected control to reach dispatch, got rc=${ctx.rc} stdout=${ctx.stdout} stderr=${ctx.stderr}`
      );
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^a line "([^"]+)" is printed$/, (ctx, expectedPrefix) => {
    assert.ok(
      ctx.stdout.split('\n').some((line) => line.startsWith(expectedPrefix)),
      `expected a line starting with "${expectedPrefix}" in stdout, got: ${ctx.stdout}`
    );
  });

  scoped(/^the coder worktree is checked out on "([^"]+)" at the same commit$/, (ctx, branch) => {
    const actualBranch = gitOut(ctx.coderWt, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    assert.equal(actualBranch, branch, `expected checked out on ${branch}, got ${actualBranch}`);
    const actualTip = gitOut(ctx.coderWt, ['rev-parse', 'HEAD']).trim();
    assert.equal(actualTip, ctx.preRunTip, 'a rename must never move the commit');
  });

  scoped(/^it exits 2 with a line starting "([^"]+)"$/, (ctx, prefix) => {
    assert.equal(ctx.rc, 2, `expected exit 2, got rc=${ctx.rc} stdout=${ctx.stdout} stderr=${ctx.stderr}`);
    assert.ok(
      ctx.stderr.split('\n').some((line) => line.startsWith(prefix)),
      `expected a line starting with "${prefix}" in stderr, got: ${ctx.stderr}`
    );
  });

  scoped(/^the line names both the declared tip and the actual tip$/, (ctx) => {
    assert.ok(
      ctx.stderr.includes(`declared_tip=${ctx.declaredTip}`),
      `expected declared_tip=${ctx.declaredTip} in stderr, got: ${ctx.stderr}`
    );
    assert.ok(
      ctx.stderr.includes(`actual_tip=${ctx.baseTip}`),
      `expected actual_tip=${ctx.baseTip} in stderr, got: ${ctx.stderr}`
    );
  });

  scoped(/^every ref and HEAD are unchanged$/, (ctx) => {
    const post = snapshotRefs(ctx.coderWt);
    assert.deepEqual(
      post,
      ctx.preSnapshot,
      `expected no ref/HEAD change on refusal, before=${JSON.stringify(ctx.preSnapshot)} after=${JSON.stringify(post)}`
    );
  });

  scoped(/^nothing is moved into in_process$/, (ctx) => {
    try {
      const inProcessDir = path.join(ctx.inbox, 'in_process');
      const entries = fs.readdirSync(inProcessDir);
      assert.equal(entries.length, 0, `expected in_process/ empty, found: ${entries.join(', ')}`);
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
