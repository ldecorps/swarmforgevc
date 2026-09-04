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
  // BL-1390 amendment, 2026-09-04: the suite proves it left the live
  // repository alone, after this fixture rewrote the shared origin URL.
  'live-origin': "the live repository's origin URL is byte-identical after the suite",
  'live-worktrees': "the live repository's worktree list is byte-identical after the suite",
  'all-guarded': 'every mutating git command in the suite goes through the fixture guard',
  // BL-1390 second amendment, 2026-09-04: 1156 concurrent copies of this
  // suite exhausted the host because each began with a blind prefix sweep.
  'one-at-a-time': 'at most one instance of the suite runs at a time',
  'names-holder': "a second invocation exits cleanly naming the first's pid",
  'fixture-intact': "the first's fixture directory is intact throughout",
  'invoker-logged': 'each suite log names the process chain that invoked it',
};

// Module scope, deliberately: the runtime gives each scenario its own ctx, so
// a per-ctx memo re-ran this whole suite once per scenario - 6-9 invocations
// per feature, several roles running acceptance at once. That multiplier is
// half of how 1156 concurrent copies of a sibling suite came to exist
// (BL-1390's second incident). One run per process, shared by every scenario.
let suiteRun = null;

function runE2e(ctx) {
  if (suiteRun) {
    ctx.bl1390 = { ...(ctx.bl1390 || {}), out: suiteRun.out, status: suiteRun.status };
    return suiteRun.out;
  }
  if (ctx.bl1390?.out) return ctx.bl1390.out;
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 900000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1390 = { ...(ctx.bl1390 || {}), out, status: res.status };
  suiteRun = { out, status: res.status };
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

  // ── scenario 06 (amendment): the suite never touches the live repository ──
  scoped(/^the live repository's origin URL and worktree list are recorded$/, (ctx) => {
    ctx.bl1390 = ctx.bl1390 || {};
  });

  scoped(/^the hook's test suite runs to completion$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the live repository's origin URL is byte-identical$/, (ctx) => {
    requirePassed(ctx, 'live-origin');
  });

  scoped(/^the live repository's worktree list is byte-identical$/, (ctx) => {
    requirePassed(ctx, 'live-worktrees');
  });

  scoped(/^every mutating git command in the suite ran against a root under the fixture's temporary directory$/, (ctx) => {
    requirePassed(ctx, 'all-guarded');
  });

  // ── scenario 07 (second amendment): the suite is safe to invoke twice ────
  scoped(/^the hook's test suite is running$/, (ctx) => {
    ctx.bl1390 = ctx.bl1390 || {};
  });

  scoped(/^a second invocation of the suite starts$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the second waits or exits cleanly naming the first's pid$/, (ctx) => {
    requirePassed(ctx, 'names-holder');
  });

  scoped(/^the first's fixture directory is intact throughout$/, (ctx) => {
    requirePassed(ctx, 'fixture-intact');
  });

  scoped(/^at most one instance of the suite ran at a time$/, (ctx) => {
    requirePassed(ctx, 'one-at-a-time');
  });

  scoped(/^each suite log names the process chain that invoked it$/, (ctx) => {
    requirePassed(ctx, 'invoker-logged');
  });
}

module.exports = { registerSteps };
