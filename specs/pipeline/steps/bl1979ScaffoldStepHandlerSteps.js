'use strict';

// Scaffolded by scaffold_step_handler.js from specs/features/BL-1979-a-feature-file-scaffolds-its-own-step-handler.feature (BL-1979).
// Fill in each stub below - this header records where it began.
//
// Every scenario drives the real scaffold_step_handler.js and the real
// runner internals (stepRegistry.js, runtime.js, runnerAdapter.js,
// resolve_contract_steps.js) over a fixture feature written under a
// trackedTmpRoot - never a restatement of the scaffold's own logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const PIPELINE_DIR = path.join(__dirname, '..');
let _scaffold = null;
function scaffold() {
  if (!_scaffold) _scaffold = require(path.join(PIPELINE_DIR, 'scripts', 'scaffold_step_handler.js'));
  return _scaffold;
}
let _resolveContractSteps = null;
function resolveContractSteps() {
  if (!_resolveContractSteps) _resolveContractSteps = require(path.join(PIPELINE_DIR, 'scripts', 'resolve_contract_steps.js'));
  return _resolveContractSteps;
}
let _runnerAdapter = null;
function runnerAdapter() {
  if (!_runnerAdapter) _runnerAdapter = require(path.join(PIPELINE_DIR, 'runnerAdapter.js'));
  return _runnerAdapter;
}
let _runtime = null;
function runtime() {
  if (!_runtime) _runtime = require(path.join(PIPELINE_DIR, 'runtime.js'));
  return _runtime;
}
let _stepRegistry = null;
function stepRegistry() {
  if (!_stepRegistry) _stepRegistry = require(path.join(PIPELINE_DIR, 'stepRegistry.js'));
  return _stepRegistry;
}

const FEATURE = "BL-1979 A feature file scaffolds its own step handler";

const HANDLER_NAME = 'Bl1979FixtureSteps';

// Satisfies the Background's own description exactly: a Background, two
// plain scenarios, and a Scenario Outline whose step carries a placeholder.
const FIXTURE_FEATURE_TEXT = `Feature: BL-1979 fixture feature

  Background:
    Given a background precondition is set up

  Scenario: first plain scenario
    When the first plain action happens
    Then the first plain result is checked

  Scenario: second plain scenario
    When the second plain action happens
    Then the second plain result is checked

  Scenario Outline: an outlined scenario with a placeholder
    When the principal uses "<mode>"
    Then the outcome for "<mode>" is recorded

    Examples:
      | mode    |
      | fast    |
      | careful |
`;

function fixtureRoot(ctx) {
  if (ctx.root) return ctx.root;
  const root = trackedTmpRoot('sfvc-bl1979-');
  const featurePath = path.join(root, 'fixture.feature');
  fs.writeFileSync(featurePath, FIXTURE_FEATURE_TEXT);
  const stepsDir = path.join(root, 'steps');
  fs.mkdirSync(stepsDir, { recursive: true });
  ctx.root = root;
  ctx.featurePath = featurePath;
  ctx.stepsDir = stepsDir;
  ctx.outPath = path.join(stepsDir, `${HANDLER_NAME}.js`);
  return root;
}

function loadGeneratedModule(ctx) {
  delete require.cache[require.resolve(ctx.outPath)];
  return require(ctx.outPath);
}

function freshRegistryFromGenerated(ctx) {
  const registry = stepRegistry().createStepRegistry();
  loadGeneratedModule(ctx).registerSteps(registry);
  return registry;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a feature file with a Background, two scenarios and a Scenario Outline whose steps use a placeholder$/, (ctx) => {
    fixtureRoot(ctx);
  });

  scoped(/^the scaffold runs for that feature with a handler name ending in Steps$/, (ctx) => {
    fixtureRoot(ctx);
    ctx.result = scaffold().scaffoldStepHandler({
      featureFilePath: ctx.featurePath,
      handlerName: HANDLER_NAME,
      stepsDir: ctx.stepsDir,
    });
  });

  scoped(/^a file of that name is written under specs\/pipeline\/steps exporting registerSteps$/, (ctx) => {
    assert.equal(ctx.result.ok, true, JSON.stringify(ctx.result));
    assert.equal(ctx.result.path, ctx.outPath);
    assert.ok(fs.existsSync(ctx.outPath));
    const mod = loadGeneratedModule(ctx);
    assert.equal(typeof mod.registerSteps, 'function');
  });

  scoped(
    /^loading the written file into a fresh registry resolves every step of the feature, Background steps included, under the feature's name$/,
    (ctx) => {
      const registry2 = freshRegistryFromGenerated(ctx);
      const feature = runnerAdapter().parseFeatureFile(ctx.featurePath);
      const unresolved = resolveContractSteps().findUnresolvedSteps(feature, registry2, runtime());
      assert.deepEqual(unresolved, []);
    }
  );

  scoped(/^each Examples value of the placeholder resolves to the same stub, which receives that value$/, (ctx) => {
    const registry2 = freshRegistryFromGenerated(ctx);
    const feature = runnerAdapter().parseFeatureFile(ctx.featurePath);
    const outline = feature.scenarios.find((s) => s.examples && s.examples.length > 0);
    assert.ok(outline, 'fixture must carry a Scenario Outline with Examples');
    const placeholderStep = outline.steps.find((s) => /<[^<>]+>/.test(s.text));
    let sameHandler;
    for (const row of outline.examples) {
      const text = runtime().substitute(placeholderStep.text, row);
      const resolved = registry2.resolve(text, feature.name);
      assert.ok(resolved, `expected a resolved stub for: ${text}`);
      if (sameHandler === undefined) sameHandler = resolved.handler;
      assert.equal(resolved.handler, sameHandler, 'every Examples value must resolve to the SAME stub');
      assert.deepEqual(resolved.args, [Object.values(row)[0]]);
    }
  });

  scoped(/^the feature's first scenario runs against the written file$/, async (ctx) => {
    const registry2 = freshRegistryFromGenerated(ctx);
    const feature = runnerAdapter().parseFeatureFile(ctx.featurePath);
    const scenario = feature.scenarios[0];
    ctx.firstStepText = runtime().scenarioSteps(feature, scenario)[0].text;
    try {
      await runtime().runScenario(registry2, feature, scenario);
      ctx.runError = null;
    } catch (err) {
      ctx.runError = err;
    }
  });

  scoped(/^it fails naming that scenario's first step as not implemented, not as a step with no handler$/, (ctx) => {
    assert.ok(ctx.runError, 'expected the scenario run to fail');
    assert.match(ctx.runError.message, /not implemented:/);
    assert.ok(
      ctx.runError.message.includes(ctx.firstStepText),
      `expected the error to name "${ctx.firstStepText}", got: ${ctx.runError.message}`
    );
    assert.ok(!/no step handler matched/.test(ctx.runError.message));
  });

  scoped(/^a handler file of that name already exists$/, (ctx) => {
    fixtureRoot(ctx);
    const content = "'use strict';\nmodule.exports = { registerSteps() {} };\n";
    fs.writeFileSync(ctx.outPath, content);
    ctx.preExistingContent = content;
  });

  scoped(/^the scaffold exits non-zero naming the file$/, (ctx) => {
    assert.equal(ctx.result.ok, false);
    assert.ok(
      ctx.result.error.includes(ctx.outPath),
      `expected the refusal to name ${ctx.outPath}, got: ${ctx.result.error}`
    );
  });

  scoped(/^the existing file is unchanged$/, (ctx) => {
    assert.equal(fs.readFileSync(ctx.outPath, 'utf8'), ctx.preExistingContent);
  });
}

module.exports = { registerSteps };
