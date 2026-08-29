'use strict';

// BL-1237: the reference-freshness pre-turn guard (BL-640,
// swarmforge/scripts/ready_for_next.bb + reference_freshness_lib.bb) must
// refuse a role's turn only for reference/ content the worktree is
// MISSING relative to main - never for content it carries that main does
// not yet have (an in-flight parcel routinely ahead of main). Drives the
// REAL ready_for_next.bb against real git fixtures - never a
// reimplementation of the ancestry/content comparison.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'ready_for_next.bb');
const REL_PATH = 'swarmforge/constitution/articles/reference/engineering-detailed.prompt';

const FEATURE_NAME = 'The reference-freshness guard refuses only for amendments the worktree is missing';
const FIXTURE_PREFIX = 'bl1237-freshness-';

function sweepStaleFixtures() {
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
    }
  }
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}
function gitC(root, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-C', root, ...args], { encoding: 'utf8' });
}

function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function mkFixtureRoot() {
  sweepStaleFixtures();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), '');
  writeFile(root, REL_PATH, 'v1');
  git(root, 'init', '-q', '-b', 'main');
  gitC(root, 'add', '-A');
  gitC(root, 'commit', '-q', '-m', 'init');
  gitC(root, 'worktree', 'add', '-q', '-b', 'cleaner', '.worktrees/cleaner');
  fs.mkdirSync(path.join(root, '.worktrees', 'cleaner', '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.worktrees', 'cleaner', '.swarmforge', 'roles.tsv'), '');
  return root;
}

