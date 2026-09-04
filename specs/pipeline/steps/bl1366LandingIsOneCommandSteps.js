'use strict';

// BL-1366: landing an approved commit is one command.
//
// Drives the REAL `land_main_publish.sh --land` against real repositories with
// real bare origins, through this ticket's own e2e. This is the slice that
// PUSHES, so every push in that suite goes to a bare repo under its own temp
// root, and the suite asserts at the end that the live repository's origin and
// main were never touched (BL-1390's two incidents).

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'Landing an approved commit is one command';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1366_land_is_one_command.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  landed: 'the approved commit reached origin/main',
  'no-force': 'the push used no force',
  'lock-gone': 'the land lock directory is gone afterwards',
  'clean-zero': 'a clean land exits 0',
  'rematch-once': 'a rejected push triggers exactly one rematch onto the current tip',
  'only-one': 'and only one - never a second rematch',
  'kept-theirs': 'the other landing is still on origin/main - nothing was overwritten',
  'escalate-untouched': 'an escalation leaves origin/main byte-identical',
  'escalate-reported': 'and the escalation is reported',
  'escalate-lock': 'and the lock is not left held by an escalation',
  'escalate-nonzero': 'and it exits non-zero',
  'lock-deadline': 'a held lock is waited on to a deadline, then given up',
  'lock-bounded': 'never an unbounded spin',
  'lock-no-push': 'and nothing was pushed while another land held the lock',
  'lock-untouched': 'and somebody else\'s lock is left exactly as it was',
  'killed-no-lock': 'a land killed mid-sequence leaves no lock behind (trap on every exit path)',
  'next-succeeds': 'and a subsequent land succeeds',
  'issue-closed': 'a GH-seeded ticket has its issue closed on a successful land',
  'no-issue-call': 'a ticket with no issue ref attempts no issue call at all',
  'live-untouched': "the live repository's origin URL is byte-identical after the suite",
  'no-fixture-remote': 'no live remote points into the fixture directory',
};

// The Scenario Outline's <ending> column. Every ending must release the lock,
// and each row names the case in the suite that proves it.
const ENDINGS = {
  'a successful push': 'lock-gone',
  'a rejected push': 'lock-gone',
  'an escalation': 'escalate-lock',
  'an unexpected error': 'killed-no-lock',
};

// Module scope: the runtime gives each scenario its own ctx, so a per-ctx memo
// would re-run this whole suite once per scenario (BL-1390's storm multiplier).
let suiteRun = null;

function runE2e(ctx) {
  if (suiteRun) {
    ctx.bl1366 = { ...(ctx.bl1366 || {}), out: suiteRun.out, status: suiteRun.status };
    return suiteRun.out;
  }
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 1800000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  suiteRun = { out, status: res.status };
  ctx.bl1366 = { ...(ctx.bl1366 || {}), out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`the BL-1366 land e2e failed (${res.status}):\n${out}`);
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
  scoped(/^QA has approved a commit for a ticket$/, (ctx) => {
    ctx.bl1366 = ctx.bl1366 || {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the entanglement check reports the commit clean$/, (ctx) => {
    ctx.bl1366.case = 'clean';
  });

  scoped(/^origin has not moved since the check$/, (ctx) => {
    ctx.bl1366.race = 'none';
  });

  scoped(/^origin has moved since the check$/, (ctx) => {
    ctx.bl1366.race = 'once';
  });

  scoped(/^origin moves again after the first rematch$/, (ctx) => {
    ctx.bl1366.race = 'twice';
  });

  scoped(/^the entanglement check escalates$/, (ctx) => {
    ctx.bl1366.case = 'escalate';
  });

  scoped(/^the land ends in (.+)$/, (ctx, ending) => {
    const claim = ENDINGS[ending];
    assert.ok(claim, `unknown <ending> example: ${ending}`);
    ctx.bl1366.endingClaim = claim;
  });

  scoped(/^the ticket was seeded from a GitHub issue$/, (ctx) => {
    ctx.bl1366.case = 'gh';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^QA lands the approved commit$/, (ctx) => {
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the commit is pushed to main without force$/, (ctx) => {
    requirePassed(ctx, 'no-force');
    requirePassed(ctx, ctx.bl1366.race === 'once' ? 'kept-theirs' : 'landed');
  });

  scoped(/^the land lock is released$/, (ctx) => {
    // Which ending is being proved was fixed by the Given (the outline) or by
    // the scenario's own case; the default is the clean land's released lock.
    requirePassed(ctx, ctx.bl1366.endingClaim
      || (ctx.bl1366.case === 'escalate' ? 'escalate-lock' : 'lock-gone'));
  });

  scoped(/^the commit is rematched onto the current origin tip once$/, (ctx) => {
    requirePassed(ctx, 'rematch-once');
    requirePassed(ctx, 'only-one');
  });

  scoped(/^the land waits on the lock$/, (ctx) => {
    requirePassed(ctx, 'lock-deadline');
    requirePassed(ctx, 'lock-no-push');
  });

  scoped(/^the commit is rematched no more than once$/, (ctx) => {
    requirePassed(ctx, 'only-one');
  });

  scoped(/^the land stops and reports the escalation$/, (ctx) => {
    requirePassed(ctx, 'escalate-reported');
    requirePassed(ctx, 'escalate-nonzero');
  });

  scoped(/^main is unchanged$/, (ctx) => {
    requirePassed(ctx, 'escalate-untouched');
  });

  scoped(/^the GitHub issue is closed$/, (ctx) => {
    requirePassed(ctx, 'issue-closed');
    // The other half of the same claim: a ticket with no issue ref must
    // attempt no issue call at all.
    requirePassed(ctx, 'no-issue-call');
  });
}

module.exports = { registerSteps };
