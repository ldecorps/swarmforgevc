'use strict';

// BL-1947 (BL-106 stamp-off): step handlers for "role branches are
// namespaced by swarm identity". Drives the REAL branch_naming_lib.bb
// (derive-branch-name), the REAL check_branch_namespace.bb CLI, and the
// REAL migrate_branch_names.sh against fresh fixture git repos - the exact
// fixture shapes swarmforge/scripts/test/test_check_branch_namespace.sh and
// test_migrate_branch_names.sh already establish, never a restatement of
// the derivation/migration logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const BRANCH_NAMING_LIB = path.join(SCRIPTS, 'branch_naming_lib.bb');
const CHECK_CLI = path.join(SCRIPTS, 'check_branch_namespace.bb');
const MIGRATE_SH = path.join(SCRIPTS, 'migrate_branch_names.sh');

const FEATURE = 'role branches are namespaced by swarm identity';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function proveFixtureIsolated(root) {
  const commonDir = git(root, ['rev-parse', '--git-common-dir']);
  assert.ok(
    path.resolve(root, commonDir).startsWith(root),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
}

function mkFixtureRoot() {
  const root = trackedTmpRoot('sfvc-bl106-');
  git(root, ['init', '-q']);
  proveFixtureIsolated(root);
  git(root, ['config', 'user.email', 'bl106@example.com']);
  git(root, ['config', 'user.name', 'bl106']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  return root;
}

function deriveBranchName(swarmName, role) {
  const out = execFileSync(
    'bb',
    ['-e', `(load-file ${JSON.stringify(BRANCH_NAMING_LIB)}) (print (branch-naming-lib/derive-branch-name ${JSON.stringify(swarmName)} ${JSON.stringify(role)}))`],
    { encoding: 'utf8' }
  );
  return out.trim();
}

// Builds one role worktree on <swarmName>/<role> and a roles.tsv row for
// it, mirroring test_check_branch_namespace.sh/test_migrate_branch_names.sh's
// own fixture shape exactly.
function addWorktreeRole(root, swarmName, role) {
  const branch = deriveBranchName(swarmName, role);
  const worktree = path.join(root, '.worktrees', swarmName, role);
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  git(root, ['worktree', 'add', '-q', '-b', branch, worktree]);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.appendFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `${role}\t${role}\t${worktree}\tswarmforge-${role}\t${role}\tclaude\ttask\n`
  );
  return { branch, worktree };
}

function writeSwarmIdentity(root, swarmName) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'swarm-identity'),
    `swarm_name\t${swarmName}\nswarm_mode\tautonomous\nswarm_mode_primary\t${swarmName}\n`
  );
}

