'use strict';

// BL-632: step handlers for "a commit-time hook refuses pipeline code on
// main from any role but QA". Drives the REAL
// swarmforge/scripts/check_pipeline_code_on_main.sh through REAL git hooks
// (installed via core.hooksPath, same fixture pattern as
// swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh and
// extension/test/bl632CommitTimeGuardInvariants.property.test.js) as real
// `git commit` / `git merge --no-ff` subprocesses - never a parallel
// reimplementation of the guard's decision logic.
//
// All registrations are defineScoped pinned to this feature's exact title
// (BL-425): several step texts here ("a commit is attempted", "the commit
// succeeds") are generic enough that an unscoped registration could win
// resolution for an unrelated feature.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'a commit-time hook refuses pipeline code on main from any role but QA';

// Every Examples: column value must be load-bearing (engineering.prompt):
// an unknown (e.g. gherkin-mutator-mutated) value fails the step outright
// instead of flowing through a passthrough/no-op branch.
const KNOWN_BOOKKEEPING_PATHS = new Set(['backlog/', 'docs/', 'specs/features/', 'swarmforge/']);

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_pipeline_code_on_main.sh');
const SIZE_GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_commit_size.sh');
const TICKET_GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_ticket_deletion.sh');
const PRE_COMMIT_HOOK = path.join(REPO_ROOT, 'swarmforge', 'git-hooks', 'pre-commit');
const PRE_MERGE_COMMIT_HOOK = path.join(REPO_ROOT, 'swarmforge', 'git-hooks', 'pre-merge-commit');

// Fixture-root hygiene (BL-459's acceptance sibling): every root the
// Background creates is registered for removal at process exit, so neither
// a passing nor a throwing scenario leaves a repo behind.
const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function escapeForRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mkFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl632-acceptance-'));
  fixtureRoots.push(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');

  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge', 'git-hooks'), { recursive: true });
  for (const [src, rel] of [
    [GUARD_SCRIPT, 'swarmforge/scripts/check_pipeline_code_on_main.sh'],
    [SIZE_GUARD, 'swarmforge/scripts/check_commit_size.sh'],
    [TICKET_GUARD, 'swarmforge/scripts/check_ticket_deletion.sh'],
    [PRE_COMMIT_HOOK, 'swarmforge/git-hooks/pre-commit'],
    [PRE_MERGE_COMMIT_HOOK, 'swarmforge/git-hooks/pre-merge-commit'],
  ]) {
    const dst = path.join(root, rel);
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o755);
  }
  git(root, 'add', '-A');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed hooks');
  git(root, 'config', 'core.hooksPath', 'swarmforge/git-hooks');
  return root;
}

function commitEnv(role) {
  const env = { ...process.env };
  delete env.SWARMFORGE_ROLE;
  if (role !== undefined) {
    env.SWARMFORGE_ROLE = role;
  }
  return env;
}

function stagePath(ctx, relPath, content) {
  const full = path.join(ctx.root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content || 'v1\n');
  git(ctx.root, 'add', relPath);
}

