'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runScenario, substitute, scenarioSteps } = require('../runtime');
const { createStepRegistry } = require('../stepRegistry');

function step(keyword, text) {
  return { keyword, text };
}

test('substitute leaves text unchanged when no example row is given', () => {
  assert.equal(substitute('a role "<role>" is dead', undefined), 'a role "<role>" is dead');
});

test('substitute replaces <param> tokens from the example row', () => {
  assert.equal(substitute('a role "<role>" is dead', { role: 'coder' }), 'a role "coder" is dead');
});

test('substitute leaves an unmatched token untouched', () => {
  assert.equal(substitute('a role "<role>" is dead', { other: 'x' }), 'a role "<role>" is dead');
});

test('scenarioSteps concatenates background steps before scenario steps', () => {
  const feature = { background: [step('Given', 'setup')] };
  const scenario = { steps: [step('When', 'action'), step('Then', 'result')] };
  assert.deepEqual(scenarioSteps(feature, scenario), [
    step('Given', 'setup'),
    step('When', 'action'),
    step('Then', 'result'),
  ]);
});

test('scenarioSteps works with no background', () => {
  const feature = {};
  const scenario = { steps: [step('When', 'action')] };
  assert.deepEqual(scenarioSteps(feature, scenario), [step('When', 'action')]);
});

test('runScenario calls each resolved handler with a context first, then its captured args, in step order', async () => {
  const calls = [];
  const registry = createStepRegistry();
  registry.define(/^setup$/, () => calls.push('setup'));
  registry.define(/^role "([^"]+)" acts$/, (ctx, role) => calls.push(`act:${role}`));
  const feature = { background: [step('Given', 'setup')] };
  const scenario = { name: 'demo', steps: [step('When', 'role "coder" acts')] };

  await runScenario(registry, feature, scenario);

  assert.deepEqual(calls, ['setup', 'act:coder']);
});

test('runScenario substitutes example-row params before resolving a step', async () => {
  const seen = [];
  const registry = createStepRegistry();
  registry.define(/^role "([^"]+)" acts$/, (ctx, role) => seen.push(role));
  const feature = {};
  const scenario = { name: 'demo', steps: [step('When', 'role "<role>" acts')] };

  await runScenario(registry, feature, scenario, { role: 'cleaner' });

  assert.deepEqual(seen, ['cleaner']);
});

test('runScenario shares one context object across every step of the same scenario run', async () => {
  const registry = createStepRegistry();
  registry.define(/^it is set up$/, (ctx) => {
    ctx.value = 'from-given';
  });
  registry.define(/^it is checked$/, (ctx) => {
    assert.equal(ctx.value, 'from-given');
  });
  const feature = {};
  const scenario = { name: 'context-demo', steps: [step('Given', 'it is set up'), step('Then', 'it is checked')] };

  await runScenario(registry, feature, scenario);
});

test('runScenario gives each run of the same scenario a fresh context', async () => {
  const registry = createStepRegistry();
  const seenAtStart = [];
  registry.define(/^it starts$/, (ctx) => {
    seenAtStart.push(ctx.value);
    ctx.value = 'touched';
  });
  const feature = {};
  const scenario = { name: 'fresh-context-demo', steps: [step('Given', 'it starts')] };

  await runScenario(registry, feature, scenario);
  await runScenario(registry, feature, scenario);

  assert.deepEqual(seenAtStart, [undefined, undefined]);
});

test('runScenario throws an error naming the scenario and the unmatched step when no handler resolves', async () => {
  const registry = createStepRegistry();
  const feature = {};
  const scenario = { name: 'unmatched-demo', steps: [step('Then', 'nothing matches this')] };

  await assert.rejects(
    () => runScenario(registry, feature, scenario),
    (err) => {
      assert.match(err.message, /unmatched-demo/);
      assert.match(err.message, /nothing matches this/);
      return true;
    }
  );
});

test('runScenario throws an error naming the scenario and failing step when a handler throws', async () => {
  const registry = createStepRegistry();
  registry.define(/^it fails$/, () => {
    throw new Error('boom');
  });
  const feature = {};
  const scenario = { name: 'failing-demo', steps: [step('Then', 'it fails')] };

  await assert.rejects(
    () => runScenario(registry, feature, scenario),
    (err) => {
      assert.match(err.message, /failing-demo/);
      assert.match(err.message, /it fails/);
      assert.match(err.message, /boom/);
      return true;
    }
  );
});

test('runScenario awaits async handlers before moving to the next step', async () => {
  const order = [];
  const registry = createStepRegistry();
  registry.define(/^first$/, async () => {
    await Promise.resolve();
    order.push('first');
  });
  registry.define(/^second$/, () => order.push('second'));
  const feature = {};
  const scenario = { name: 'async-demo', steps: [step('Given', 'first'), step('Then', 'second')] };

  await runScenario(registry, feature, scenario);

  assert.deepEqual(order, ['first', 'second']);
});
