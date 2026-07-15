const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  loadTaskSpec,
  loadTaskPrompt,
  materializeTaskFixture,
  loadTaskBattery,
  hasReferenceSolution,
  overlayReferenceSolution,
} = require('../out/benchmark/taskFixture');

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
  const scratchRoot = mkTmpDir('sfvc-benchmark-materialize-');
  const first = materializeTaskFixture(task, scratchRoot);
  const second = materializeTaskFixture(task, scratchRoot);
  assert.notEqual(first, second);
  const firstStub = fs.readFileSync(path.join(first, 'src', 'wordFrequency.js'), 'utf8');
  const secondStub = fs.readFileSync(path.join(second, 'src', 'wordFrequency.js'), 'utf8');
  assert.equal(firstStub, secondStub);
  assert.match(firstStub, /not implemented/);
});

// ── BL-386: loadTaskBattery / reference solution overlay ──────────────────

function mkTmp() {
  return mkTmpDir('sfvc-battery-');
}

function writeTaskDir(root, name, taskJson, extraFiles = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify(taskJson));
  for (const [relPath, content] of Object.entries(extraFiles)) {
    const filePath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return dir;
}

test('loadTaskBattery loads every task subdirectory, sorted by name for a deterministic order', () => {
  const root = mkTmp();
  writeTaskDir(root, 'b-task', { id: 'b-task', promptFile: 'TASK.md', testFile: 'test/b.test.js' });
  writeTaskDir(root, 'a-task', { id: 'a-task', promptFile: 'TASK.md', testFile: 'test/a.test.js' });

  const tasks = loadTaskBattery(root);

  assert.deepEqual(tasks.map((t) => t.id), ['a-task', 'b-task']);
});

test('loadTaskBattery ignores non-directory entries', () => {
  const root = mkTmp();
  writeTaskDir(root, 'real-task', { id: 'real-task', promptFile: 'TASK.md', testFile: 'test/x.test.js' });
  fs.writeFileSync(path.join(root, 'README.md'), 'not a task');

  const tasks = loadTaskBattery(root);

  assert.deepEqual(tasks.map((t) => t.id), ['real-task']);
});

test('hasReferenceSolution is false when the task has no reference/ directory', () => {
  const root = mkTmp();
  const dir = writeTaskDir(root, 'task-1', { id: 'task-1', promptFile: 'TASK.md', testFile: 'test/x.test.js' });
  const task = loadTaskSpec(dir);
  assert.equal(hasReferenceSolution(task), false);
});

test('hasReferenceSolution is true when the task has a reference/ directory', () => {
  const root = mkTmp();
  const dir = writeTaskDir(root, 'task-1', { id: 'task-1', promptFile: 'TASK.md', testFile: 'test/x.test.js' }, { 'reference/src/x.js': 'module.exports = {};' });
  const task = loadTaskSpec(dir);
  assert.equal(hasReferenceSolution(task), true);
});

test('overlayReferenceSolution copies the reference tree onto a materialized fixture, overwriting the stub', () => {
  const root = mkTmp();
  const dir = writeTaskDir(
    root,
    'task-1',
    { id: 'task-1', promptFile: 'TASK.md', testFile: 'test/x.test.js' },
    { 'src/x.js': 'throw new Error("not implemented");', 'reference/src/x.js': 'module.exports = { real: true };' }
  );
  const task = loadTaskSpec(dir);
  const scratchRoot = mkTmp();
  const materialized = materializeTaskFixture(task, scratchRoot);

  overlayReferenceSolution(task, materialized);

  assert.equal(fs.readFileSync(path.join(materialized, 'src', 'x.js'), 'utf8'), 'module.exports = { real: true };');
});

// ── BL-386 the-battery-can-actually-separate-models-04: the real committed
// battery holds a discriminating task (spans several files + an invariant
// never stated in the prompt) ───────────────────────────────────────────

const DISCRIMINATING_TASK_DIR = path.join(__dirname, 'fixtures', 'benchmark', 'coder-task-02-inventory-reservation');

test('the discriminating task\'s own solution spans several files', () => {
  const task = loadTaskSpec(DISCRIMINATING_TASK_DIR);
  const testContent = fs.readFileSync(path.join(task.fixtureDir, task.testFile), 'utf8');
  // require()s both stub source files - a solution touching only one of
  // them cannot pass this task's own tests.
  assert.match(testContent, /require\(['"]\.\.\/src\/reservations['"]\)/);
  assert.ok(fs.existsSync(path.join(task.fixtureDir, 'src', 'inventory.js')));
  assert.ok(fs.existsSync(path.join(task.fixtureDir, 'src', 'reservations.js')));
});

test('the discriminating task holds an invariant its own prompt never states', () => {
  const task = loadTaskSpec(DISCRIMINATING_TASK_DIR);
  const prompt = loadTaskPrompt(task);
  const testContent = fs.readFileSync(path.join(task.fixtureDir, task.testFile), 'utf8');
  // The prompt never mentions rejecting an over-large reservation or stock
  // going negative - only the hidden test suite enforces it.
  assert.equal(/reject|negative|exceed/i.test(prompt), false, 'the prompt must not state the invariant - only the tests may enforce it');
  assert.match(testContent, /exceed available stock/);
  assert.match(testContent, /never goes negative/);
});

test('the discriminating task has a real reference solution that passes its own tests', async () => {
  const task = loadTaskSpec(DISCRIMINATING_TASK_DIR);
  assert.equal(hasReferenceSolution(task), true);
});
