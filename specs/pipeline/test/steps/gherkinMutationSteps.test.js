'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../../stepRegistry');
const { registerSteps } = require('../../steps/gherkinMutationSteps');

// BL-113 hardening: matching the established convention (see
// providerErrorTaxonomySteps.test.js/webhookSecretFixtureSteps.test.js/
// etc.) - the 3/3 Gherkin scenario run only exercises the happy path, so a
// regression in an assertion step's own failure branch would pass the
// feature run and go unnoticed. This file closes that gap.

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

// ── each mutant that changes observable behavior is reported caught ────

test('each mutant that changes observable behavior is reported caught fails loudly when nothing was killed', () => {
  const registry = freshRegistry();
  const ctx = { report: { results: [{ Status: 'survived' }] }, rawStdout: '{}' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'each mutant that changes observable behavior is reported caught'),
    /expected at least one killed mutant/
  );
});

test('each mutant that changes observable behavior is reported caught passes when at least one was killed', () => {
  const registry = freshRegistry();
  const ctx = { report: { results: [{ Status: 'killed' }, { Status: 'survived' }] } };
  assert.doesNotThrow(() =>
    resolveAndRun(registry, ctx, 'each mutant that changes observable behavior is reported caught')
  );
});

// ── the run reports that mutant as surviving, naming the scenario and the mutated value ──

test('the surviving-mutant step fails loudly when nothing survived', () => {
  const registry = freshRegistry();
  const ctx = { report: { results: [{ Status: 'killed' }] }, rawStdout: '{}' };
  assert.throws(
    () =>
      resolveAndRun(
        registry,
        ctx,
        'the run reports that mutant as surviving, naming the scenario and the mutated value'
      ),
    /expected a surviving mutant/
  );
});

test('the surviving-mutant step fails loudly when the Path does not name a scenario/example', () => {
  const registry = freshRegistry();
  const ctx = {
    report: { results: [{ Status: 'survived', Mutation: { Path: 'not-a-real-path', Mutated: '5' } }] },
  };
  assert.throws(
    () =>
      resolveAndRun(
        registry,
        ctx,
        'the run reports that mutant as surviving, naming the scenario and the mutated value'
      ),
    /expected the surviving mutant's Path to name its scenario\/example/
  );
});

test('the surviving-mutant step fails loudly when the mutated value is missing', () => {
  const registry = freshRegistry();
  const ctx = {
    report: {
      results: [{ Status: 'survived', Mutation: { Path: '$.scenarios[1].examples[0].count', Mutated: '' } }],
    },
  };
  assert.throws(
    () =>
      resolveAndRun(
        registry,
        ctx,
        'the run reports that mutant as surviving, naming the scenario and the mutated value'
      ),
    /expected the surviving mutant to name its mutated value/
  );
});

test('the surviving-mutant step passes when the survived mutant names its scenario/example and mutated value', () => {
  const registry = freshRegistry();
  const ctx = {
    report: {
      results: [{ Status: 'survived', Mutation: { Path: '$.scenarios[1].examples[0].count', Mutated: '-1' } }],
    },
  };
  assert.doesNotThrow(() =>
    resolveAndRun(
      registry,
      ctx,
      'the run reports that mutant as surviving, naming the scenario and the mutated value'
    )
  );
});

// ── periodic progress/status output is emitted ──────────────────────────

test('periodic progress/status output is emitted fails loudly when fewer than 2 status lines appear', () => {
  const registry = freshRegistry();
  const ctx = { rawStderr: 'status elapsed=1ms total=2 completed=0\n' };
  assert.throws(
    () => resolveAndRun(registry, ctx, 'periodic progress/status output is emitted'),
    /expected at least a start and end status line/
  );
});

test('periodic progress/status output is emitted passes with a start and end status line', () => {
  const registry = freshRegistry();
  const ctx = {
    rawStderr: 'status elapsed=1ms total=2 completed=0\nstatus elapsed=100ms total=2 completed=2\n',
  };
  assert.doesNotThrow(() => resolveAndRun(registry, ctx, 'periodic progress/status output is emitted'));
});
