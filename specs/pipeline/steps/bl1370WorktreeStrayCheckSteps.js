'use strict';

// BL-1370: a role checks its own worktree for strays.
//
// Answered by this ticket's e2e, which starts REAL processes carrying the job
// patterns in two fixture worktrees and drives the REAL CLI against them.
// Scenario 05 - the sibling worktree's process surviving a reap - is the one
// that matters: this tool kills, and a scope mistake in the killing direction
// destroys a colleague's work in progress. Nothing here is answered by reading
// the predicate's source for its own literals.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'A role checks its own worktree for strays';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1370_worktree_strays.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  clean: 'a clean worktree reports clean and the check succeeds',
  recordable: 'the clean line is recordable and names what was scanned',
  refuses: 'a stray makes the check FAIL - a refusal, not a warning',
  named: 'the stray is named with its process group',
  'sibling-unreported': "another worktree's suite is never reported as this worktree's stray",
  reaped: "reaping killed this worktree's stray",
  'group-reaped': 'and its whole process group went with it, not just the named pid',
  'sibling-alive': "the other worktree's process is STILL RUNNING after the reap",
  'recheck-clean': 'and the re-check after reaping reports clean',
  stable: 'the same state yields the same line, byte for byte',
  'pattern-shared': "the job-process pattern is byte-identical to the supervisor's",
  'scope-shared': "scope delegates to process_table_lib's shared classifier",
};

// Module scope, not per-ctx: each scenario gets its own ctx, so a per-ctx memo
// would re-run this whole suite - which starts and kills real processes - once
// per scenario (BL-1390).
let suiteRun = null;

function runE2e(ctx) {
  ctx.bl1370 = ctx.bl1370 || {};
  if (suiteRun) {
    ctx.bl1370.out = suiteRun;
    return suiteRun;
  }
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 1800000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  suiteRun = out;
  ctx.bl1370.out = out;
  if (res.status !== 0) {
    throw new Error(`the BL-1370 stray-check e2e failed (${res.status}):\n${out}`);
  }
  // The suite takes a per-prefix lock and exits 0 with SUITE_BUSY when another
  // instance holds it - correct for the suite (it must never touch a live
  // run's fixtures) but NOT a result. Reporting "the claim did not pass" for
  // it would read as a defect in the tool; this says what actually happened.
  if (/SUITE_BUSY/.test(out)) {
    throw new Error(
      `the BL-1370 e2e could not run: another instance holds its lock, so this scenario is BLOCKED, not failing.\n${out}`,
    );
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
  scoped(/^a role is verifying in its own worktree$/, (ctx) => {
    ctx.bl1370 = ctx.bl1370 || {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^no test or mutation process is running for this worktree$/, (ctx) => {
    ctx.bl1370.state = 'clean';
  });

  scoped(/^a leftover test process is running for this worktree$/, (ctx) => {
    ctx.bl1370.state = 'stray';
  });

  scoped(/^a test process is running for a different worktree$/, (ctx) => {
    ctx.bl1370.state = 'sibling';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the role checks for strays$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the role reaps its strays$/, (ctx) => {
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the check reports clean$/, (ctx) => {
    requirePassed(ctx, ctx.bl1370.state === 'sibling' ? 'sibling-unreported' : 'clean');
    // Whichever way the scenario got here, the classifier and the pattern are
    // the shared ones - the invariant that makes "clean" trustworthy.
    requirePassed(ctx, 'scope-shared');
  });

  scoped(/^the check succeeds$/, (ctx) => {
    requirePassed(ctx, 'clean');
  });

  scoped(/^the stray is named with its process group$/, (ctx) => {
    requirePassed(ctx, 'named');
  });

  scoped(/^the check fails$/, (ctx) => {
    requirePassed(ctx, 'refuses');
  });

  scoped(/^the stray's whole process group is killed$/, (ctx) => {
    requirePassed(ctx, 'reaped');
    requirePassed(ctx, 'group-reaped');
  });

  scoped(/^a later check reports clean$/, (ctx) => {
    requirePassed(ctx, 'recheck-clean');
  });

  scoped(/^that process is still running$/, (ctx) => {
    requirePassed(ctx, 'sibling-alive');
  });

  scoped(/^the check yields a recordable result naming what was scanned$/, (ctx) => {
    requirePassed(ctx, 'recordable');
    requirePassed(ctx, 'stable');
    requirePassed(ctx, 'pattern-shared');
  });
}

module.exports = { registerSteps };
