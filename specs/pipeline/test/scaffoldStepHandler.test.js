'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  scaffoldStepHandler,
  collectDistinctSteps,
  stepTextToPatternSource,
  placeholderCount,
} = require('../scripts/scaffold_step_handler');
const { createStepRegistry } = require('../stepRegistry');
const { findUnresolvedSteps } = require('../scripts/resolve_contract_steps');
const runtime = require('../runtime');
const { parseFeatureFile } = require('../runnerAdapter');
const { sweepStaleTmpDirs, mkOwnedTmpDir } = require('./lib/tmpDirFixture');

const STEPS_DIR_PREFIX = 'bl1979-scaffold-';

sweepStaleTmpDirs(STEPS_DIR_PREFIX);

const SAMPLE = {
  name: 'sample feature',
  background: [{ keyword: 'Given', text: 'a background precondition is set up' }],
  scenarios: [
    {
      name: 'first plain scenario',
      steps: [
        { keyword: 'When', text: 'the first plain action happens' },
        // Repeated across scenarios on purpose - dedup must collapse this to one stub.
        { keyword: 'Then', text: 'a background precondition is set up' },
      ],
      examples: [],
    },
    {
      name: 'an outlined scenario',
      steps: [{ keyword: 'When', text: 'the principal uses "<mode>"' }],
      examples: [{ mode: 'fast' }, { mode: 'careful' }],
    },
  ],
};

// ── pure helpers ───────────────────────────────────────────────────────────

test('stepTextToPatternSource escapes regex metacharacters and turns a placeholder into a capture group', () => {
  assert.equal(stepTextToPatternSource('a plain step'), 'a plain step');
  assert.equal(stepTextToPatternSource('a $pecial (step)'), 'a \\$pecial \\(step\\)');
  assert.equal(stepTextToPatternSource('the principal uses "<mode>"'), 'the principal uses "(.+?)"');
});

test('placeholderCount counts every <placeholder> span in a step text', () => {
  assert.equal(placeholderCount('no placeholders here'), 0);
  assert.equal(placeholderCount('one "<mode>" placeholder'), 1);
  assert.equal(placeholderCount('"<a>" and "<b>" both placeholders'), 2);
});

test('collectDistinctSteps dedupes a step text repeated across the Background and a scenario, first-seen order', () => {
  const steps = collectDistinctSteps(SAMPLE);
  const texts = steps.map((s) => s.text);
  assert.deepEqual(texts, [
    'a background precondition is set up',
    'the first plain action happens',
    'the principal uses "<mode>"',
  ]);
});

// ── scaffoldStepHandler (injected parse, no real feature file needed) ──────

test('writes a handler file exporting registerSteps, scoped to the feature name', (t) => {
  const stepsDir = mkOwnedTmpDir(t, STEPS_DIR_PREFIX);
  const result = scaffoldStepHandler({
    featureFilePath: 'fake.feature',
    handlerName: 'SampleFixtureSteps',
    stepsDir,
    parse: () => SAMPLE,
  });
  assert.equal(result.ok, true);
  const outPath = path.join(stepsDir, 'SampleFixtureSteps.js');
  assert.equal(result.path, outPath);
  assert.ok(fs.existsSync(outPath));

  const mod = require(outPath);
  assert.equal(typeof mod.registerSteps, 'function');
  const registry = createStepRegistry();
  mod.registerSteps(registry);

  const resolved = registry.resolve('a background precondition is set up', SAMPLE.name);
  assert.ok(resolved, 'expected the deduped background step to resolve');
  assert.throws(() => resolved.handler({}), /not implemented: a background precondition is set up/);

  const unresolved = findUnresolvedSteps(SAMPLE, registry, runtime);
  assert.deepEqual(unresolved, []);
});

