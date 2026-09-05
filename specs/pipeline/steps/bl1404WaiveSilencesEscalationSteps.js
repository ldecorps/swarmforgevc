'use strict';

// BL-1404: step handlers for "a recorded waive silences the operator
// escalation too". Reuses BL-1344's own fixture module wholesale
// (bl1344WaiveFixture.js) - it already runs the REAL babysitter_check.bb
// --nudge against a throwaway git root with two real Article 4.2 findings
// (two commits `main` has that swarmforge-QA does not, each on a
// QA-exclusive path), a fake tmux, and no live operator channel (Telegram/
// email env stripped, so an escalation stays a local enqueue). This
// ticket's own defect and fix live entirely in babysitter_check.bb's
// call-site wiring, so driving the SAME real script the way BL-1344's own
// acceptance handler does is the only faithful way to prove it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  makeFixture,
  removeFixture,
  runSweep,
  recordWaive,
} = require('./lib/bl1344WaiveFixture');

const FEATURE = 'BL-1404 A recorded waive silences the operator escalation too';

function ensureFixture(ctx) {
  if (!ctx.bl1404) ctx.bl1404 = makeFixture();
  return ctx.bl1404;
}

// Called only from a scenario's TRUE last step. Scenario 02's own last step
// ("an operator escalation is enqueued for that key") is TEXTUALLY SHARED
// with scenario 04's non-last first step, so it cannot safely tear down
// there - a scenario 04 run would lose its fixture before its second Then.
// makeFixture()'s own sweepStaleFixtures() (age-guarded, BL-971) reaps that
// one case instead, the same self-healing fallback the fixture module was
// built to provide.
function teardown(ctx) {
  if (ctx.bl1404) removeFixture(ctx.bl1404);
  ctx.bl1404 = null;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a babysitter sweep holding a CRIT finding keyed on a commit sha$/, (ctx) => {
    ensureFixture(ctx);
  });

  scoped(/^an empty escalation dedup state$/, () => {
    // makeFixture() never writes escalation-dedup.json - a fresh fixture
    // root starts with none, exactly "empty" by construction.
  });

  // ── 01: a waived finding wakes nobody, reported as waived ────────────────
  scoped(/^the finding's key is recorded in the waive store$/, (ctx) => {
    const fx = ensureFixture(ctx);
    recordWaive(fx, fx.keys.first, 'coordinator', 'investigated, not a real fault');
  });

  // ── 02: an un-waived finding still escalates ─────────────────────────────
  scoped(/^the waive store records nothing for the finding's key$/, (ctx) => {
    ensureFixture(ctx);
    // No waive recorded - the store simply does not exist yet.
  });

  // ── shared When (all four scenarios) ─────────────────────────────────────
  scoped(/^the sweep decides nudges and escalations$/, (ctx) => {
    const fx = ensureFixture(ctx);
    ctx.result = runSweep(fx);
  });

  scoped(/^no operator escalation is enqueued for that key$/, (ctx) => {
    const fx = ensureFixture(ctx);
    assert.doesNotMatch(
      ctx.result.out,
      new RegExp(`ESCALATED operator: \\[${fx.keys.first}\\]`),
      `expected no escalation for ${fx.keys.first}: ${ctx.result.out}`
    );
  });

  scoped(/^no coordinator nudge is sent for that key$/, (ctx) => {
    const fx = ensureFixture(ctx);
    // The NUDGED summary line is a bare count, never per-key - the fixture's
    // OWN second, always-present finding legitimately still nudges here, so
    // this checks the actual pane text for the first finding's own sha
    // (format-nudge-message joins each finding's :message, which carries
    // the sha but not the "pipeline-code-on-main-" key prefix).
    assert.doesNotMatch(
      ctx.result.nudgeText,
      new RegExp(fx.shas.first),
      `expected no nudge text mentioning ${fx.shas.first}: ${ctx.result.nudgeText}`
    );
  });

  scoped(/^the sweep log reports that key as waived$/, (ctx) => {
    const fx = ensureFixture(ctx);
    assert.match(
      ctx.result.out,
      new RegExp(`WAIVED \\[${fx.keys.first}\\]`),
      `expected a WAIVED line for ${fx.keys.first}: ${ctx.result.out}`
    );
    teardown(ctx);
  });

  scoped(/^an operator escalation is enqueued for that key$/, (ctx) => {
    const fx = ensureFixture(ctx);
    assert.match(
      ctx.result.out,
      new RegExp(`ESCALATED operator: \\[${fx.keys.first}\\]`),
      `expected an escalation for ${fx.keys.first}: ${ctx.result.out}`
    );
  });

  // ── 03: a waive suppresses only the key it names ─────────────────────────
  scoped(/^a second CRIT finding keyed on a different commit sha$/, (ctx) => {
    // makeFixture() already seeds a second real Article 4.2 commit
    // (fx.keys.second) - nothing further to set up.
    ensureFixture(ctx);
  });

  scoped(/^only the first finding's key is recorded in the waive store$/, (ctx) => {
    const fx = ensureFixture(ctx);
    recordWaive(fx, fx.keys.first, 'coordinator', 'investigated, not a real fault');
  });

  scoped(/^an operator escalation is enqueued for the second key only$/, (ctx) => {
    const fx = ensureFixture(ctx);
    assert.doesNotMatch(
      ctx.result.out,
      new RegExp(`ESCALATED operator: \\[${fx.keys.first}\\]`),
      `the waived first key must not escalate: ${ctx.result.out}`
    );
    assert.match(
      ctx.result.out,
      new RegExp(`ESCALATED operator: \\[${fx.keys.second}\\]`),
      `the unwaived second key must still escalate: ${ctx.result.out}`
    );
    teardown(ctx);
  });

  // ── 04: an unusable store escalates rather than going quiet ──────────────
  scoped(/^the waive store is unreadable$/, (ctx) => {
    const fx = ensureFixture(ctx);
    // A directory where the store file is expected: read-waive-store's
    // slurp throws, exactly BL-1344's own "unreadable" fixture shape.
    fs.mkdirSync(fx.storePath, { recursive: true });
  });

  scoped(/^the sweep log says the waive store was unusable$/, (ctx) => {
    assert.match(ctx.result.out, /WAIVE-STORE-UNUSABLE/, `expected WAIVE-STORE-UNUSABLE: ${ctx.result.out}`);
    teardown(ctx);
  });
}

module.exports = { registerSteps };
