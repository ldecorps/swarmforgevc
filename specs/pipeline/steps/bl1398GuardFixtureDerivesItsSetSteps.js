'use strict';

// BL-1398: the commit-guard property fixture derives its guard set from the
// runner instead of listing the guards by hand.
//
// Every scenario is answered by this ticket's own e2e, which drives the REAL
// derivation over seam runners it writes itself and finishes by running the
// REAL fixture property test against the REAL runner. Nothing here greps a
// label: the defect being closed is precisely a list that agreed with nothing.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1398 The commit-guard fixture derives its guard set from the runner';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1398_guard_fixture_derives_set.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  added: "a guard added to the runner appears in the fixture's set",
  'added-runs': 'the guard chain in the fixture runs the added guard',
  removed: 'a guard the runner no longer names is no longer copied',
  'missing-loud': 'a guard the runner names but the tree lacks refuses, naming it',
  'real-covered': 'every guard the real runner names is in the derived set',
  'real-bl1385': 'including check_handler_module_graph.sh, the guard whose absence caused the red',
  'fixture-green': 'bl632CommitTimeGuardInvariants is green against the real runner',
  'no-hand-list': 'the fixture lists no guard by hand',
};

// Module scope, not per-ctx: the runtime gives each scenario its own ctx, so a
// per-ctx memo would re-run the whole suite once per scenario (BL-1390).
let suiteRun = null;

function runE2e(ctx) {
  ctx.bl1398 = ctx.bl1398 || {};
  if (suiteRun) {
    ctx.bl1398.out = suiteRun.out;
    return suiteRun.out;
  }
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 1800000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  suiteRun = { out, status: res.status };
  ctx.bl1398.out = out;
  if (res.status !== 0) {
    throw new Error(`the BL-1398 derived-guard-set e2e failed (${res.status}):\n${out}`);
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
  scoped(/^the commit-guard property fixture built from a runner seam$/, (ctx) => {
    ctx.bl1398 = ctx.bl1398 || {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the runner seam names an additional guard that is present on the tree$/, (ctx) => {
    ctx.bl1398.case = 'added';
  });

  scoped(/^the runner seam omits one guard it named before$/, (ctx) => {
    ctx.bl1398.case = 'removed';
  });

  scoped(/^the runner seam names a guard that is absent from the tree$/, (ctx) => {
    ctx.bl1398.case = 'missing-loud';
  });

  scoped(/^the real runner including the handler module graph guard$/, (ctx) => {
    ctx.bl1398.case = 'real';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the fixture template is built$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the property test runs$/, (ctx) => {
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the fixture's copied guard set includes the additional guard$/, (ctx) => {
    requirePassed(ctx, 'added');
  });

  scoped(/^the guard chain in the fixture runs it$/, (ctx) => {
    requirePassed(ctx, 'added-runs');
  });

  scoped(/^the fixture's copied guard set omits that guard$/, (ctx) => {
    requirePassed(ctx, 'removed');
  });

  scoped(/^the property test passes$/, (ctx) => {
    requirePassed(ctx, 'fixture-green');
  });

  scoped(/^the test fails naming that guard$/, (ctx) => {
    requirePassed(ctx, 'missing-loud');
  });

  scoped(/^it passes$/, (ctx) => {
    requirePassed(ctx, 'real-covered');
    requirePassed(ctx, 'real-bl1385');
    requirePassed(ctx, 'fixture-green');
    requirePassed(ctx, 'no-hand-list');
  });
}

module.exports = { registerSteps };
