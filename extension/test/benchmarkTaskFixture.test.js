const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadTaskSpec, loadTaskPrompt, materializeTaskFixture } = require('../out/benchmark/taskFixture');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'benchmark', 'coder-task-01');

test('loadTaskSpec reads task.json', () => {
  const task = loadTaskSpec(FIXTURE_DIR);
  assert.equal(task.id, 'coder-task-01-word-frequency');
  assert.equal(task.testFile, 'test/wordFrequency.test.js');
});

test('loadTaskPrompt reads the prompt file verbatim', () => {
  const task = loadTaskSpec(FIXTURE_DIR);
  const prompt = loadTaskPrompt(task);
  assert.match(prompt, /wordFrequency/);
});

test('materializeTaskFixture copies the pinned starting state into a fresh directory each call', () => {
  const task = loadTaskSpec(FIXTURE_DIR);
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-benchmark-materialize-'));
  const first = materializeTaskFixture(task, scratchRoot);
  const second = materializeTaskFixture(task, scratchRoot);
  assert.notEqual(first, second);
  const firstStub = fs.readFileSync(path.join(first, 'src', 'wordFrequency.js'), 'utf8');
  const secondStub = fs.readFileSync(path.join(second, 'src', 'wordFrequency.js'), 'utf8');
  assert.equal(firstStub, secondStub);
  assert.match(firstStub, /not implemented/);
});
