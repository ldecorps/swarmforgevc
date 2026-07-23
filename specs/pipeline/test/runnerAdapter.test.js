'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runPipeline, parseFeatureFile, runGeneratedTests } = require('../runnerAdapter');

const FEATURE = { name: 'demo', scenarios: [] };

test('parseFeatureFile turns a real feature file into the gherkin-parser JSON IR shape', () => {
  const featurePath = path.join(__dirname, 'fixtures', 'backlog-folders.feature');
  const feature = parseFeatureFile(featurePath);
  assert.equal(feature.name, 'backlog folders are read by folder, not by yaml status field');
  assert.equal(feature.scenarios.length, 2);
  assert.equal(feature.scenarios[0].steps[0].keyword, 'Given');
});

test('runGeneratedTests reports success for a passing file, even when this test itself runs under node --test', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-runner-pass-'));
  try {
    const file = path.join(dir, 'pass.test.js');
    fs.writeFileSync(
      file,
      "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\ntest('ok', () => { assert.equal(1, 1); });\n",
      'utf8'
    );
    const result = runGeneratedTests([file]);
    assert.equal(result.success, true, result.output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runGeneratedTests reports failure and includes the failing test name for a failing file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-runner-fail-'));
  try {
    const file = path.join(dir, 'fail.test.js');
    fs.writeFileSync(
      file,
      "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\ntest('named-failure', () => { assert.equal(1, 2); });\n",
      'utf8'
    );
    const result = runGeneratedTests([file]);
    assert.equal(result.success, false);
    assert.match(result.output, /named-failure/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runPipeline runs parse, then generate, then run, strictly in that order', async () => {
  const order = [];
  const parse = () => {
    order.push('parse');
    return FEATURE;
  };
  const generate = (feature) => {
    order.push('generate');
    assert.equal(feature, FEATURE);
    return '/tmp/generated.test.js';
  };
  const run = (paths) => {
    order.push('run');
    assert.deepEqual(paths, ['/tmp/generated.test.js']);
    return { success: true, output: '' };
  };

  await runPipeline('features/demo.feature', '/tmp/out', '/abs/steps.js', { parse, generate, run });

  assert.deepEqual(order, ['parse', 'generate', 'run']);
});

test('runPipeline awaits an async generate step before invoking run (no overlap)', async () => {
  const order = [];
  const parse = () => FEATURE;
  const generate = async () => {
    order.push('generate-start');
    await Promise.resolve();
    order.push('generate-end');
    return '/tmp/generated.test.js';
  };
  const run = (paths) => {
    order.push('run');
    return { success: true, output: '' };
  };

  await runPipeline('features/demo.feature', '/tmp/out', '/abs/steps.js', { parse, generate, run });

  assert.deepEqual(order, ['generate-start', 'generate-end', 'run']);
});

test('runPipeline returns the run() result', async () => {
  const parse = () => FEATURE;
  const generate = () => '/tmp/generated.test.js';
  const run = () => ({ success: false, output: 'boom' });

  const result = await runPipeline('features/demo.feature', '/tmp/out', '/abs/steps.js', { parse, generate, run });

  assert.deepEqual(result, { success: false, output: 'boom' });
});

test('runPipeline uses the real parse/generate/run defaults when no deps override is given', async () => {
  const featurePath = path.join(__dirname, 'fixtures', 'backlog-folders.feature');
  const stepsPath = path.join(__dirname, '..', 'steps', 'index.js');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-runner-defaults-'));
  try {
    const result = await runPipeline(featurePath, outDir, stepsPath);
    assert.equal(result.success, true, result.output);
    assert.match(result.output, /a ticket in backlog\/active is reported as active/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('runPipeline propagates a parse failure without calling generate or run', async () => {
  const order = [];
  const parse = () => {
    throw new Error('malformed feature file');
  };
  const generate = () => {
    order.push('generate');
    return '/tmp/generated.test.js';
  };
  const run = () => {
    order.push('run');
    return { success: true, output: '' };
  };

  await assert.rejects(
    () => runPipeline('features/demo.feature', '/tmp/out', '/abs/steps.js', { parse, generate, run }),
    /malformed feature file/
  );
  assert.deepEqual(order, []);
});
