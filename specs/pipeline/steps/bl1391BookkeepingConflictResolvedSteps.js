'use strict';

// BL-1391: the reconcile resolves a conflict confined to append-only
// bookkeeping files instead of refusing.
//
// Drives the REAL daemon - `bb handoffd.bb --reconcile-sweep-once` against a
// real repository and a real local remote - through this ticket's own e2e
// script. The lib alone can classify a conflict; only the daemon performs the
// absorb, which is what the ticket's required_wiring anchor is about, and a
// scenario that called the classifier would report green for a resolver the
// daemon never reaches (BL-1235).
//
// One run serves every scenario; verdicts are read by the script's PASS lines.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1391 The reconcile resolves a bookkeeping-only conflict instead of refusing';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1391_bookkeeping_conflict.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  'no-merge-head': 'the absorb completes with no MERGE_HEAD left',
  'both-additions': 'the ticket carries BOTH additions',
  'body-names-path': 'the merge commit body names the resolved path and the strategy',
  'log-names-path': 'the daemon log carries bookkeeping-conflict naming the path',
  'scalar-refused': 'a rewritten scalar is refused - no merge commit',
  'scalar-clean': 'and nothing was left half-resolved',
  'code-refused': 'a conflict including a code path is refused by the resolver',
  'code-nothing': 'and nothing was resolved (invariant 1: all or nothing)',
  'evidence-both': 'an evidence file appended on both sides keeps both paragraphs',
  'evidence-deletion': 'an evidence file with a deleted paragraph is refused',
  'guards-refuse': 'a resolved absorb refused by the guard chain makes no merge commit',
  'guards-no-merge': 'and the refusing guard leaves no merge open',
  'guards-logged': 'the guard refusal is logged as such, not as a resolution',
};

// The Scenario Outline's <theirs change> column, mapped to the claim each row
// asserts. A row this handler cannot name throws.
const OUTLINE = {
  'appended a different paragraph': 'evidence-both',
  'deleted an existing paragraph': 'evidence-deletion',
};

const OUTCOMES = {
  'completes with both paragraphs present': 'evidence-both',
  'is refused': 'evidence-deletion',
};

// Module scope, deliberately: the runtime gives each scenario its own ctx, so
// a per-ctx memo re-ran this whole suite once per scenario - part of the
// multiplier behind BL-1390's 1156-copy storm. One run per process.
let suiteRun = null;

function runE2e(ctx) {
  if (suiteRun) {
    ctx.bl1391 = { ...(ctx.bl1391 || {}), out: suiteRun.out, status: suiteRun.status };
    return suiteRun.out;
  }
  if (ctx.bl1391?.out) return ctx.bl1391.out;
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 1800000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1391 = { ...(ctx.bl1391 || {}), out, status: res.status };
  suiteRun = { out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`the BL-1391 bookkeeping-conflict e2e failed (${res.status}):\n${out}`);
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
  scoped(/^a master checkout whose local main and origin\/main have diverged$/, (ctx) => {
    ctx.bl1391 = ctx.bl1391 || {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^ours appended a notes entry to ticket "(BL-\d+)" and theirs added an abandoned_commits line$/, (ctx) => {
    ctx.bl1391.case = 'appends';
  });

  scoped(/^ours and theirs both changed the title of ticket "(BL-\d+)"$/, (ctx) => {
    ctx.bl1391.case = 'scalar';
  });

  scoped(/^ours and theirs conflict in a daemon script$/, (ctx) => {
    ctx.bl1391.case = 'code';
  });

  scoped(/^ours appended a paragraph to an evidence file and theirs (.+)$/, (ctx, theirs) => {
    const claim = OUTLINE[theirs];
    assert.ok(claim, `unknown <theirs change> example: ${theirs}`);
    ctx.bl1391.case = claim;
  });

  scoped(/^the pre-merge-commit guard chain is armed to refuse$/, (ctx) => {
    ctx.bl1391.guardArmed = true;
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the reconcile sweep absorbs origin\/main$/, (ctx) => {
    assert.ok(ctx.bl1391.case || ctx.bl1391.guardArmed, 'the scenario set no case before absorbing');
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the absorb completes with no MERGE_HEAD left$/, (ctx) => {
    requirePassed(ctx, 'no-merge-head');
  });

  scoped(/^ticket "(BL-\d+)" carries both additions$/, (ctx) => {
    requirePassed(ctx, 'both-additions');
  });

  scoped(/^the merge commit body names the path and the strategy$/, (ctx) => {
    requirePassed(ctx, 'body-names-path');
  });

  scoped(/^the daemon log carries bookkeeping-conflict naming the path$/, (ctx) => {
    requirePassed(ctx, 'log-names-path');
  });

  scoped(/^the absorb is refused$/, (ctx) => {
    requirePassed(ctx, ctx.bl1391.case === 'code' ? 'code-refused' : 'scalar-refused');
  });

  scoped(/^no merge commit exists$/, (ctx) => {
    // Scenario 05 arms the guard chain; the same claim covers it, because a
    // guard refusal and a scalar refusal must both leave no merge behind.
    requirePassed(ctx, 'scalar-refused');
    requirePassed(ctx, 'scalar-clean');
  });

  scoped(/^nothing was resolved$/, (ctx) => {
    requirePassed(ctx, ctx.bl1391.case === 'code' ? 'code-nothing' : 'scalar-clean');
  });

  scoped(/^ticket "(BL-\d+)" is untouched on local main$/, (ctx) => {
    requirePassed(ctx, 'code-nothing');
  });

  scoped(/^the absorb is refused by the guard chain$/, (ctx) => {
    // The guards run on the resolver's OWN merge commit - it never bypasses
    // them - and a refusal there leaves no commit and no open merge.
    requirePassed(ctx, 'guards-refuse');
    requirePassed(ctx, 'guards-no-merge');
    requirePassed(ctx, 'guards-logged');
  });

  // Registered LAST and matching only the outline's own two outcomes: a bare
  // /^the absorb (.+)$/ would swallow the guard-chain step above.
  scoped(/^the absorb (completes with both paragraphs present|is refused)$/, (ctx, outcome) => {
    const claim = OUTCOMES[outcome];
    assert.ok(claim, `unknown <outcome> example: ${outcome}`);
    requirePassed(ctx, claim);
  });
}

module.exports = { registerSteps };
