'use strict';

// BL-1367: an approval from any surface carries its ruling.
//
// Drives the REAL paused-pager HTTP route - the surface the defect lives on -
// by running its own vitest file and reading the per-test verdicts back. The
// route is what must change (the ticket's required_wiring names
// computePausedPagerApproveOutcome), and a scenario that called the classifier
// alone would report green for a decision that is right and not reached: the
// exact shape BL-1235 warns about, and the exact shape of this defect, where
// one surface had the writer and the other did not.
//
// One run serves every scenario; the verdicts are read by test name.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'An approval from any surface carries its ruling';
const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');

// The Given/Then vocabulary, mapped to the vitest cases that establish each.
// Explicit KNOWN_VALUES: a scenario naming a case this handler does not know
// throws rather than passing through unchecked.
const CASES = {
  'pager-with-ruling': 'BL-1367: the pager records the ruling when the tap carries one',
  'pager-without-options-offered':
    'BL-1367: the pager refuses to record consent alone for a ticket that poses a choice',
  'pager-no-options': 'BL-1367 invariant 3: a ticket posing no choice approves from the pager exactly as before',
  'pager-existing-ruling':
    'BL-1367 invariant 2: a pager approval never disturbs a ruling already recorded',
};

function runSuite(ctx) {
  if (ctx.bl1367?.out) return ctx.bl1367.out;
  const res = spawnSync(
    'npx',
    ['vitest', 'run', '--reporter=verbose', 'test/pausedPagerBridge.test.js', '-t', 'BL-1367'],
    { cwd: EXTENSION_DIR, encoding: 'utf8', timeout: 600000 }
  );
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1367 = { ...(ctx.bl1367 || {}), out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`the paused-pager BL-1367 suite failed (${res.status}):\n${out}`);
  }
  return out;
}

function requirePassed(ctx, caseKey) {
  const name = CASES[caseKey];
  assert.ok(name, `unknown case: ${caseKey}`);
  const out = runSuite(ctx);
  assert.ok(
    out.includes(`✓ test/pausedPagerBridge.test.js > ${name}`),
    `expected "${name}" to pass, in:\n${out}`
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a ticket pending human approval$/, (ctx) => {
    ctx.bl1367 = ctx.bl1367 || {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the ticket declares ruling options$/, (ctx) => {
    ctx.bl1367.declaresOptions = true;
  });

  scoped(/^the ticket declares no ruling options$/, (ctx) => {
    ctx.bl1367.declaresOptions = false;
    ctx.bl1367.case = 'pager-no-options';
  });

  scoped(/^the ticket already records a human ruling$/, (ctx) => {
    ctx.bl1367.case = 'pager-existing-ruling';
  });

  scoped(/^the human approves from the paused pager choosing an option$/, (ctx) => {
    ctx.bl1367.case = 'pager-with-ruling';
  });

  scoped(/^the human approves from a surface that offered no options$/, (ctx) => {
    ctx.bl1367.case = 'pager-without-options-offered';
  });

  scoped(/^the human approves from the paused pager$/, (ctx) => {
    // Scenarios 03 and 04 both say this; which case it is was fixed by the
    // Given above, so the plain approval is never ambiguous here.
    assert.ok(ctx.bl1367.case, 'the scenario set no case before approving');
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the approval is recorded$/, (ctx) => {
    runSuite(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the ticket records that option as the human ruling$/, (ctx) => {
    requirePassed(ctx, 'pager-with-ruling');
  });

  scoped(/^the ticket records approval$/, (ctx) => {
    // Both scenarios that assert this - 01 with a ruling, 03 without options -
    // are checked by the case the Given selected, so "records approval" is
    // never asserted against the wrong surface.
    requirePassed(ctx, ctx.bl1367.case);
  });

  scoped(/^the ticket is not left approved with no ruling$/, (ctx) => {
    requirePassed(ctx, 'pager-without-options-offered');
  });

  scoped(/^the ticket records no human ruling$/, (ctx) => {
    requirePassed(ctx, 'pager-no-options');
  });

  scoped(/^the recorded human ruling is unchanged$/, (ctx) => {
    requirePassed(ctx, 'pager-existing-ruling');
  });
}

module.exports = { registerSteps };
