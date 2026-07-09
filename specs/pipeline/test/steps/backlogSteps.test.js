'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStepRegistry } = require('../../stepRegistry');
const { runScenario } = require('../../runtime');
const { registerSteps } = require('../../steps/backlogSteps');

function scenario(name, steps) {
  return { name, steps: steps.map(([keyword, text]) => ({ keyword, text })) };
}

function freshRegistry() {
  const registry = createStepRegistry();
  registerSteps(registry);
  return registry;
}

test('a ticket filed under active is reported in the active folder regardless of its yaml status', async () => {
  const registry = freshRegistry();
  await runScenario(registry, {}, scenario('demo', [
    ['Given', 'a target repo with a backlog item "BL-9001" filed under "active" with yaml status "todo"'],
    ['When', 'the backlog folders are read'],
    ['Then', '"BL-9001" appears in the "active" folder'],
  ]));
});

test('a ticket missing from every backlog folder is reported in no folder', async () => {
  const registry = freshRegistry();
  await runScenario(registry, {}, scenario('demo', [
    ['Given', 'a target repo with no backlog item "BL-9002"'],
    ['When', 'the backlog folders are read'],
    ['Then', '"BL-9002" appears in no folder'],
  ]));
});

test('asserting the wrong folder for a real ticket fails the scenario, naming the mismatch', async () => {
  const registry = freshRegistry();
  await assert.rejects(
    () =>
      runScenario(registry, {}, scenario('demo', [
        ['Given', 'a target repo with a backlog item "BL-9003" filed under "active" with yaml status "todo"'],
        ['When', 'the backlog folders are read'],
        ['Then', '"BL-9003" appears in the "paused" folder'],
      ])),
    /BL-9003/
  );
});

test('the temp target repo fixture is cleaned up after the scenario runs', async () => {
  const registry = freshRegistry();
  const fs = require('node:fs');
  const os = require('node:os');
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('aps-backlog-'));

  await runScenario(registry, {}, scenario('demo', [
    ['Given', 'a target repo with a backlog item "BL-9004" filed under "active" with yaml status "todo"'],
    ['When', 'the backlog folders are read'],
    ['Then', '"BL-9004" appears in the "active" folder'],
  ]));

  const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('aps-backlog-'));
  assert.deepEqual(after, before);
});