function runGuard(worktreeRoot) {
  const res = spawnSync('bb', [GUARD_SCRIPT], { cwd: worktreeRoot, encoding: 'utf8', timeout: 30_000 });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  scoped(/^a role worktree and main both carry the reference elaboration files$/, (ctx) => {
    ctx.root = mkFixtureRoot();
    ctx.worktree = path.join(ctx.root, '.worktrees', 'cleaner');
  });

  scoped(
    /^main's version of a reference file is (not reachable in|already in) the worktree's history$/,
    (ctx, reachability) => {
      ctx.reachability = reachability;
    },
  );

  scoped(/^the worktree's copy of that file (differs|does not differ) from main's$/, (ctx, differs) => {
    const wantsDiff = differs === 'differs';
    if (ctx.reachability === 'already in') {
      // main never advances past init - its "latest commit touching the
      // path" is the shared init commit, trivially an ancestor of the
      // worktree's own HEAD (which descends from it).
      if (wantsDiff) {
        writeFile(ctx.worktree, REL_PATH, 'worktree-ahead-content');
        gitC(ctx.worktree, 'add', '-A');
        gitC(ctx.worktree, 'commit', '-q', '-m', 'cleaner: amend reference doc (ahead of main)');
      }
      // does-not-differ: leave the worktree's copy as the shared 'v1'.
    } else {
      // not reachable in: main advances with a commit the worktree never merges.
      if (wantsDiff) {
        writeFile(ctx.root, REL_PATH, 'main-new-content');
        gitC(ctx.root, 'add', '-A');
        gitC(ctx.root, 'commit', '-q', '-m', 'main: amend reference doc');
        // worktree keeps 'v1' - genuinely behind.
      } else {
        // Construct a real unreachable-but-content-identical case: main
        // changes the file away and back (two commits, neither reachable
        // from the worktree), landing on the SAME content the worktree
        // already has ('v1').
        writeFile(ctx.root, REL_PATH, 'main-temporary-content');
        gitC(ctx.root, 'add', '-A');
        gitC(ctx.root, 'commit', '-q', '-m', 'main: temporary amendment');
        writeFile(ctx.root, REL_PATH, 'v1');
        gitC(ctx.root, 'add', '-A');
        gitC(ctx.root, 'commit', '-q', '-m', 'main: revert back to v1');
      }
    }
  });

  scoped(/^the role runs its pre-turn freshness guard$/, (ctx) => {
    ctx.result = runGuard(ctx.worktree);
  });

  // No cleanup here: scenario 03/04's "Then the turn is refused" is
  // followed by two more "And" steps that still need ctx.root. Cleanup
  // happens in each scenario's own true terminal step below; a fixture
  // left behind by THIS step alone (the Outline scenario, whose only Then
  // clause is this one) is swept by prefix at the next scenario's setup
  // (BL-971).
  scoped(/^the turn is (refused|allowed)$/, (ctx, outcome) => {
    const stale = ctx.result.out.includes('STALE_REFERENCE_ELABORATION');
    if (outcome === 'refused') {
      if (!(stale && ctx.result.status === 2)) {
        throw new Error(`expected the freshness guard to refuse (exit 2, STALE marker), got status ${ctx.result.status}:\n${ctx.result.out}`);
      }
    } else {
      if (stale || ctx.result.status === 2) {
        throw new Error(`expected the freshness guard to allow the turn (no STALE marker), got status ${ctx.result.status}:\n${ctx.result.out}`);
      }
    }
  });

  scoped(/^a ticket that skips this role has landed reference-file changes on another branch$/, (ctx) => {
    // A sibling branch (as if a fast-tracked ticket landed there), never
    // touching main.
    gitC(ctx.root, 'branch', 'sibling', 'main');
    execFileSync('git', ['-C', ctx.root, 'worktree', 'add', '-q', '--detach', path.join(ctx.root, '.worktrees', 'sibling-scratch'), 'sibling']);
    writeFile(path.join(ctx.root, '.worktrees', 'sibling-scratch'), REL_PATH, 'fast-tracked-amendment');
    gitC(path.join(ctx.root, '.worktrees', 'sibling-scratch'), 'add', '-A');
    gitC(path.join(ctx.root, '.worktrees', 'sibling-scratch'), 'commit', '-q', '-m', 'sibling: fast-tracked reference amendment');
    ctx.siblingBranch = 'sibling';
  });

  scoped(/^this worktree has merged that branch but main has not yet received it$/, (ctx) => {
    gitC(ctx.worktree, 'merge', '--no-ff', '-q', ctx.siblingBranch, '-m', 'cleaner: merge sibling fast-tracked branch');
    ctx.beforeContent = fs.readFileSync(path.join(ctx.worktree, REL_PATH), 'utf8');
  });

  scoped(/^the worktree's newer copy of the reference files is left untouched$/, (ctx) => {
    const after = fs.readFileSync(path.join(ctx.worktree, REL_PATH), 'utf8');
    if (after !== ctx.beforeContent) {
      throw new Error(`expected the worktree's own newer content to survive untouched; before=[${ctx.beforeContent}] after=[${after}]`);
    }
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });

  scoped(/^main carries a reference-file amendment this worktree has never merged$/, (ctx) => {
    writeFile(ctx.root, REL_PATH, 'main-new-content');
    gitC(ctx.root, 'add', '-A');
    gitC(ctx.root, 'commit', '-q', '-m', 'main: amend reference doc');
  });

  scoped(/^the refusal names every file the worktree is missing$/, (ctx) => {
    if (!ctx.result.out.includes(REL_PATH)) {
      throw new Error(`expected the refusal to name ${REL_PATH}, got:\n${ctx.result.out}`);
    }
  });

  scoped(/^the refusal names a remedy that resolves the refusal when performed$/, (ctx) => {
    try {
      if (!/merge main/i.test(ctx.result.out)) {
        throw new Error(`expected the refusal to name a merge-main remedy, got:\n${ctx.result.out}`);
      }
      // Perform the named remedy for real and confirm it actually clears -
      // invariant 2, "every refusal names a remedy the refused role can
      // actually perform to clear it."
      gitC(ctx.worktree, 'merge', '--no-ff', '-q', 'main', '-m', 'cleaner: merge main per the guard\'s remedy');
      const after = runGuard(ctx.worktree);
      if (after.out.includes('STALE_REFERENCE_ELABORATION') || after.status === 2) {
        throw new Error(`expected the named remedy to clear the refusal, still refused:\n${after.out}`);
      }
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