function runCheck(root) {
  const res = spawnSync('bb', [CHECK_CLI, root], { encoding: 'utf8' });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── branch-ns-01: launcher derives branch names from swarm_name ───────
  scoped(/^a conf with swarm_name alpha$/, (ctx) => {
    ctx.swarmName = 'alpha';
  });

  scoped(/^the swarm launches its worktrees$/, (ctx) => {
    ctx.root = mkFixtureRoot();
    writeSwarmIdentity(ctx.root, ctx.swarmName);
    ctx.roles = ['coder', 'cleaner'];
    ctx.worktrees = ctx.roles.map((role) => ({ role, ...addWorktreeRole(ctx.root, ctx.swarmName, role) }));
    // master-resident role: skipped by both check/migrate scripts.
    fs.appendFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `coordinator\tmaster\t${ctx.root}\tswarmforge-coordinator\tcoordinator\tclaude\ttask\n`);
  });

  scoped(/^every role worktree is on branch alpha\/<role>$/, (ctx) => {
    for (const { role, branch } of ctx.worktrees) {
      assert.equal(branch, `${ctx.swarmName}/${role}`);
      assert.equal(git(ctx.root, ['-C', ctx.worktrees.find((w) => w.role === role).worktree, 'rev-parse', '--abbrev-ref', 'HEAD']), `${ctx.swarmName}/${role}`);
    }
    const checkResult = runCheck(ctx.root);
    assert.equal(checkResult.status, 0, `expected check_branch_namespace.bb to pass, got: ${checkResult.out}`);
    assert.match(checkResult.out, new RegExp(`^OK: every role worktree branch matches the ${ctx.swarmName}/<role> namespace$`, 'm'));
  });

  // ── branch-ns-02: two swarms share a repo without collisions ─────────
  // Two independent swarm installations off the SAME underlying .git
  // object store (real topology: a second `git worktree add` rooted
  // elsewhere, with its own .swarmforge/ directory) - never one shared
  // roles.tsv pretending to run two swarms at once.
  scoped(/^worktree sets for swarm_names alpha and beta on one repo$/, (ctx) => {
    ctx.root = mkFixtureRoot();
    ctx.alphaWorktree = addWorktreeRole(ctx.root, 'alpha', 'coder');
    writeSwarmIdentity(ctx.root, 'alpha');

    const betaRoot = path.join(ctx.root, '.worktrees', 'beta-root');
    git(ctx.root, ['worktree', 'add', '-q', '-b', 'beta-root', betaRoot]);
    ctx.betaRoot = betaRoot;
    const betaCoderBranch = deriveBranchName('beta', 'coder');
    const betaCoderWorktree = path.join(betaRoot, '.worktrees', 'coder');
    git(ctx.root, ['worktree', 'add', '-q', '-b', betaCoderBranch, betaCoderWorktree]);
    fs.mkdirSync(path.join(betaRoot, '.swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(betaRoot, '.swarmforge', 'roles.tsv'),
      `coder\tcoder\t${betaCoderWorktree}\tswarmforge-coder\tCoder\tclaude\ttask\n`
    );
    writeSwarmIdentity(betaRoot, 'beta');
    ctx.betaWorktree = { branch: betaCoderBranch, worktree: betaCoderWorktree };
  });

  scoped(/^both are inspected$/, (ctx) => {
    ctx.allBranches = git(ctx.root, ['branch', '--list']);
    ctx.alphaCheck = runCheck(ctx.root);
    ctx.betaCheck = runCheck(ctx.betaRoot);
  });

  scoped(/^no branch ref is shared between them$/, (ctx) => {
    assert.notEqual(ctx.alphaWorktree.branch, ctx.betaWorktree.branch);
    assert.match(ctx.allBranches, /alpha\/coder/);
    assert.match(ctx.allBranches, /beta\/coder/);
  });

  scoped(/^each swarm's helpers address only its own namespace$/, (ctx) => {
    // Each swarm's own check_branch_namespace.bb run (its own project-root,
    // its own roles.tsv) reports OK against only its OWN namespace, and
    // names only its own swarm in its output - the other swarm's identity
    // never appears, proof the helper addresses only its own worktree row.
    assert.equal(ctx.alphaCheck.status, 0, `expected alpha's own namespace check to pass, got: ${ctx.alphaCheck.out}`);
    assert.match(ctx.alphaCheck.out, /^OK: every role worktree branch matches the alpha\/<role> namespace$/m);
    assert.doesNotMatch(ctx.alphaCheck.out, /beta/);

    assert.equal(ctx.betaCheck.status, 0, `expected beta's own namespace check to pass, got: ${ctx.betaCheck.out}`);
    assert.match(ctx.betaCheck.out, /^OK: every role worktree branch matches the beta\/<role> namespace$/m);
    assert.doesNotMatch(ctx.betaCheck.out, /alpha/);
  });

  // ── branch-ns-04: migration preserves everything ──────────────────────
  scoped(/^the current mixed-scheme branches$/, (ctx) => {
    ctx.root = mkFixtureRoot();
    const worktrees = path.join(ctx.root, '.worktrees');
    fs.mkdirSync(worktrees, { recursive: true });
    git(ctx.root, ['worktree', 'add', '-q', '-b', 'swarmforge-coder', path.join(worktrees, 'coder')]);
    git(ctx.root, ['worktree', 'add', '-q', '-b', 'swarm/cleaner', path.join(worktrees, 'cleaner')]);
    // A fully-merged stale duplicate of coder's own branch.
    git(ctx.root, ['branch', 'swarm/coder', 'swarmforge-coder']);
    // An UNMERGED stale duplicate for cleaner.
    git(ctx.root, ['worktree', 'add', '-q', '-b', 'unmerged-scratch', path.join(worktrees, 'unmerged-scratch')]);
    git(path.join(worktrees, 'unmerged-scratch'), ['commit', '-q', '--allow-empty', '-m', 'unmerged work']);
    git(ctx.root, ['branch', '-m', 'unmerged-scratch', 'swarmforge-cleaner']);
    git(ctx.root, ['worktree', 'remove', path.join(worktrees, 'unmerged-scratch')]);

    ctx.coderHeadBefore = git(ctx.root, ['-C', path.join(worktrees, 'coder'), 'rev-parse', 'HEAD']);
    ctx.cleanerHeadBefore = git(ctx.root, ['-C', path.join(worktrees, 'cleaner'), 'rev-parse', 'HEAD']);

    fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.root, '.swarmforge', 'roles.tsv'),
      `coordinator\tmaster\t${ctx.root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n` +
        `coder\tcoder\t${path.join(worktrees, 'coder')}\tswarmforge-coder\tCoder\tclaude\ttask\n` +
        `cleaner\tcleaner\t${path.join(worktrees, 'cleaner')}\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n`
    );
    ctx.worktreesDir = worktrees;
  });

  scoped(/^the migration runs$/, (ctx) => {
    const res = spawnSync('bash', [MIGRATE_SH, ctx.root, 'primary'], { encoding: 'utf8' });
    ctx.migrationOutput = `${res.stdout || ''}${res.stderr || ''}`;
  });

  scoped(/^each role worktree is on its unified branch with identical HEAD$/, (ctx) => {
    assert.equal(git(ctx.root, ['-C', path.join(ctx.worktreesDir, 'coder'), 'rev-parse', '--abbrev-ref', 'HEAD']), 'primary/coder');
    assert.equal(git(ctx.root, ['-C', path.join(ctx.worktreesDir, 'coder'), 'rev-parse', 'HEAD']), ctx.coderHeadBefore);
    assert.equal(git(ctx.root, ['-C', path.join(ctx.worktreesDir, 'cleaner'), 'rev-parse', '--abbrev-ref', 'HEAD']), 'primary/cleaner');
    assert.equal(git(ctx.root, ['-C', path.join(ctx.worktreesDir, 'cleaner'), 'rev-parse', 'HEAD']), ctx.cleanerHeadBefore);
  });

  scoped(/^stale duplicate role branches are removed only if fully merged$/, (ctx) => {
    let threw = false;
    try {
      git(ctx.root, ['show-ref', '--verify', '--quiet', 'refs/heads/swarm/coder']);
    } catch {
      threw = true;
    }
    assert.ok(threw, 'the fully-merged duplicate branch swarm/coder must be pruned');
    assert.match(ctx.migrationOutput, /PRUNE: deleting fully-merged duplicate branch swarm\/coder/);

    // The unmerged duplicate must survive.
    git(ctx.root, ['show-ref', '--verify', '--quiet', 'refs/heads/swarmforge-cleaner']);
    assert.match(ctx.migrationOutput, /SKIP-PRUNE: swarmforge-cleaner is NOT fully merged/);
  });
}

module.exports = { registerSteps };
