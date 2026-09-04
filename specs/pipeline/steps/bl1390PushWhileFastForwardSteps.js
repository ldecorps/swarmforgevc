'use strict';

// BL-1390: a commit on the shared main checkout is pushed while it still
// fast-forwards.
//
// Drives the REAL hook - swarmforge/git-hooks/post-commit, the file git itself
// runs through core.hooksPath - over REAL repositories with a REAL bare
// origin, through this ticket's own e2e script. A scenario that called the bb
// runner directly would report green for a hook that git never invokes, and
// the whole defect this ticket fixes is about what happens at commit time.
//
// One run serves every scenario; verdicts are read by the script's PASS lines.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE =
  'BL-1390 A commit on the shared main checkout is pushed while it still fast-forwards';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1390_post_commit_push.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  pushed: 'a commit made while origin has not moved is pushed immediately (ahead/behind 0/0)',
  'origin-carries': 'origin/main carries the commit the hook pushed',
  'push-logged': 'the push is logged by the hook',
  'diverged-no-push': 'a commit made after origin moved pushes nothing',
  'diverged-logged': 'the hook logs diverged',
  'commit-intact': 'the commit is intact on local main',
  'worktree-no-push': 'a commit on a linked role worktree pushes nothing',
  'worktree-silent': 'nothing is logged by the hook for a role worktree commit (no fetch, no push)',
  'unreachable-commit': 'the commit completes and is intact with origin unreachable',
  'unreachable-logged': 'the hook logs that the push was not attempted',
  'two-commits': 'two commits in quick succession both reach origin in order',
  'no-force': 'no push used force',
  'one-adapter': 'the hook contains no git push of its own (BL-1198)',
};

function runE2e(ctx) {
  if (ctx.bl1390?.out) return ctx.bl1390.out;
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 900000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1390 = { ...(ctx.bl1390 || {}), out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`the BL-1390 post-commit e2e failed (${res.status}):\n${out}`);
  }
  return out;
}

function requirePassed(ctx, claimKey) {
  const claim = CLAIMS[claimKey];
  assert.ok(claim, `unknown claim: ${claimKey}`);
  const out = runE2e(ctx);
  // Present AND passing: asserting only "no FAIL line" would go green for a
  // check that never ran.
  assert.ok(out.includes(`PASS: ${claim}`), `"${claim}" did not pass, in:\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a master checkout on main with a reachable origin$/, (ctx) => {
    ctx.bl1390 = ctx.bl1390 || {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^origin\/main equals local main$/, (ctx) => {
    ctx.bl1390.case = 'equal';
  });

  scoped(/^origin\/main has advanced by one commit local main lacks$/, (ctx) => {
    ctx.bl1390.case = 'diverged';
  });

  scoped(/^a linked worktree on a role branch$/, (ctx) => {
    ctx.bl1390.case = 'worktree';
  });

  scoped(/^origin is unreachable$/, (ctx) => {
    ctx.bl1390.case = 'unreachable';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^a commit is made on main$/, (ctx) => {
    assert.ok(ctx.bl1390.case, 'the scenario set no case before committing');
    runE2e(ctx);
  });

  scoped(/^a commit is made on that role branch$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^two commits are made on main within a second$/, (ctx) => {
    ctx.bl1390.case = 'two';
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^local main and origin\/main are equal after the hook$/, (ctx) => {
    requirePassed(ctx, 'pushed');
    requirePassed(ctx, 'origin-carries');
  });

  scoped(/^the push went through the push sweep adapter$/, (ctx) => {
    // Two halves of one claim: the hook shells no push of its own, and the
    // push that happened is the one it logged going through that adapter.
    requirePassed(ctx, 'one-adapter');
    requirePassed(ctx, 'push-logged');
  });

  scoped(/^nothing is pushed$/, (ctx) => {
    requirePassed(ctx, ctx.bl1390.case === 'unreachable' ? 'unreachable-logged' : 'diverged-no-push');
  });

  scoped(/^the hook logs diverged$/, (ctx) => {
    requirePassed(ctx, 'diverged-logged');
  });

  scoped(/^the commit is intact on local main$/, (ctx) => {
    requirePassed(ctx, 'commit-intact');
  });

  scoped(/^nothing is fetched or pushed$/, (ctx) => {
    requirePassed(ctx, 'worktree-no-push');
  });

  scoped(/^nothing is logged by the hook$/, (ctx) => {
    requirePassed(ctx, 'worktree-silent');
  });

  scoped(/^the commit completes within the hook's bound$/, (ctx) => {
    requirePassed(ctx, 'unreachable-commit');
  });

  scoped(/^the hook logs that the push was not attempted$/, (ctx) => {
    requirePassed(ctx, 'unreachable-logged');
  });

  scoped(/^origin\/main equals local main after the second hook$/, (ctx) => {
    requirePassed(ctx, 'two-commits');
  });

  scoped(/^no push used force$/, (ctx) => {
    requirePassed(ctx, 'no-force');
  });
}

module.exports = { registerSteps };
