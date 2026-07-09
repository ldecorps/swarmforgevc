'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

test('asserting no folder for a ticket that IS filed fails the scenario, naming which folder it was found in', async () => {
  const registry = freshRegistry();
  await assert.rejects(
    () =>
      runScenario(registry, {}, scenario('demo', [
        ['Given', 'a target repo with a backlog item "BL-9005" filed under "active" with yaml status "todo"'],
        ['When', 'the backlog folders are read'],
        ['Then', '"BL-9005" appears in no folder'],
      ])),
    /BL-9005.*active/
  );
});

test('the temp target repo fixture is cleaned up after the scenario runs', async () => {
  // Drives the registered steps directly (not via runScenario) so the test
  // owns the context object and can assert on the exact directory it
  // created, instead of diffing the whole shared os.tmpdir() listing - a
  // host running other worktrees' test suites concurrently can create or
  // remove unrelated "aps-backlog-*" entries at any moment, which made a
  // before/after directory-listing snapshot flake under concurrent load.
  const registry = freshRegistry();
  const ctx = {};
  const given = registry.resolve('a target repo with a backlog item "BL-9004" filed under "active" with yaml status "todo"');
  given.handler(ctx, ...given.args);
  const targetPath = ctx.targetPath;
  assert.equal(fs.existsSync(targetPath), true);

  const when = registry.resolve('the backlog folders are read');
  when.handler(ctx, ...when.args);

  assert.equal(fs.existsSync(targetPath), false);
});
