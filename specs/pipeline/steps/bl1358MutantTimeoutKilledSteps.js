'use strict';

// BL-1358: a mutant that will not finish is killed and reported.
//
// Drives the REAL harness - specs/pipeline/runnerAdapter.js's spawnSync (the
// wait that had no ceiling) and specs/pipeline/mutationWorker.js's outcome
// mapping - by running this ticket's own node:test file and reading the
// per-case verdicts back. Nothing here restates the decision in JavaScript: a
// ceiling that is right and never reached is exactly the shape of the defect,
// which ran 808 seconds with a harness that looked fine.
//
// One run serves every scenario; verdicts are read by test name.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'A mutant that will not finish is killed and reported, never left to pin a worker';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CEILING_TESTS = path.join('specs', 'pipeline', 'test', 'bl1358MutantTimeCeiling.test.js');

// Explicit KNOWN_VALUES: a scenario naming a case this handler does not know
// throws rather than passing through unchecked.
const CASES = {
  killed: 'BL-1358 01: a mutant that exceeds the ceiling is killed, and the call returns',
  'group-reclaimed': 'BL-1358 01b: killing reclaims the whole process group, never just the direct child',
  reported: 'BL-1358 02: the worker reports a timed-out mutant as its own outcome, naming it and the ceiling',
  'run-stays-useful': 'BL-1358 03: one mutant timing out leaves every other mutant carrying its ordinary outcome',
  untouched: 'BL-1358 04: a mutant that finishes inside the ceiling is untouched',
  configurable: 'BL-1358: the ceiling is configurable, and defaults to the ruled 300 seconds',
};

function runSuite(ctx) {
  if (ctx.bl1358?.out) return ctx.bl1358.out;
  const res = spawnSync(process.execPath, ['--test', CEILING_TESTS], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 600000,
    // The harness under test spawns its own children; this driver must not
    // inherit a nested-run marker that would make node:test skip the files.
    env: (() => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      return env;
    })(),
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1358 = { ...(ctx.bl1358 || {}), out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`the BL-1358 ceiling suite failed (${res.status}):\n${out}`);
  }
  return out;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The TAP line must be present AND passing. Asserting only "no not-ok line"
// would go green for a case that never ran at all, which is the same
// never-reached shape this whole feature is about.
function requirePassed(ctx, caseKey) {
  const name = CASES[caseKey];
  assert.ok(name, `unknown case: ${caseKey}`);
  const out = runSuite(ctx);
  assert.match(out, new RegExp(`^ok \\d+ - ${escape(name)}$`, 'm'), `"${name}" did not pass, in:\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a mutation run with a per-mutant time ceiling$/, (ctx) => {
    ctx.bl1358 = ctx.bl1358 || {};
    // The ceiling exists at all, and is the value the human ruled - asserted
    // here rather than assumed, because every scenario below rests on it.
    requirePassed(ctx, 'configurable');
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^a mutant whose scenario never terminates$/, (ctx) => {
    ctx.bl1358.case = 'killed';
  });

  scoped(/^a mutation run in which exactly one mutant never terminates$/, (ctx) => {
    ctx.bl1358.case = 'run-stays-useful';
  });

  scoped(/^a mutant whose scenario finishes well inside the ceiling$/, (ctx) => {
    ctx.bl1358.case = 'untouched';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the mutation run reaches it$/, (ctx) => {
    assert.ok(ctx.bl1358.case, 'the scenario set no case before running');
    runSuite(ctx);
  });

  scoped(/^the run finishes$/, (ctx) => {
    runSuite(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^that mutant is killed once the ceiling elapses$/, (ctx) => {
    requirePassed(ctx, 'killed');
    // Killing reclaims the whole process group, not merely the direct child -
    // a mutant that shelled out would otherwise leave descendants behind.
    requirePassed(ctx, 'group-reclaimed');
  });

  scoped(/^its worker is free for the next mutant$/, (ctx) => {
    // The same case proves it: the call RETURNED instead of waiting, which is
    // what frees the worker, and the descendant is gone with it.
    requirePassed(ctx, 'killed');
    requirePassed(ctx, 'group-reclaimed');
  });

  scoped(/^the run's outcome for that mutant is distinguishable from a mutant the tests detected$/, (ctx) => {
    requirePassed(ctx, 'reported');
  });

  scoped(/^the report names the mutant and the ceiling it exceeded$/, (ctx) => {
    requirePassed(ctx, 'reported');
  });

  scoped(/^every other mutant carries its ordinary outcome$/, (ctx) => {
    requirePassed(ctx, 'run-stays-useful');
  });

  scoped(/^its outcome is whatever the tests decided$/, (ctx) => {
    requirePassed(ctx, 'untouched');
  });

  scoped(/^nothing was killed$/, (ctx) => {
    requirePassed(ctx, 'untouched');
  });
}

module.exports = { registerSteps };
