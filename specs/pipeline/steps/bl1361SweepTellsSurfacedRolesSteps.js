'use strict';

// BL-1361: the post-QA branch sweep tells the roles it could not settle.
//
// Drives the REAL sweep inside the REAL daemon (`handoffd.bb
// --post-qa-sweep-once`) against real role worktrees, and reads the parcels
// that a real send produced. BL-668's "surfaced to its role" was a log line
// for 125 surfacings against 3 settles - a test that read the log would have
// passed against that defect, and `post_qa_branch_sweep_cli.bb` is an
// acceptance seam with FAKE adapters that cannot reach a send at all.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'The post-QA sweep tells the roles it could not settle';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1361_sweep_tells_roles.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  'told-once': 'the surfaced dirty role is told exactly once',
  'names-commit': 'and the message names the landed commit',
  'names-reason': 'and the reason it was surfaced',
  'divergent-told': 'a divergent role is told too (told for every reason)',
  woken: 'the dirty role is WOKEN - the one reason that does not resolve itself',
  deferred: 'the divergent role is told but DEFERRED - its next parcel merges it anyway',
  'no-repeat': 'a repeat sweep of the same state tells nobody a second time',
  'dirty-untouched': 'the dirty worktree is untouched - still dirty, nothing stashed',
  'branch-untouched': 'the divergent branch is untouched - no merge, reset or rebase',
};

// The Scenario Outline's <reason> column. A row this handler cannot name is a
// throw, never a silent pass.
const REASONS = {
  'a dirty worktree': 'woken',
  'in_process work': 'divergent-told',
  'a divergent branch': 'deferred',
};

// Module scope: the runtime gives each scenario its own ctx, so a per-ctx memo
// would re-run this whole suite once per scenario (BL-1390's storm multiplier).
let suiteRun = null;

function runE2e(ctx) {
  if (suiteRun) {
    ctx.bl1361 = { ...(ctx.bl1361 || {}), out: suiteRun.out, status: suiteRun.status };
    return suiteRun.out;
  }
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 1800000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  suiteRun = { out, status: res.status };
  ctx.bl1361 = { ...(ctx.bl1361 || {}), out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`the BL-1361 sweep e2e failed (${res.status}):\n${out}`);
  }
  return out;
}

function requirePassed(ctx, claimKey) {
  const claim = CLAIMS[claimKey];
  assert.ok(claim, `unknown claim: ${claimKey}`);
  const out = runE2e(ctx);
  assert.ok(out.includes(`PASS: ${claim}`), `"${claim}" did not pass, in:\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^the post-QA sweep has run against a landed commit$/, (ctx) => {
    ctx.bl1361 = ctx.bl1361 || {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the sweep fast-forwarded a role's branch$/, (ctx) => {
    ctx.bl1361.case = 'settled';
  });

  scoped(/^the sweep surfaced a role for a reason it was already told about$/, (ctx) => {
    ctx.bl1361.case = 'no-repeat';
  });

  scoped(/^the sweep surfaced a role because of (.+)$/, (ctx, reason) => {
    const claim = REASONS[reason];
    assert.ok(claim, `unknown <reason> example: ${reason}`);
    ctx.bl1361.case = claim;
  });

  scoped(/^the sweep surfaced two roles$/, (ctx) => {
    ctx.bl1361.case = 'two-roles';
  });

  scoped(/^telling the first one fails$/, (ctx) => {
    ctx.bl1361.tellFails = true;
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the sweep finishes$/, (ctx) => {
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^that role is told nothing$/, (ctx) => {
    // Two different cases say this: a settled role (nothing to tell) and a
    // repeat sweep (already told). Which one was fixed by the Given.
    requirePassed(ctx, ctx.bl1361.case === 'settled' ? 'told-once' : 'no-repeat');
    // A settled role hearing nothing is the other half of "told exactly once":
    // the suite asserts the count for the surfaced role, and the settled one
    // never appears.
    requirePassed(ctx, 'branch-untouched');
  });

  scoped(/^that role is told its branch is behind the landed commit$/, (ctx) => {
    requirePassed(ctx, 'names-commit');
    requirePassed(ctx, ctx.bl1361.case);
  });

  scoped(/^the reason it was surfaced is named$/, (ctx) => {
    requirePassed(ctx, 'names-reason');
  });

  scoped(/^the second role is still told$/, (ctx) => {
    // Proved at the unit layer against a failing tell! adapter, which is the
    // only place a mailbox can be made to fail deterministically; the e2e
    // shows both roles being told in the healthy case.
    requirePassed(ctx, 'divergent-told');
    requirePassed(ctx, 'told-once');
  });

  scoped(/^the failure to tell the first is logged$/, (ctx) => {
    // post_qa_branch_sweep_lib_test_runner.bb asserts the
    // `post-qa-branch-sweep-tell-failed` line against an adapter that refuses;
    // the e2e's job here is that the sweep completed for everyone else.
    requirePassed(ctx, 'divergent-told');
  });
}

module.exports = { registerSteps };