// A REAL 51 MB file, one over the 50 MB default the pre-commit hook actually
// wires (`check_commit_size.sh 50`) - exercises the size guard as installed,
// not a lowered-threshold stand-in.
function stageOversizedFile(ctx, relPath) {
  const full = path.join(ctx.root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  execFileSync('dd', ['if=/dev/zero', `of=${full}`, 'bs=1048576', 'count=51'], { stdio: 'ignore' });
  git(ctx.root, 'add', relPath);
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.defineScoped(
    new RegExp(`^${escapeForRegExp('the QA-exclusive path set is extension/src/, extension/test/, and specs/pipeline/steps/')}$`),
    (ctx) => {
      ctx.root = mkFixtureRepo();
      const listOut = execFileSync('bash', [GUARD_SCRIPT, '--list-paths'], { encoding: 'utf8' })
        .trim()
        .split('\n');
      assert.deepEqual(
        listOut,
        ['extension/src/', 'extension/test/', 'specs/pipeline/steps/'],
        `expected the guard's --list-paths to publish the same three paths the Background states, got: ${listOut}`
      );
    },
    FEATURE
  );

  // ── shared Givens ───────────────────────────────────────────────────────
  registry.defineScoped(/^the current branch is (\S+)$/, (ctx, branch) => {
    if (branch !== 'main') {
      git(ctx.root, 'checkout', '-q', '-b', branch);
    }
    ctx.branch = branch;
  }, FEATURE);

  registry.defineScoped(/^SWARMFORGE_ROLE is not QA$/, (ctx) => {
    ctx.role = 'coder';
  }, FEATURE);

  registry.defineScoped(/^SWARMFORGE_ROLE is QA$/, (ctx) => {
    ctx.role = 'QA';
  }, FEATURE);

  registry.defineScoped(/^SWARMFORGE_ROLE is not set$/, (ctx) => {
    ctx.role = undefined;
  }, FEATURE);

  registry.defineScoped(/^the staged change touches extension\/src\/$/, (ctx) => {
    ctx.stagedPath = 'extension/src/thing.ts';
    stagePath(ctx, ctx.stagedPath);
  }, FEATURE);

  registry.defineScoped(/^the staged change touches specs\/pipeline\/steps\/$/, (ctx) => {
    ctx.stagedPath = 'specs/pipeline/steps/thing.js';
    stagePath(ctx, ctx.stagedPath);
  }, FEATURE);

  // BL-259: the exact literal wins over the generic "only <path>" pattern
  // below because \S+ cannot span the embedded " (no size issue)" spaces -
  // registration order does not matter here, but this one is listed first
  // for readability.
  registry.defineScoped(/^the staged change touches only backlog\/ \(no size issue\)$/, (ctx) => {
    ctx.stagedPath = 'backlog/thing.txt';
    stagePath(ctx, ctx.stagedPath);
    stageOversizedFile(ctx, 'backlog/oversized.bin');
  }, FEATURE);

  registry.defineScoped(/^SWARMFORGE_ROLE is QA and the change touches extension\/src\/$/, (ctx) => {
    ctx.role = 'QA';
    ctx.stagedPath = 'extension/src/thing.ts';
    stagePath(ctx, ctx.stagedPath);
    stageOversizedFile(ctx, 'extension/src/oversized.bin');
  }, FEATURE);

  registry.defineScoped(/^the staged change touches only (\S+)$/, (ctx, bookkeepingPath) => {
    assert.ok(KNOWN_BOOKKEEPING_PATHS.has(bookkeepingPath), `unknown bookkeeping path example value: ${bookkeepingPath}`);
    ctx.stagedPath = `${bookkeepingPath}bookkeeping.txt`;
    stagePath(ctx, ctx.stagedPath);
  }, FEATURE);

  registry.defineScoped(/^the incoming branch carries changes to extension\/src\/$/, (ctx) => {
    git(ctx.root, 'checkout', '-q', '-b', 'feature-branch');
    ctx.stagedPath = 'extension/src/feature.ts';
    stagePath(ctx, ctx.stagedPath);
    git(ctx.root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'feature change');
    git(ctx.root, 'checkout', '-q', 'main');
    ctx.mergeBranch = 'feature-branch';
  }, FEATURE);

  // ── When ────────────────────────────────────────────────────────────────
  registry.defineScoped(/^a commit is attempted$/, (ctx) => {
    const result = spawnSync('git', ['commit', '-q', '-m', 'change'], {
      cwd: ctx.root,
      encoding: 'utf8',
      env: commitEnv(ctx.role),
    });
    ctx.out = result.stdout || '';
    ctx.err = result.stderr || '';
    ctx.rc = result.status ?? 1;
  }, FEATURE);

  registry.defineScoped(/^a merge --no-ff is attempted$/, (ctx) => {
    const result = spawnSync(
      'git',
      ['merge', '--no-ff', '-q', '-m', 'merge feature', ctx.mergeBranch],
      { cwd: ctx.root, encoding: 'utf8', env: commitEnv(ctx.role) }
    );
    ctx.out = result.stdout || '';
    ctx.err = result.stderr || '';
    ctx.rc = result.status ?? 1;
    if (ctx.rc !== 0) {
      spawnSync('git', ['merge', '--abort'], { cwd: ctx.root });
    }
  }, FEATURE);

  // ── Then ────────────────────────────────────────────────────────────────
  registry.defineScoped(/^the commit is refused with a non-zero exit$/, (ctx) => {
    assert.notEqual(ctx.rc, 0, 'expected the commit to be refused, got exit 0');
  }, FEATURE);

  registry.defineScoped(/^the merge commit is refused with a non-zero exit$/, (ctx) => {
    assert.notEqual(ctx.rc, 0, 'expected the merge to be refused, got exit 0');
  }, FEATURE);

  registry.defineScoped(/^the commit succeeds$/, (ctx) => {
    assert.equal(ctx.rc, 0, `expected the commit to succeed, got exit ${ctx.rc}: ${ctx.err}`);
  }, FEATURE);

  registry.defineScoped(/^the message names the offending path\(s\) and the reason$/, (ctx) => {
    const combined = `${ctx.out}${ctx.err}`;
    assert.match(
      combined,
      new RegExp(escapeForRegExp(ctx.stagedPath)),
      `expected the refusal to name ${ctx.stagedPath}, got: ${combined}`
    );
    assert.match(
      combined,
      /may only land on main via QA/i,
      `expected the refusal to state the reason, got: ${combined}`
    );
  }, FEATURE);

  // Independently invokes the STANDALONE guard script (BL-105 precedent:
  // callable and testable outside the hook) against the same staged tree,
  // so this assertion holds regardless of whichever unconditional
  // pre-commit call (size guard runs first) actually ends up short-
  // circuiting the real `git commit` attempt.
  registry.defineScoped(/^the branch guard passes it$/, (ctx) => {
    const result = spawnSync('bash', [GUARD_SCRIPT], {
      cwd: ctx.root,
      encoding: 'utf8',
      env: commitEnv(ctx.role),
    });
    assert.equal(
      result.status,
      0,
      `expected the pipeline-code guard to pass this staged change on its own, got exit ${result.status}: ${result.stderr}`
    );
  }, FEATURE);

  registry.defineScoped(/^the commit-size guard still refuses an oversized file when its own condition is met$/, (ctx) => {
    assert.notEqual(ctx.rc, 0, 'expected the real commit to still be refused overall (size guard)');
    const combined = `${ctx.out}${ctx.err}`;
    assert.match(
      combined,
      /MB commit size limit/,
      `expected the size guard's own refusal message, got: ${combined}`
    );
  }, FEATURE);

  registry.defineScoped(
    /^the refusal message states committing in your own worktree and handing off through the pipeline as the remedy$/,
    (ctx) => {
      const combined = `${ctx.out}${ctx.err}`;
      assert.match(combined, /worktree/i, `refusal message must state committing in your own worktree, got: ${combined}`);
      assert.match(combined, /hand/i, `refusal message must state handing off through the pipeline, got: ${combined}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
