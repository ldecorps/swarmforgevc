'use strict';

// BL-1979 invariant property test. No fast-check here: fast-check is an
// extension/ devDependency only (require.resolve('fast-check') fails from
// specs/pipeline/), and this tool's production code lives outside
// extension/ entirely - there is no vitest.properties.config.mjs lane
// reachable from here. A small seeded LCG generator keeps this
// dependency-free and deterministic while still covering many random
// shapes, never a hand-picked example.
//
// Invariant (BL-1979 ticket YAML, verbatim): "The scaffold writes only a
// new file and never overwrites one, and every step text the feature's
// parser reports resolves to a stub scoped to that feature."

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { scaffoldStepHandler } = require('../scripts/scaffold_step_handler');
const { createStepRegistry } = require('../stepRegistry');
const { findUnresolvedSteps } = require('../scripts/resolve_contract_steps');
const runtime = require('../runtime');
const { sweepStaleTmpDirs, mkOwnedTmpDir } = require('./lib/tmpDirFixture');

const ITERATIONS = 80;
const SEED = 0x1979;
const STEPS_DIR_PREFIX = 'bl1979-prop-';

sweepStaleTmpDirs(STEPS_DIR_PREFIX);

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick(rng, list) {
  return list[randInt(rng, 0, list.length - 1)];
}

// Deliberately includes regex metacharacters and quotes, so the generator
// actually reaches the escaping path stepTextToPatternSource exists for -
// a generator that only ever drew plain words would pass against a broken
// escaper by construction.
const WORD_POOL = [
  'alpha',
  'beta (tier)',
  'a $pecial case',
  'a [bracketed] value',
  'a step. with a dot',
  'a pipe|value',
  'plus+sign',
  'star*mark',
];

function randomLiteralStep(rng) {
  const n = randInt(rng, 1, 3);
  const words = [];
  for (let i = 0; i < n; i += 1) words.push(pick(rng, WORD_POOL));
  return words.join(' / ');
}

function randomPlaceholderStep(rng, placeholderName) {
  return `the principal picks "<${placeholderName}>" (${randomLiteralStep(rng)})`;
}

// A random feature IR (the same shape parseFeatureFile produces): a
// Background of 0-2 steps, 2-4 plain scenarios of 1-3 steps each, and
// exactly one Scenario Outline with a single placeholder step and 1-3
// Examples rows. Some step texts are intentionally repeated across
// scenarios/Background to exercise collectDistinctSteps' dedup under
// randomization too, not just in the hand-written unit test.
function randomFeature(rng, index) {
  const name = `property feature ${index}`;
  const backgroundCount = randInt(rng, 0, 2);
  const background = [];
  for (let i = 0; i < backgroundCount; i += 1) {
    background.push({ keyword: 'Given', text: randomLiteralStep(rng) });
  }
  const scenarioCount = randInt(rng, 2, 4);
  const scenarios = [];
  for (let s = 0; s < scenarioCount; s += 1) {
    const stepCount = randInt(rng, 1, 3);
    const steps = [];
    for (let i = 0; i < stepCount; i += 1) {
      // 1-in-4 chance of reusing a Background step's own text, to force a
      // real cross-bucket duplicate the dedup must collapse.
      const text = background.length > 0 && rng() < 0.25 ? pick(rng, background).text : randomLiteralStep(rng);
      steps.push({ keyword: i === 0 ? 'When' : 'Then', text });
    }
    scenarios.push({ name: `scenario ${s}`, steps, examples: [] });
  }
  const placeholderName = pick(rng, ['mode', 'target', 'choice']);
  const exampleCount = randInt(rng, 1, 3);
  const examples = [];
  for (let i = 0; i < exampleCount; i += 1) {
    examples.push({ [placeholderName]: `${randomLiteralStep(rng)}-${i}` });
  }
  scenarios.push({
    name: 'outlined scenario',
    steps: [{ keyword: 'When', text: randomPlaceholderStep(rng, placeholderName) }],
    examples,
  });
  return { name, background, scenarios };
}

test(`property: every generated feature's steps all resolve, Background and placeholder Examples included (${ITERATIONS} random shapes)`, (t) => {
  const rng = makeRng(SEED);
  for (let i = 0; i < ITERATIONS; i += 1) {
    const feature = randomFeature(rng, i);
    const stepsDir = mkOwnedTmpDir(t, STEPS_DIR_PREFIX);
    const result = scaffoldStepHandler({
      featureFilePath: `property-${i}.feature`,
      handlerName: `PropertyFixture${i}Steps`,
      stepsDir,
      parse: () => feature,
    });
    assert.equal(result.ok, true, `iteration ${i}: ${JSON.stringify(result)}`);

    const registry = createStepRegistry();
    require(result.path).registerSteps(registry);
    const unresolved = findUnresolvedSteps(feature, registry, runtime);
    assert.deepEqual(unresolved, [], `iteration ${i}: unresolved steps ${JSON.stringify(unresolved)}`);
  }
});

test(`property: a second scaffold on the same target always refuses and leaves the file byte-identical (${ITERATIONS} random shapes)`, (t) => {
  const rng = makeRng(SEED + 1);
  for (let i = 0; i < ITERATIONS; i += 1) {
    const feature = randomFeature(rng, i);
    const stepsDir = mkOwnedTmpDir(t, STEPS_DIR_PREFIX);
    const handlerName = `PropertyRepeat${i}Steps`;
    const first = scaffoldStepHandler({
      featureFilePath: `property-${i}.feature`,
      handlerName,
      stepsDir,
      parse: () => feature,
    });
    assert.equal(first.ok, true, `iteration ${i}: first scaffold unexpectedly refused: ${JSON.stringify(first)}`);
    const before = fs.readFileSync(first.path, 'utf8');

    // A second, different feature shape at the SAME target - must never
    // overwrite, regardless of what the second call would have produced.
    const second = scaffoldStepHandler({
      featureFilePath: `property-${i}-again.feature`,
      handlerName,
      stepsDir,
      parse: () => randomFeature(rng, `${i}-again`),
    });
    assert.equal(second.ok, false, `iteration ${i}: expected the second scaffold to refuse`);
    assert.ok(second.error.includes(first.path), `iteration ${i}: refusal must name the file`);
    assert.equal(fs.readFileSync(first.path, 'utf8'), before, `iteration ${i}: existing file must be byte-identical`);
  }
});
