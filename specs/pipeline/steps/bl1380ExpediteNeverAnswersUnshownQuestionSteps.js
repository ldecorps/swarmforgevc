'use strict';

// BL-1380: Expedite never answers a question the operator was not shown.
//
// Drives the REAL paused-pager HTTP route by running its own vitest cases and
// reading the per-test verdicts back. The ticket's qa_e2e_procedure step 6 is
// explicit about why: "a scenario that calls only the classifier reports green
// for a decision that is right and never reached - which is this defect's own
// shape". The classifier BL-1367 built is reused unchanged by the route; what
// this feature is about is whether the route CONSULTS it before it writes.
//
// One run serves every scenario; the verdicts are read by test name.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1380 Expedite never answers a question the operator was not shown';
const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');

// Explicit KNOWN_VALUES: a scenario naming a case this handler does not know
// throws rather than passing through unchecked.
const CASES = {
  refused:
    'BL-1380: Expedite refuses (409) a ticket that poses an unanswered choice, naming the gate and the options',
  'already-answered':
    'BL-1380: Expedite proceeds when the choice is already answered, and leaves the ruling alone',
  'no-options-awaiting': 'BL-1380: a ticket with nothing to choose expedites exactly as it does today',
  'no-options-never-pending':
    'BL-1380: a ticket that was never pending approval expedites exactly as it does today',
};

// Scenario Outline's <state> column, mapped to the case each names. Validated
// against these values only - an example row this handler cannot name is a
// throw, never a pass.
const STATES = {
  'is awaiting approval': 'no-options-awaiting',
  'was never pending approval': 'no-options-never-pending',
};

function runSuite(ctx) {
  if (ctx.bl1380?.out) return ctx.bl1380.out;
  const res = spawnSync(
    'npx',
    ['vitest', 'run', '--reporter=verbose', 'test/pausedPagerBridge.test.js', '-t', 'BL-1380'],
    { cwd: EXTENSION_DIR, encoding: 'utf8', timeout: 600000 }
  );
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1380 = { ...(ctx.bl1380 || {}), out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`the paused-pager BL-1380 suite failed (${res.status}):\n${out}`);
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
  scoped(/^a paused ticket "(BL-\d+)" awaiting approval$/, (ctx) => {
    ctx.bl1380 = ctx.bl1380 || {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^"(BL-\d+)" declares ruling options and has no ruling on record$/, (ctx) => {
    ctx.bl1380.case = 'refused';
  });

  scoped(/^"(BL-\d+)" declares ruling options and already has a ruling on record$/, (ctx) => {
    ctx.bl1380.case = 'already-answered';
  });

  scoped(/^"(BL-\d+)" declares no ruling options and (.+)$/, (ctx, _id, state) => {
    const caseKey = STATES[state];
    assert.ok(caseKey, `unknown <state> example: ${state}`);
    ctx.bl1380.case = caseKey;
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the operator expedites "(BL-\d+)" from the pager$/, (ctx) => {
    assert.ok(ctx.bl1380.case, 'the scenario set no case before expediting');
    runSuite(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  // Invariant 1: the refusal happens BEFORE any write, so the approval is
  // never recorded and the ask is still pending.
  scoped(/^"(BL-\d+)" is not recorded as approved without a ruling$/, (ctx) => {
    requirePassed(ctx, 'refused');
  });

  scoped(/^the ruling options of "(BL-\d+)" are still awaiting an answer$/, (ctx) => {
    requirePassed(ctx, 'refused');
  });

  // Invariant 2: the refusal names the gate and the options, and is not a bare
  // status (BL-572/BL-662).
  scoped(/^the response names the gate that refused$/, (ctx) => {
    requirePassed(ctx, 'refused');
  });

  scoped(/^the response carries the option labels of "(BL-\d+)"$/, (ctx) => {
    requirePassed(ctx, 'refused');
  });

  scoped(/^the response is not a bare status code$/, (ctx) => {
    requirePassed(ctx, 'refused');
  });

  scoped(/^"(BL-\d+)" is still in backlog\/paused\/$/, (ctx) => {
    requirePassed(ctx, 'refused');
  });

  scoped(/^the file of "(BL-\d+)" is byte-unchanged$/, (ctx) => {
    requirePassed(ctx, 'refused');
  });

  scoped(/^no promotion was attempted for "(BL-\d+)"$/, (ctx) => {
    requirePassed(ctx, 'refused');
  });

  // Invariant 3, and the answered-choice case: which one is asserted was fixed
  // by the Given, so "is promoted" is never checked against the wrong case.
  scoped(/^"(BL-\d+)" is promoted to backlog\/active\/$/, (ctx) => {
    requirePassed(ctx, ctx.bl1380.case);
  });

  scoped(/^the priority of "(BL-\d+)" is 0$/, (ctx) => {
    requirePassed(ctx, ctx.bl1380.case);
  });

  scoped(/^the ruling on record for "(BL-\d+)" is unchanged$/, (ctx) => {
    requirePassed(ctx, 'already-answered');
  });
}

module.exports = { registerSteps };
