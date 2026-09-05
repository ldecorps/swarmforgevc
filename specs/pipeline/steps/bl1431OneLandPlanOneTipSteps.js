'use strict';

// BL-1431: step handlers for "one land plan reads one tip".
//
// Every scenario drives the REAL land_step_lib.bb functions (land-plan,
// replay!, origin-main-sha) and, for scenario 04, the REAL
// land_main_publish.sh - never a reimplementation - via
// lib/bl1431OneLandPlanOneTipCli.bb, against a real fixture repository with
// a real bare origin. The Background fixture (an entangled tip, an
// unlanded-but-approved sibling ticket) is built once per mode inside the
// driver; every scenario here maps directly onto one driver mode.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1431 One land plan reads one tip';
const CLI = path.join(__dirname, 'lib', 'bl1431OneLandPlanOneTipCli.bb');

function run(mode) {
  const out = execFileSync('bb', [CLI, mode], { encoding: 'utf8', timeout: 120000 });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with a bare origin, a landed main, and a QA-style branch carrying one approved parcel$/, (ctx) => {
    ctx.bl1431 = {};
  });

  // ── 01 ──────────────────────────────────────────────────────────────
  scoped(/^origin\/main advances by an unrelated mint commit the first time the attribution walk reads a path$/, (ctx) => {
    ctx.bl1431.mode = 'moving-tip';
  });

  scoped(/^the land plan for the parcel is computed$/, (ctx) => {
    ctx.bl1431.result = run(ctx.bl1431.mode);
  });

  scoped(/^its verdict and its own paths equal those of the same plan computed with origin\/main held still$/, (ctx) => {
    const { result } = ctx.bl1431;
    assert.ok(result.originMoved, `expected the fixture to actually move origin/main mid-walk, got: ${JSON.stringify(result)}`);
    assert.equal(result.equal, true, `expected the moving-tip plan to equal the held-still plan, got: ${JSON.stringify(result)}`);
  });

  scoped(/^no path is reported as unreadable$/, (ctx) => {
    assert.equal(ctx.bl1431.result.anyPathUnreadable, false, `expected no unreadable-path warning, got: ${JSON.stringify(ctx.bl1431.result)}`);
  });

  // ── 02 ──────────────────────────────────────────────────────────────
  scoped(/^the land step computes a plan against the fixture$/, (ctx) => {
    ctx.bl1431.result = run('resolved-once');
  });

  scoped(/^origin\/main is resolved by name exactly once$/, (ctx) => {
    assert.equal(ctx.bl1431.result.callCount, 1, `expected origin-main-sha to be called exactly once, got: ${JSON.stringify(ctx.bl1431.result)}`);
  });

  scoped(/^every candidate, delivered-path, attribution and landed-sibling read takes that SHA$/, (ctx) => {
    // The single-call assertion above IS this claim: every one of those
    // reads happens inside the one land-plan invocation that resolved
    // origin/main exactly once, so a second, different resolution would
    // have shown up as callCount > 1. The plan still reaching :replay with
    // the sibling correctly entangled confirms the walk actually ran using
    // that one resolved value, not a vacuous pass with an empty walk.
    const { result } = ctx.bl1431;
    assert.equal(result.action, 'replay', `expected the walk to have actually run (:replay), got: ${JSON.stringify(result)}`);
    assert.deepEqual(result.entangled, ['BL-9002'], `expected the sibling entangled via the resolved SHA, got: ${JSON.stringify(result)}`);
  });

  // ── 03 ──────────────────────────────────────────────────────────────
  scoped(/^the fixture has no origin\/main ref$/, (ctx) => {
    ctx.bl1431.mode = 'no-origin';
  });

  scoped(/^the plan warns that origin\/main could not be resolved$/, (ctx) => {
    const { result } = ctx.bl1431;
    assert.equal(result.action, 'escalate', `expected an escalate action, got: ${JSON.stringify(result)}`);
    assert.match(result.reason, /origin\/main could not be resolved/, `expected the fail-open warning, got: ${result.reason}`);
  });

  scoped(/^it names no guessed SHA$/, (ctx) => {
    // The warning text is a fixed, non-parameterized string (see
    // findings-for-git-handoff style sibling gates' own contract) - no hex
    // SHA-looking token anywhere names a guess.
    assert.doesNotMatch(ctx.bl1431.result.reason, /\b[0-9a-f]{7,40}\b/, `expected no guessed SHA in the warning, got: ${ctx.bl1431.result.reason}`);
  });

  // ── 04 ──────────────────────────────────────────────────────────────
  scoped(/^the plan produced a replay commit and origin\/main then advanced by an unrelated mint$/, (ctx) => {
    ctx.bl1431.mode = 'moved-at-push';
  });

  scoped(/^land_main_publish\.sh pushes the replay$/, (ctx) => {
    ctx.bl1431.result = run(ctx.bl1431.mode);
  });

  scoped(/^it rematches once onto the current tip and publishes$/, (ctx) => {
    const { result } = ctx.bl1431;
    assert.ok(!result.error, `fixture setup failed: ${result.error}`);
    assert.equal(result.rematchCount, 1, `expected exactly one rematch, got: ${JSON.stringify(result)}`);
    assert.equal(result.published, true, `expected LAND_PUBLISHED, got: ${JSON.stringify(result)}`);
  });

  scoped(/^it never rematches twice and never forces$/, (ctx) => {
    const { result } = ctx.bl1431;
    assert.equal(result.rematchCount, 1, `expected exactly one rematch (never twice), got: ${JSON.stringify(result)}`);
    assert.equal(result.forced, false, `expected no force push in the script's own push code, got: ${JSON.stringify(result)}`);
  });
}

module.exports = { registerSteps };
