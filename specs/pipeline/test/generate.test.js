'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateEntryPointSource, writeEntryPoints, entryFileName, scenarioCases, slug } = require('../generate');

const SAMPLE_FEATURE = {
  name: 'sample behavior',
  scenarios: [
    { name: 'plain scenario', steps: [{ keyword: 'Given', text: 'a thing' }], examples: [] },
    {
      name: 'outline scenario',
      steps: [{ keyword: 'Given', text: 'a role "<role>"' }],
      examples: [{ role: 'coder' }, { role: 'cleaner' }],
    },
  ],
};

test('slug lowercases and dashes a feature name', () => {
  assert.equal(slug('Sample Behavior!'), 'sample-behavior');
});

test('entryFileName derives a stable name from the feature', () => {
  assert.equal(entryFileName(SAMPLE_FEATURE), 'sample-behavior.generated.test.js');
});

test('scenarioCases returns one case for a scenario with no examples', () => {
  const cases = scenarioCases(SAMPLE_FEATURE.scenarios[0]);
  assert.deepEqual(cases, [{ title: 'plain scenario', row: undefined }]);
});

test('scenarioCases returns one case per example row for an outline scenario', () => {
  const cases = scenarioCases(SAMPLE_FEATURE.scenarios[1]);
  assert.deepEqual(cases.map((c) => c.row), [{ role: 'coder' }, { role: 'cleaner' }]);
  assert.ok(cases.every((c) => c.title.startsWith('outline scenario')));
});

test('generateEntryPointSource emits one test() call per scenario case', () => {
  const source = generateEntryPointSource(SAMPLE_FEATURE, { stepsModulePath: '/abs/steps.js' });
  const testCallCount = source.split("test(").length - 1;
  assert.equal(testCallCount, 3); // 1 plain + 2 outline rows
  assert.match(source, /require\('node:test'\)/);
  assert.match(source, /\/abs\/steps\.js/);
});

test('writeEntryPoints writes a file that node --test runs and passes, at the returned path', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-gen-'));
  try {
    const outPath = writeEntryPoints(SAMPLE_FEATURE, outDir, { stepsModulePath: path.join(__dirname, 'fixtures', 'noopSteps.js') });
    assert.equal(outPath, path.join(outDir, 'sample-behavior.generated.test.js'));
    assert.ok(fs.existsSync(outPath));
    // Run in a separate process: requiring a generated test() file from
    // inside an already-running test registers its tests as subtests of
    // this one and node:test cancels them as soon as this callback
    // returns, well before their assertions run.
    const result = require('node:child_process').spawnSync(process.execPath, ['--test', outPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
