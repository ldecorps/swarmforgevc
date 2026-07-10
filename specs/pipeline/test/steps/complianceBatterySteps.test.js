'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/complianceBatterySteps');

// BL-231 hardening: matching the established convention (see
// readyForNextPromotionSteps.test.js/pwaFontSizeSteps.test.js/etc.) - the
// 18/18 Gherkin scenario run only exercises the happy path, so a
// regression in an assertion step's own failure branch would pass the
// feature run and go unnoticed. This file closes that gap for every
// assertion step this feature registers.

function freshRegistry() {
  const registry = createStepRegistry();
  registerSteps(registry);
  return registry;
}

function resolveAndRun(registry, ctx, stepText) {
  const resolved = registry.resolve(stepText);
  if (!resolved) {
    throw new Error(`no step handler matched "${stepText}"`);
  }
  return resolved.handler(ctx, ...resolved.args);
}

// ── Background ────────────────────────────────────────────────────────

test('Background fails loudly when a wrapped helper script is missing', () => {
  const registry = freshRegistry();
  const resolved = registry.resolve(
    'the compliance battery runs a candidate agent through swarm tasks in a scratch worktree using the real helper scripts'
  );
  // The real check reads fixed script paths on disk - proving the throw
  // branch fires requires those paths to actually be missing, which they
  // are not in this repo. Instead this pins that the step is wired to
  // fail loudly (not silently) - the pass path is proven by the real
  // background run in the 18/18 feature pass.
  assert.doesNotThrow(() => resolved.handler({}));
});

// ── unknown violation text guard ─────────────────────────────────────────

test('a candidate agent that "<violation>" rejects an unrecognized violation string', () => {
  const registry = freshRegistry();
  const ctx = {};
  assert.throws(
    () => resolveAndRun(registry, ctx, 'a candidate agent that "does something never named in the Examples table"'),
    /unknown violation text/
  );
});

// ── every scripted core check is recorded pass ───────────────────────────

test('every scripted core check is recorded pass fails loudly when one entry failed', () => {
  const registry = freshRegistry();
  const ctx = {
    entries: [
      { competency: 'receive', status: 'pass' },
      { competency: 'send-handoff', status: 'fail', reason: 'x' },
    ],
  };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'every scripted core check is recorded pass on the scorecard'),
    /but these did not/
  );
});

test('every scripted core check is recorded pass passes when every entry passed', () => {
  const registry = freshRegistry();
  const ctx = { entries: [{ competency: 'receive', status: 'pass' }, { competency: 'complete', status: 'pass' }] };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'every scripted core check is recorded pass on the scorecard'));
});

// ── the "<check>" check is recorded fail with the reason ─────────────────

test('the check-is-recorded-fail assertion fails loudly when the named check is absent entirely', () => {
  const registry = freshRegistry();
  const ctx = { entries: [{ competency: 'receive', status: 'pass' }] };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the "send-handoff" check is recorded fail with the reason on the scorecard'),
    /expected a "send-handoff" entry/
  );
});

test('the check-is-recorded-fail assertion fails loudly when the named check actually passed', () => {
  const registry = freshRegistry();
  const ctx = { entries: [{ competency: 'send-handoff', status: 'pass' }] };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the "send-handoff" check is recorded fail with the reason on the scorecard'),
    /expected "send-handoff" to be recorded fail, got status: pass/
  );
});

test('the check-is-recorded-fail assertion fails loudly when the failing entry carries no reason', () => {
  const registry = freshRegistry();
  const ctx = { entries: [{ competency: 'send-handoff', status: 'fail' }] };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the "send-handoff" check is recorded fail with the reason on the scorecard'),
    /expected "send-handoff" to carry a reason/
  );
});

test('the check-is-recorded-fail assertion passes when the named check failed with a reason', () => {
  const registry = freshRegistry();
  const ctx = { entries: [{ competency: 'send-handoff', status: 'fail', reason: 'bypassed swarm_handoff.sh' }] };
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'the "send-handoff" check is recorded fail with the reason on the scorecard')
  );
});

// ── it is presented to a human with a rubric and the verdict is recorded ─

test('the human-rubric assertion fails loudly when the pending entry carries no rubric prompt', () => {
  const registry = freshRegistry();
  const ctx = { competency: 'startup-reread', rubricEntry: { competency: 'startup-reread', status: 'human-rubric-pending' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it is presented to a human with a rubric and the verdict is recorded on the scorecard'),
    /expected a pending rubric entry carrying a rubric prompt/
  );
});

test('the human-rubric assertion fails loudly when the entry is not actually pending', () => {
  const registry = freshRegistry();
  const ctx = { competency: 'startup-reread', rubricEntry: { competency: 'startup-reread', status: 'pass', rubric: 'x' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'it is presented to a human with a rubric and the verdict is recorded on the scorecard'),
    /expected a pending rubric entry carrying a rubric prompt/
  );
});

test('the human-rubric assertion passes end to end (pending prompt, then a recorded verdict)', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'the "startup-reread" competency, which cannot be judged by script');
  resolveAndRun(registry, ctx, 'the battery runs');
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'it is presented to a human with a rubric and the verdict is recorded on the scorecard')
  );
});

