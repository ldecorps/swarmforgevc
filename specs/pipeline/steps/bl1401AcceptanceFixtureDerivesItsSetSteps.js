'use strict';

// BL-1401: the BL-632 acceptance handler derives its fixture's guard set from
// the runner, through the one helper BL-1398 shipped.
//
// Answered by this ticket's e2e, which RUNS the BL-632 feature it repairs and
// drives the real helper over a runner seam. Scenario 01's claim is the whole
// point - the feature was 4 pass / 7 fail - so it is answered by running that
// feature, never by reading the handler for a literal.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1401 The BL-632 acceptance fixture derives its guard set from the runner';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1401_acceptance_fixture_derives_set.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  'bl632-green': 'the BL-632 feature passes every scenario against the real runner',
  'uses-helper': "the acceptance handler consumes BL-1398's helper for its guard set",
  'one-parser': "the handler carries no second parse of the runner's guard lines",
  added: "a guard added to the runner appears in the fixture's set with no handler edit",
  'added-runs': 'and the guard chain in the fixture runs it',
  'missing-loud': 'a guard the runner names but the tree lacks fails the build, naming it',
};

// Module scope, not per-ctx: this suite runs a whole acceptance feature, so a
// per-ctx memo would run it once per scenario (BL-1390).
let suiteRun = null;

function runE2e(ctx) {
  ctx.bl1401 = ctx.bl1401 || {};
  if (suiteRun) {
    ctx.bl1401.out = suiteRun;
    return suiteRun;
  }
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 1800000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  suiteRun = out;
  ctx.bl1401.out = out;
  if (res.status !== 0) {
    throw new Error(`the BL-1401 derived-fixture e2e failed (${res.status}):\n${out}`);
  }
  if (/SUITE_BUSY/.test(out)) {
    throw new Error(`the BL-1401 e2e could not run: another instance holds its lock - BLOCKED, not failing.\n${out}`);
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
  scoped(/^the BL-632 acceptance fixture built from a runner seam$/, (ctx) => {
    ctx.bl1401 = ctx.bl1401 || {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the real runner including the handler module graph guard$/, (ctx) => {
    ctx.bl1401.runner = 'real';
  });

  scoped(/^the runner seam names an additional guard that is present on the tree$/, (ctx) => {
    ctx.bl1401.runner = 'added';
  });

  scoped(/^the runner seam names a guard that is absent from the tree$/, (ctx) => {
    ctx.bl1401.runner = 'missing';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the BL-632 feature runs$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the acceptance fixture is built$/, (ctx) => {
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^every scenario run passes$/, (ctx) => {
    requirePassed(ctx, 'bl632-green');
    requirePassed(ctx, 'uses-helper');
    requirePassed(ctx, 'one-parser');
  });

  scoped(/^the fixture's copied guard set includes the additional guard$/, (ctx) => {
    requirePassed(ctx, 'added');
  });

  scoped(/^the guard chain in the fixture runs it$/, (ctx) => {
    requirePassed(ctx, 'added-runs');
  });

  scoped(/^the build fails naming that guard$/, (ctx) => {
    requirePassed(ctx, 'missing-loud');
  });
}

module.exports = { registerSteps };
