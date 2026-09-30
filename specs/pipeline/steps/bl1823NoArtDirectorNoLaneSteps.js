'use strict';

// BL-1823: step handlers for "A repository with no art director has no
// art-director lane to guard". Drives the REAL check_art_director_tip.sh
// through the REAL pre-merge-commit hook chain (installed via
// core.hooksPath, the mkFixtureRepo shape bl1444ArtDirectorTipLandsSteps.js
// already established) as real `git merge --no-ff` subprocesses - never a
// reimplementation of the guard's decision logic. Handler lands in the
// SAME commit as the feature (BL-233, BL-1371).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'BL-1823 A repository with no art director has no art-director lane to guard';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const {
  deriveCommitGuardFixtureSet,
} = require(path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'commitGuardFixtureSet.js'));
const { trackedTmpRoot } = require('./lib/fixtureReaper');

let fixtureSetCache = null;
function getFixtureSet() {
  if (!fixtureSetCache) {
    fixtureSetCache = deriveCommitGuardFixtureSet({
      repoRoot: REPO_ROOT,
      runnerRel: 'swarmforge/git-hooks/pre-merge-commit',
      hookRels: ['swarmforge/git-hooks/pre-merge-commit'],
    });
  }
  return fixtureSetCache;
}

const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeAndAdd(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content || `${relPath}\n`);
  git(root, 'add', relPath);
}

// No roles.tsv, no swarmforge-art-director branch, no roster worktree -
// deliberately the opposite of bl1444's mkFixtureRepo, which always wires
// both. Each scenario's own Given adds exactly what it needs.
function mkFixtureRepo() {
  const root = trackedTmpRoot('sfvc-bl1823-');
  fixtureRoots.push(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');

  for (const rel of getFixtureSet().files) {
    const dst = path.join(root, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, rel), dst);
    fs.chmodSync(dst, 0o755);
  }
  fs.mkdirSync(path.join(root, 'specs', 'pipeline', 'steps'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'pipeline', 'steps', 'index.js'), 'module.exports = [];\n');
  fs.mkdirSync(path.join(root, 'extension'), { recursive: true });
  try {
    fs.symlinkSync(path.join(REPO_ROOT, 'extension', 'out'), path.join(root, 'extension', 'out'), 'dir');
  } catch {
    // A checker the guard cannot resolve is a refusal naming the reason
    // (BL-1303 fails closed) - never a false pass.
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed hooks');
  git(root, 'config', 'core.hooksPath', 'swarmforge/git-hooks');
  return root;
}

function mergeWithNoFf(ctx, targetBranch, ref, message) {
  git(ctx.root, 'checkout', '-q', targetBranch);
  const result = spawnSync('git', ['merge', '--no-ff', '-q', '-m', message, ref], {
    cwd: ctx.root,
    encoding: 'utf8',
  });
  ctx.mergeResult = { rc: result.status ?? 1, out: result.stdout || '', err: result.stderr || '' };
  if (ctx.mergeResult.rc !== 0) {
    spawnSync('git', ['merge', '--abort'], { cwd: ctx.root });
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a fixture repository whose pre-merge-commit chain runs the art-director tip guard$/, (ctx) => {
    ctx.root = mkFixtureRepo();
    git(ctx.root, 'checkout', '-q', '-b', 'landing', 'main');
    ctx.landingBranch = 'landing';
  });

  // ── Scenario 01 Givens ────────────────────────────────────────────────
  scoped(/^roles\.tsv has no art-director row$/, () => {
    // The fixture already carries no .swarmforge/roles.tsv at all - a
    // missing file reads identically to "no row" (resolve_art_director_
    // worktree_from_roles_tsv fails the same way for either).
  });

  scoped(/^no swarmforge-art-director branch exists$/, (ctx) => {
    const branches = git(ctx.root, 'branch', '--list', 'swarmforge-art-director');
    assert.equal(branches, '', 'expected no swarmforge-art-director branch to exist in the fresh fixture');
  });

  scoped(/^an ordinary branch is merged$/, (ctx) => {
    git(ctx.root, 'checkout', '-q', '-b', 'feature-branch', 'main');
    writeAndAdd(ctx.root, 'extension/src/ordinary_change.ts');
    git(ctx.root, 'commit', '-q', '-m', 'an ordinary change');
    ctx.mergedRef = 'feature-branch';
    mergeWithNoFf(ctx, ctx.landingBranch, 'feature-branch', 'merge an ordinary branch');
  });

  scoped(/^the merge commits$/, (ctx) => {
    assert.equal(ctx.mergeResult.rc, 0, `expected the merge to commit, got exit ${ctx.mergeResult.rc}: ${ctx.mergeResult.err}`);
  });

  // ── Scenario 02 Givens ────────────────────────────────────────────────
  scoped(/^roles\.tsv names an art-director worktree that cannot be read$/, (ctx) => {
    const unreadableWorktree = path.join(os.tmpdir(), `sfvc-bl1823-unreadable-${process.pid}-${Date.now()}`);
    ctx.unreadableWorktree = unreadableWorktree;
    fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.root, '.swarmforge', 'roles.tsv'),
      `art-director\tart-director\t${unreadableWorktree}\tswarmforge-art-director\tArt Director\tclaude\ttask\toff\tforward-only\n`
    );
  });

  scoped(/^the merge is refused naming that worktree$/, (ctx) => {
    assert.notEqual(ctx.mergeResult.rc, 0, 'expected the merge to be refused');
    const combined = `${ctx.mergeResult.out}${ctx.mergeResult.err}`;
    assert.ok(
      combined.includes(ctx.unreadableWorktree),
      `expected the refusal to name ${ctx.unreadableWorktree}, got: ${combined}`
    );
  });

  // ── Scenario 03 Givens ────────────────────────────────────────────────
  scoped(
    /^the swarmforge-art-director branch carries a commit touching a path outside the art director's lane$/,
    (ctx) => {
      git(ctx.root, 'branch', 'swarmforge-art-director', 'main');
      git(ctx.root, 'checkout', '-q', 'swarmforge-art-director');
      writeAndAdd(ctx.root, 'extension/src/out_of_lane.ts');
      git(ctx.root, 'commit', '-q', '-m', 'art-director tip touching extension/src/out_of_lane.ts');
      git(ctx.root, 'checkout', '-q', ctx.landingBranch);
    }
  );

  scoped(/^the swarmforge-art-director branch is merged$/, (ctx) => {
    mergeWithNoFf(ctx, ctx.landingBranch, 'swarmforge-art-director', 'merge swarmforge-art-director');
  });

  scoped(/^the merge is refused naming the out-of-lane path$/, (ctx) => {
    assert.notEqual(ctx.mergeResult.rc, 0, 'expected the merge to be refused');
    const combined = `${ctx.mergeResult.out}${ctx.mergeResult.err}`;
    assert.match(
      combined,
      /extension\/src\/out_of_lane\.ts/,
      `expected the refusal to name extension/src/out_of_lane.ts, got: ${combined}`
    );
  });
}

module.exports = { registerSteps };
