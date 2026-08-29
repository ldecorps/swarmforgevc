'use strict';

// BL-1266: the reference-freshness pre-turn guard (BL-640, BL-1237,
// swarmforge/scripts/ready_for_next.bb + reference_freshness_lib.bb)
// selected ONE ref (freshest-main-ref, by whole-repo ahead-count) and
// judged every reference/ path against only that ref - a bad pick (the
// higher-counting ref can still be BEHIND on any one path) was inherited,
// not caught. The verdict must be computed per path, against every ref
// that carries the reference dir. Drives the REAL ready_for_next.bb
// against real git fixtures - never a reimplementation of the per-ref
// content/ancestry comparison.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'ready_for_next.bb');
const REL_PATH = 'swarmforge/constitution/articles/reference/engineering-detailed.prompt';

const FEATURE_NAME = 'The reference-freshness guard asks about every ref, per path';
const FIXTURE_PREFIX = 'bl1266-refselect-';

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

function readFile(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// A repo with an origin remote, local main and the worktree all starting
// byte-identical - the shared baseline every scenario in this feature
// deltas from.
function mkFixtureRoot() {
  sweepStaleFixtures();
  const origin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${FIXTURE_PREFIX}origin-`)));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);

  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), '');
  writeFile(root, REL_PATH, 'v1');
  git(root, 'init', '-q', '-b', 'main');
  gitC(root, 'add', '-A');
  gitC(root, 'commit', '-q', '-m', 'init');
  git(root, 'remote', 'add', 'origin', origin);
  gitC(root, 'push', '-q', 'origin', 'main');

  gitC(root, 'branch', 'coder', 'main');
  git(root, 'worktree', 'add', '-q', path.join(root, '.worktrees', 'coder'), 'coder');
  const worktree = path.join(root, '.worktrees', 'coder');
  fs.mkdirSync(path.join(worktree, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(worktree, '.swarmforge', 'roles.tsv'), '');

  return { root, origin, worktree };
}

// Amend the file on origin's main WITHOUT touching root's local main -
// the QA push-to-origin path (BL-640 D2): a separate clone commits and
// pushes straight to origin, then root fetches to refresh its
// remote-tracking ref.
function amendOriginOnly(ctx, content, message) {
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), `${FIXTURE_PREFIX}qa-clone-`));
  execFileSync('git', ['clone', '-q', ctx.origin, clone]);
  writeFile(clone, REL_PATH, content);
  gitC(clone, 'add', '-A');
  gitC(clone, 'commit', '-q', '-m', message);
  gitC(clone, 'push', '-q', 'origin', 'main');
  fs.rmSync(clone, { recursive: true, force: true });
  gitC(ctx.root, 'fetch', '-q', 'origin');
}

// Extra unrelated commits pushed straight to origin, never touching local
// main - used to make origin/main the higher whole-repo ahead-count ref
// without it carrying the reference-file amendment under test.
function addUnrelatedOriginCommits(ctx, n) {
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), `${FIXTURE_PREFIX}filler-clone-`));
  execFileSync('git', ['clone', '-q', ctx.origin, clone]);
  for (let i = 0; i < n; i += 1) {
    writeFile(clone, `filler-${i}.txt`, `filler ${i}`);
    gitC(clone, 'add', '-A');
    gitC(clone, 'commit', '-q', '-m', `filler commit ${i}`);
  }
  gitC(clone, 'push', '-q', 'origin', 'main');
  fs.rmSync(clone, { recursive: true, force: true });
}

// Extra unrelated commits on local main only, never pushed - used to make
// local main the higher whole-repo ahead-count ref without it carrying
// the reference-file amendment under test.
function addUnrelatedLocalCommits(ctx, n) {
  for (let i = 0; i < n; i += 1) {
    writeFile(ctx.root, `filler-${i}.txt`, `filler ${i}`);
    gitC(ctx.root, 'add', '-A');
    gitC(ctx.root, 'commit', '-q', '-m', `local filler commit ${i}`);
  }
}

function runGuard(worktreeRoot) {
  const res = spawnSync('bb', [GUARD_SCRIPT], { cwd: worktreeRoot, encoding: 'utf8', timeout: 30_000 });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function cleanup(ctx) {
  if (ctx.root) fs.rmSync(ctx.root, { recursive: true, force: true });
  if (ctx.origin) fs.rmSync(ctx.origin, { recursive: true, force: true });
}

const REF_LABEL_TO_GIT_REF = { 'local main': 'main', 'origin/main': 'origin/main' };

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  scoped(/^a role worktree, local main and origin\/main all carry the reference elaboration files$/, (ctx) => {
    const fixture = mkFixtureRoot();
    ctx.root = fixture.root;
    ctx.origin = fixture.origin;
    ctx.worktree = fixture.worktree;
  });

  scoped(/^(local main|origin\/main) carries an amendment to a reference file the worktree has never merged$/, (ctx, refLabel) => {
    ctx.amendedRefLabel = refLabel;
    ctx.amendedGitRef = REF_LABEL_TO_GIT_REF[refLabel];
    if (refLabel === 'local main') {
      writeFile(ctx.root, REL_PATH, 'main-amendment-content');
      gitC(ctx.root, 'add', '-A');
      gitC(ctx.root, 'commit', '-q', '-m', 'main: amend reference doc');
    } else {
      amendOriginOnly(ctx, 'origin-amendment-content', 'origin: amend reference doc (QA push-to-origin path)');
    }
  });

  scoped(/^the whole-repo ahead-count makes the other ref the higher-counting one$/, (ctx) => {
    // The defect this ticket removes: freshest-main-ref would have picked
    // the ref named here, which does NOT carry the amendment, and asked
    // every path about it instead - the fail-open BL-1266 exists to close.
    if (ctx.amendedRefLabel === 'local main') {
      addUnrelatedOriginCommits(ctx, 3);
    } else {
      addUnrelatedLocalCommits(ctx, 3);
    }
  });

  scoped(/^the role runs its pre-turn freshness guard$/, (ctx) => {
    ctx.result = runGuard(ctx.worktree);
  });

  scoped(/^the turn is (refused|allowed)$/, (ctx, outcome) => {
    const stale = ctx.result.out.includes('STALE_REFERENCE_ELABORATION');
    if (outcome === 'refused') {
      if (!(stale && ctx.result.status === 2)) {
        throw new Error(`expected the freshness guard to refuse (exit 2, STALE marker), got status ${ctx.result.status}:\n${ctx.result.out}`);
      }
    } else if (stale || ctx.result.status === 2) {
      throw new Error(`expected the freshness guard to allow the turn (no STALE marker), got status ${ctx.result.status}:\n${ctx.result.out}`);
    }
  });

  scoped(/^the refusal names that file$/, (ctx) => {
    if (!ctx.result.out.includes(REL_PATH)) {
      throw new Error(`expected the refusal to name ${REL_PATH}, got:\n${ctx.result.out}`);
    }
  });

  scoped(/^the refusal names (local main|origin\/main) as the ref whose amendment is missing$/, (ctx, refLabel) => {
    const gitRef = REF_LABEL_TO_GIT_REF[refLabel];
    const marker = `(missing ${gitRef}'s amendment)`;
    if (!ctx.result.out.includes(marker)) {
      throw new Error(`expected the refusal to name ${gitRef} as the specific ref missing its amendment (looked for "${marker}"), got:\n${ctx.result.out}`);
    }
  });

  scoped(/^performing the remedy the refusal names clears the refusal on the next run$/, (ctx) => {
    try {
      if (!/merge (main|origin\/main)/i.test(ctx.result.out)) {
        throw new Error(`expected the refusal to name a merge remedy, got:\n${ctx.result.out}`);
      }
      gitC(ctx.worktree, 'merge', '--no-ff', '-q', ctx.amendedGitRef, '-m', `coder: merge ${ctx.amendedGitRef} per the guard's remedy`);
      const after = runGuard(ctx.worktree);
      if (after.out.includes('STALE_REFERENCE_ELABORATION') || after.status === 2) {
        throw new Error(`expected the named remedy to clear the refusal, still refused:\n${after.out}`);
      }
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^local main and origin\/main disagree on a reference file$/, (ctx) => {
    writeFile(ctx.root, REL_PATH, 'main-side-content');
    gitC(ctx.root, 'add', '-A');
    gitC(ctx.root, 'commit', '-q', '-m', 'main: amend reference doc (main side)');
    amendOriginOnly(ctx, 'origin-side-content', 'origin: amend reference doc (origin side, diverging from main)');
  });

  scoped(/^the worktree's history contains both refs' most recent commits touching that file$/, (ctx) => {
    gitC(ctx.worktree, 'merge', '--no-ff', '-q', 'main', '-m', 'coder: merge main');
    try {
      gitC(ctx.worktree, 'merge', '--no-ff', '-q', 'origin/main', '-m', 'coder: merge origin/main');
    } catch {
      // Expected: main and origin/main touched the same file differently
      // from their shared ancestor. Resolve with the worktree's own
      // content - what matters for this scenario is that BOTH refs'
      // touching commits are now ancestors of the worktree's HEAD, not
      // which text wins the conflict.
      writeFile(ctx.worktree, REL_PATH, 'worktree-resolved-content');
      gitC(ctx.worktree, 'add', '-A');
      gitC(ctx.worktree, 'commit', '-q', '-m', 'coder: resolve reference doc merge conflict');
    }
    ctx.beforeContent = readFile(ctx.worktree, REL_PATH);
  });

  scoped(/^the worktree's copy of that file is left untouched$/, (ctx) => {
    const after = readFile(ctx.worktree, REL_PATH);
    if (after !== ctx.beforeContent) {
      throw new Error(`expected the worktree's own resolved content to survive untouched; before=[${ctx.beforeContent}] after=[${after}]`);
    }
    cleanup(ctx);
  });

  scoped(/^the repository has no origin\/main ref$/, (ctx) => {
    gitC(ctx.root, 'remote', 'remove', 'origin');
    ctx.noOriginCleanup = true;
  });

  scoped(/^the worktree's copy of every reference file matches local main$/, (ctx) => {
    // Fixture already guarantees this - the worktree and local main both
    // still carry the shared 'v1' baseline content.
    const worktreeContent = readFile(ctx.worktree, REL_PATH);
    const mainContent = git(ctx.root, 'show', `main:${REL_PATH}`);
    if (worktreeContent !== mainContent) {
      throw new Error('fixture sanity: worktree and local main must agree before this scenario runs');
    }
  });
}

module.exports = { registerSteps };
