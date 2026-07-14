const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseNodeTestTapSummary, createNodeTestQualityEvaluator } = require('../out/benchmark/nodeTestQualityEvaluator');

test('parseNodeTestTapSummary reads the # pass / # tests footer lines', () => {
  const tap = '# Subtest: a\nok 1 - a\n1..3\n# tests 3\n# suites 0\n# pass 2\n# fail 1\n';
  assert.deepEqual(parseNodeTestTapSummary(tap), { passed: 2, total: 3 });
});

test('parseNodeTestTapSummary with no summary footer scores 0 of 0, never crashing', () => {
  assert.deepEqual(parseNodeTestTapSummary(''), { passed: 0, total: 0 });
});

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-benchmark-eval-')));
}

test('the real evaluator scores a fully-passing suite as passed === total', async () => {
  const dir = mkTmp();
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(
    path.join(dir, 'test', 'x.test.js'),
    "const test=require('node:test'); const assert=require('node:assert/strict'); test('ok', () => assert.equal(1,1));"
  );
  const evaluator = createNodeTestQualityEvaluator();
  const result = await evaluator.evaluate(dir, { id: 't', fixtureDir: dir, promptFile: 'TASK.md', testFile: 'test/x.test.js' });
  assert.deepEqual(result, { passed: 1, total: 1 });
});

test('the real evaluator scores a partially-failing suite honestly, never crashing on a nonzero exit', async () => {
  const dir = mkTmp();
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(
    path.join(dir, 'test', 'x.test.js'),
    "const test=require('node:test'); const assert=require('node:assert/strict'); " +
      "test('a', () => assert.equal(1,1)); test('b', () => assert.equal(1,2));"
  );
  const evaluator = createNodeTestQualityEvaluator();
  const result = await evaluator.evaluate(dir, { id: 't', fixtureDir: dir, promptFile: 'TASK.md', testFile: 'test/x.test.js' });
  assert.deepEqual(result, { passed: 1, total: 2 });
});

test('the real evaluator scores the fixture correctly even when the caller\'s own NODE_TEST_ env has leaked in', async () => {
  const dir = mkTmp();
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(
    path.join(dir, 'test', 'x.test.js'),
    "const test=require('node:test'); const assert=require('node:assert/strict'); test('ok', () => assert.equal(1,1));"
  );
  const evaluator = createNodeTestQualityEvaluator();
  process.env.NODE_TEST_CONTEXT = 'leaked-from-outer-run';
  try {
    const result = await evaluator.evaluate(dir, { id: 't', fixtureDir: dir, promptFile: 'TASK.md', testFile: 'test/x.test.js' });
    assert.deepEqual(result, { passed: 1, total: 1 });
  } finally {
    delete process.env.NODE_TEST_CONTEXT;
  }
});

test('a cwd the child process cannot even spawn into scores 0 of 0 rather than crashing', async () => {
  const evaluator = createNodeTestQualityEvaluator();
  const result = await evaluator.evaluate('/nonexistent-dir-sfvc-benchmark-xyz', {
    id: 't',
    fixtureDir: '/nonexistent-dir-sfvc-benchmark-xyz',
    promptFile: 'TASK.md',
    testFile: 'test/x.test.js',
  });
  assert.deepEqual(result, { passed: 0, total: 0 });
});
