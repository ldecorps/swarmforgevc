'use strict';

// BL-1657: step handlers for "The art-director tip guard resolves the art
// director's branch from the roster, whatever the pack names it". Drives
// the REAL swarmforge/scripts/check_art_director_tip.sh through the REAL
// pre-merge-commit hook chain (installed via core.hooksPath, mirroring
// bl1444ArtDirectorTipLandsSteps.js's mkFixtureRepo shape) as real `git
// merge --no-ff` subprocesses, plus a direct-mode `--tip --branch`
// invocation for the explicit-override scenario - never a parallel
// reimplementation of the guard's own resolution order.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-1657 The art-director tip guard resolves the art director's branch from the roster, whatever the pack names it";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_art_director_tip.sh');

const KNOWN_BRANCHES = new Set(['swarmforge-art-director', 'primary/art-director', 'review/art-director']);

const {
  deriveCommitGuardFixtureSet,
} = require(path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'commitGuardFixtureSet.js'));

// BL-968: lazy, on first use inside mkFixtureRepo() - see
// bl1444ArtDirectorTipLandsSteps.js's identical rationale.
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

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeAndAdd(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content || `${relPath}\n`);
  git(root, 'add', relPath);
}

function mkFixtureRepo() {
  const root = trackedTmpRoot('sfvc-bl1657-acceptance-');
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

function writeRolesTsv(root, worktreePath) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `art-director\tart-director\t${worktreePath}\tswarmforge-art-director\tArt Director\tclaude\ttask\toff\tforward-only\n`
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a fixture repository under a temporary directory with a main branch, a roles\.tsv, and the guard's hook chain installed$/, (ctx) => {
    ctx.root = mkFixtureRepo();
    git(ctx.root, 'checkout', '-q', '-b', 'landing', 'main');
    ctx.landingTipBefore = git(ctx.root, 'rev-parse', 'HEAD');
  });

  // ── Givens ──────────────────────────────────────────────────────────────
  scoped(/^the roster's art-director row points at a worktree checked out on "?([^"]+)"?$/, (ctx, branch) => {
    assert.ok(KNOWN_BRANCHES.has(branch), `unknown branch example value: ${branch}`);
    const wt = trackedTmpRoot('sfvc-bl1657-ad-worktree-');
    git(ctx.root, 'worktree', 'add', '-q', '-b', branch, wt, 'main');
    writeRolesTsv(ctx.root, wt);
    ctx.adWorktree = wt;
    ctx.adBranch = branch;
  });

  scoped(/^the roster's art-director row points at a worktree path that does not exist$/, (ctx) => {
    const missing = path.join(os.tmpdir(), `sfvc-bl1657-missing-worktree-${process.pid}-${Date.now()}`);
    writeRolesTsv(ctx.root, missing);
    ctx.missingWorktree = missing;
    // The actual branch still needs to exist as a plain ref so the merge
    // below has real content to bring in - the guard's resolution failure
    // is about the roster row's WORKTREE, never about the branch object
    // itself being absent.
    git(ctx.root, 'branch', 'swarmforge-art-director', 'main');
  });

  scoped(/^a docs\/design\/ commit on "?([^"]+)"? not reachable from main$/, (ctx, branch) => {
    assert.ok(KNOWN_BRANCHES.has(branch), `unknown branch example value: ${branch}`);
    // Only use the roster's own worktree when this commit is going on the
    // SAME branch that worktree is checked out on - scenario 03 deliberately
    // commits to a DIFFERENT branch than the roster row names, to prove
    // --branch overrides the roster rather than reading the worktree.
    const useAdWorktree = ctx.adWorktree && ctx.adBranch === branch;
    const target = useAdWorktree ? ctx.adWorktree : ctx.root;
    if (!useAdWorktree) {
      const exists = spawnSync('git', ['rev-parse', '-q', '--verify', branch], { cwd: target }).status === 0;
      git(target, 'checkout', '-q', ...(exists ? [branch] : ['-b', branch, 'main']));
    }
    writeAndAdd(target, 'docs/design/system.md');
    git(target, 'commit', '-q', '-m', `art-director tip on ${branch}`);
    ctx.adTip = git(target, 'rev-parse', 'HEAD');
    if (!useAdWorktree) {
      git(target, 'checkout', '-q', 'landing');
    }
  });

  // ── Whens ───────────────────────────────────────────────────────────────
  scoped(/^QA lands that tip by merge$/, (ctx) => {
    git(ctx.root, 'checkout', '-q', 'landing');
    const result = spawnSync('git', ['merge', '--no-ff', '-q', '-m', 'merge art-director tip', ctx.adTip], {
      cwd: ctx.root,
      encoding: 'utf8',
    });
    ctx.mergeResult = { rc: result.status ?? 1, out: result.stdout || '', err: result.stderr || '' };
    if (ctx.mergeResult.rc !== 0) {
      spawnSync('git', ['merge', '--abort'], { cwd: ctx.root });
    }
  });

  scoped(/^the guard runs in tip mode on that commit with --branch "?([^"]+)"?$/, (ctx, branch) => {
    assert.ok(KNOWN_BRANCHES.has(branch), `unknown branch example value: ${branch}`);
    const result = spawnSync('bash', [GUARD_SCRIPT, '--tip', ctx.adTip, '--branch', branch], {
      cwd: ctx.root,
      encoding: 'utf8',
    });
    ctx.directResult = { rc: result.status ?? 1, out: result.stdout || '', err: result.stderr || '' };
  });

  // ── Thens ───────────────────────────────────────────────────────────────
  scoped(/^the merge commit lands$/, (ctx) => {
    assert.equal(ctx.mergeResult.rc, 0, `expected the merge to succeed, got exit ${ctx.mergeResult.rc}: ${ctx.mergeResult.err}`);
    const result = spawnSync('git', ['merge-base', '--is-ancestor', ctx.adTip, 'landing'], { cwd: ctx.root });
    assert.equal(result.status, 0, `expected ${ctx.adTip} to be an ancestor of landing`);
  });

  scoped(/^the merge is refused$/, (ctx) => {
    assert.notEqual(ctx.mergeResult.rc, 0, 'expected the merge to be refused, got exit 0');
  });

  scoped(/^the refusal names the ref it resolved and the roster as its source$/, (ctx) => {
    const combined = `${ctx.mergeResult.out}${ctx.mergeResult.err}`;
    assert.ok(
      combined.includes(ctx.missingWorktree),
      `expected the refusal to name the roster's worktree path ${ctx.missingWorktree}, got: ${combined}`
    );
    assert.match(
      combined,
      /roles\.tsv/i,
      `expected the refusal to name the roster (roles.tsv) as the source, got: ${combined}`
    );
  });

  scoped(/^the guard accepts the tip$/, (ctx) => {
    assert.equal(ctx.directResult.rc, 0, `expected the guard to accept the tip, got exit ${ctx.directResult.rc}: ${ctx.directResult.err}`);
    const combined = `${ctx.directResult.out}${ctx.directResult.err}`;
    assert.match(combined, /ART_DIRECTOR_TIP_OK/, `expected ART_DIRECTOR_TIP_OK, got: ${combined}`);
  });
}

module.exports = { registerSteps };