test('a placeholder step resolves for every Examples value and captures it', (t) => {
  const stepsDir = mkOwnedTmpDir(t, STEPS_DIR_PREFIX);
  const result = scaffoldStepHandler({
    featureFilePath: 'fake.feature',
    handlerName: 'SampleFixtureSteps',
    stepsDir,
    parse: () => SAMPLE,
  });
  assert.equal(result.ok, true);
  const mod = require(result.path);
  const registry = createStepRegistry();
  mod.registerSteps(registry);

  const outline = SAMPLE.scenarios[1];
  const step = outline.steps[0];
  let sameHandler;
  for (const row of outline.examples) {
    const text = runtime.substitute(step.text, row);
    const resolved = registry.resolve(text, SAMPLE.name);
    assert.ok(resolved, `expected ${text} to resolve`);
    if (sameHandler === undefined) sameHandler = resolved.handler;
    assert.equal(resolved.handler, sameHandler, 'every Examples value must resolve to the SAME stub');
    assert.deepEqual(resolved.args, [row.mode]);
  }
});

test('refuses a handler name that does not end in Steps, writing nothing', (t) => {
  const stepsDir = mkOwnedTmpDir(t, STEPS_DIR_PREFIX);
  const result = scaffoldStepHandler({
    featureFilePath: 'fake.feature',
    handlerName: 'SampleFixtureHandler',
    stepsDir,
    parse: () => SAMPLE,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /must end in "Steps"/);
  assert.deepEqual(fs.readdirSync(stepsDir), []);
});

test('refuses to overwrite a handler file that already exists, naming it, leaving it unchanged', (t) => {
  const stepsDir = mkOwnedTmpDir(t, STEPS_DIR_PREFIX);
  const outPath = path.join(stepsDir, 'SampleFixtureSteps.js');
  const original = "'use strict';\nmodule.exports = { registerSteps() {} };\n";
  fs.writeFileSync(outPath, original);

  const result = scaffoldStepHandler({
    featureFilePath: 'fake.feature',
    handlerName: 'SampleFixtureSteps',
    stepsDir,
    parse: () => SAMPLE,
  });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes(outPath), `expected the refusal to name ${outPath}, got: ${result.error}`);
  assert.equal(fs.readFileSync(outPath, 'utf8'), original);
});

// ── end-to-end against a real feature file (the real vendored parser) ──────

test('end-to-end: a real feature file scaffolds a handler that resolves every step, Background included', (t) => {
  const stepsDir = mkOwnedTmpDir(t, STEPS_DIR_PREFIX);
  const featureFilePath = path.join(__dirname, 'fixtures', 'scaffold-sample.feature');
  const result = scaffoldStepHandler({
    featureFilePath,
    handlerName: 'ScaffoldSampleFixtureSteps',
    stepsDir,
  });
  assert.equal(result.ok, true, JSON.stringify(result));

  const feature = parseFeatureFile(featureFilePath);
  const registry = createStepRegistry();
  require(result.path).registerSteps(registry);
  const unresolved = findUnresolvedSteps(feature, registry, runtime);
  assert.deepEqual(unresolved, []);
});

test('end-to-end: a scenario run against the unfilled scaffold fails naming its first step, not as unmatched', async (t) => {
  const stepsDir = mkOwnedTmpDir(t, STEPS_DIR_PREFIX);
  const featureFilePath = path.join(__dirname, 'fixtures', 'scaffold-sample.feature');
  const result = scaffoldStepHandler({
    featureFilePath,
    handlerName: 'ScaffoldSampleFixtureSteps',
    stepsDir,
  });
  assert.equal(result.ok, true, JSON.stringify(result));

  const feature = parseFeatureFile(featureFilePath);
  const registry = createStepRegistry();
  require(result.path).registerSteps(registry);
  const scenario = feature.scenarios[0];
  const firstStepText = runtime.scenarioSteps(feature, scenario)[0].text;

  await assert.rejects(
    () => runtime.runScenario(registry, feature, scenario),
    (err) => {
      assert.match(err.message, /not implemented:/);
      assert.ok(err.message.includes(firstStepText), `expected the error to name "${firstStepText}", got: ${err.message}`);
      assert.ok(!/no step handler matched/.test(err.message));
      return true;
    }
  );
});