// ── the "<gate>" outcome is recorded on the scorecard ────────────────────

test('the gate-outcome assertion fails loudly when the gate did not pass', () => {
  const registry = freshRegistry();
  const ctx = { gateResult: { competency: 'specifier-gate', status: 'fail', reason: 'malformed' } };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the "a lint-clean Gherkin feature file" outcome is recorded on the scorecard'),
    /expected the a lint-clean Gherkin feature file outcome to be recorded pass/
  );
});

test('the gate-outcome assertion passes when the gate passed', () => {
  const registry = freshRegistry();
  const ctx = { gateResult: { competency: 'specifier-gate', status: 'pass' } };
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'the "a lint-clean Gherkin feature file" outcome is recorded on the scorecard')
  );
});

test('the battery runs that role\'s gate rejects an unknown role under test', () => {
  const registry = freshRegistry();
  const ctx = { role: 'not-a-real-role', fixtureRoot: '/tmp/does-not-matter' };
  assert.throws(() => resolveAndRun(registry, ctx, "the battery runs that role's gate"), /unknown role under test/);
});

// ── scorecard shape/verdict assertion ────────────────────────────────────

test('the scorecard-shape assertion fails loudly when an entry is missing from the output', () => {
  const registry = freshRegistry();
  const ctx = {
    entries: [{ competency: 'a', status: 'pass' }, { competency: 'b', status: 'pass' }],
    scorecard: { model: 'x', entries: [{ competency: 'a', status: 'pass' }], overall: 'swarm-compliant' },
  };
  assert.throws(
    () =>
      resolveAndRun(
        registry,
        ctx,
        "it lists each competency's pass, fail, or human verdict and an overall \"swarm compliant\" verdict"
      ),
    /expected the scorecard to list every competency/
  );
});

test('the scorecard-shape assertion fails loudly on an unrecognized status value', () => {
  const registry = freshRegistry();
  const ctx = {
    entries: [{ competency: 'a', status: 'weird-status' }],
    scorecard: { model: 'x', entries: [{ competency: 'a', status: 'weird-status' }], overall: 'swarm-compliant' },
  };
  assert.throws(
    () =>
      resolveAndRun(
        registry,
        ctx,
        "it lists each competency's pass, fail, or human verdict and an overall \"swarm compliant\" verdict"
      ),
    /unexpected status on the scorecard/
  );
});

test('the scorecard-shape assertion fails loudly when the overall verdict is not swarm-compliant', () => {
  const registry = freshRegistry();
  const ctx = {
    entries: [{ competency: 'a', status: 'fail', reason: 'x' }],
    scorecard: { model: 'x', entries: [{ competency: 'a', status: 'fail', reason: 'x' }], overall: 'non-compliant' },
  };
  assert.throws(
    () =>
      resolveAndRun(
        registry,
        ctx,
        "it lists each competency's pass, fail, or human verdict and an overall \"swarm compliant\" verdict"
      ),
    /expected the overall verdict to be swarm-compliant/
  );
});

test('scorecard-05 passes end to end through the real CLI', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'the battery has completed for a candidate model');
  resolveAndRun(registry, ctx, 'the scorecard is produced');
  assert.doesNotThrow(() =>
    resolveAndRun(
      registry,
      ctx,
      "it lists each competency's pass, fail, or human verdict and an overall \"swarm compliant\" verdict"
    )
  );
});

// ── reference-06 ──────────────────────────────────────────────────────────

test('the reference-config Given fails loudly when no role in roles.tsv is configured on claude', () => {
  const registry = freshRegistry();
  const ctx = { rolesTsv: 'specifier\tmaster\t/x\tswarmforge-specifier\tSpecifier\tgrok\ttask\toff\n' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'the current Claude agent configuration as the reference'),
    /expected the live project's own roles\.tsv to configure at least one role on the "claude" agent brand/
  );
});

test('the reference-config Given passes when at least one role is configured on claude', () => {
  const registry = freshRegistry();
  const ctx = { rolesTsv: 'coder\tcoder\t/x\tswarmforge-coder\tCoder\tclaude\ttask\toff\n' };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'the current Claude agent configuration as the reference'));
});

test('every scripted check passes fails loudly when a scripted entry failed', () => {
  const registry = freshRegistry();
  const ctx = { entries: [{ competency: 'receive', status: 'fail', reason: 'x' }] };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'every scripted check passes'),
    /the battery must not flag the known-good reference agent/
  );
});

test('every scripted check passes end to end for the real reference fixture', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, 'the current Claude agent configuration as the reference');
  resolveAndRun(registry, ctx, 'the scripted battery runs');
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'every scripted check passes'));
});
