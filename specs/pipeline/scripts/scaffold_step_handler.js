#!/usr/bin/env node
'use strict';

// BL-1979: given a feature file and a handler name ending in "Steps",
// writes specs/pipeline/steps/<Name>.js - a stub per distinct step text in
// the feature (Background included), each scoped to the feature's own
// name via registry.defineScoped, each stub throwing "not implemented:
// <step text>". A <placeholder> in a step's text becomes a capture group
// in the stub's regex, so a Scenario Outline's step still resolves for
// every Examples row. The command refuses, writing nothing, when the
// target file already exists or the name does not end in "Steps".
//
// Reuse, never reimplement: the feature is parsed with runnerAdapter.js's
// parseFeatureFile - the same vendored APS parser every acceptance run
// uses - never a hand-rolled Gherkin reader.

const fs = require('node:fs');
const path = require('node:path');

const { parseFeatureFile } = require('../runnerAdapter');

const PLACEHOLDER_PATTERN = /<[^<>]+>/g;

function escapeRegexLiteral(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A placeholder span becomes a capture group; everything else in the step
// text is escaped literally. Anchored by the caller (^...$), so this reads
// as the pattern's full source, never a partial match.
function stepTextToPatternSource(text) {
  const segments = text.split(PLACEHOLDER_PATTERN);
  let source = '';
  for (let i = 0; i < segments.length; i += 1) {
    source += escapeRegexLiteral(segments[i]);
    if (i < segments.length - 1) {
      source += '(.+?)';
    }
  }
  return source;
}

function placeholderCount(text) {
  const matches = text.match(PLACEHOLDER_PATTERN);
  return matches ? matches.length : 0;
}

// Every distinct step text in the feature, Background included, first-seen
// order - a step text repeated across scenarios (or shared with the
// Background) gets exactly one stub, since registry.resolve only ever
// needs one match.
function collectDistinctSteps(feature) {
  const seen = new Set();
  const steps = [];
  const collect = (list) => {
    for (const step of list || []) {
      if (!seen.has(step.text)) {
        seen.add(step.text);
        steps.push(step);
      }
    }
  };
  collect(feature.background);
  for (const scenario of feature.scenarios || []) {
    collect(scenario.steps);
  }
  return steps;
}

function renderStubRegistration(step) {
  const pattern = `^${stepTextToPatternSource(step.text)}$`;
  const params = ['ctx'];
  for (let i = 1; i <= placeholderCount(step.text); i += 1) {
    params.push(`p${i}`);
  }
  const lines = [
    `  scoped(new RegExp(${JSON.stringify(pattern)}), (${params.join(', ')}) => {`,
    `    throw new Error(${JSON.stringify(`not implemented: ${step.text}`)});`,
    '  });',
  ];
  return lines.join('\n');
}

function renderHandlerSource(feature, featureFilePath) {
  const steps = collectDistinctSteps(feature);
  const lines = [
    "'use strict';",
    '',
    `// Scaffolded by scaffold_step_handler.js from ${featureFilePath} (BL-1979).`,
    '// Fill in each stub below - this header records where it began.',
    '',
    `const FEATURE = ${JSON.stringify(feature.name)};`,
    '',
    'function registerSteps(registry) {',
    '  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);',
    '',
    ...steps.flatMap((step) => [renderStubRegistration(step), '']),
    '}',
    '',
    'module.exports = { registerSteps };',
    '',
  ];
  return lines.join('\n');
}

// Pure-ish core: all IO (parse, exists-check, write) is injectable so a
// unit test can drive this against fixture features/directories with no
// real filesystem coupling beyond an mkdtemp root.
function scaffoldStepHandler({ featureFilePath, handlerName, stepsDir, parse = parseFeatureFile }) {
  if (!/Steps$/.test(handlerName)) {
    return { ok: false, error: `handler name must end in "Steps": ${handlerName}` };
  }
  const outPath = path.join(stepsDir, `${handlerName}.js`);
  if (fs.existsSync(outPath)) {
    return { ok: false, error: `refusing to overwrite existing file: ${outPath}` };
  }
  const feature = parse(featureFilePath);
  const source = renderHandlerSource(feature, featureFilePath);
  fs.writeFileSync(outPath, source);
  return { ok: true, path: outPath };
}

function main(argv) {
  const [featureFilePath, handlerName] = argv;
  if (!featureFilePath || !handlerName) {
    process.stderr.write('usage: scaffold_step_handler.js <feature-file> <HandlerName ending in Steps>\n');
    return 2;
  }
  const stepsDir = path.join(__dirname, '..', 'steps');
  const result = scaffoldStepHandler({ featureFilePath, handlerName, stepsDir });
  if (!result.ok) {
    process.stderr.write(`scaffold_step_handler.js: ${result.error}\n`);
    return 1;
  }
  process.stdout.write(`${result.path}\n`);
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  scaffoldStepHandler,
  renderHandlerSource,
  collectDistinctSteps,
  stepTextToPatternSource,
  placeholderCount,
  main,
};
