const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadTaskSpec } = require('../out/benchmark/taskFixture');
const { checkTaskSoundness } = require('../out/benchmark/taskSoundness');

// BL-386 acceptance scenario 05: a task whose own reference solution
// cannot pass its own tests is refused as unsound, before any model is
// scored against it - the mirror-image bug (flooring instead of
// saturating) this ticket's mechanism must never let through silently.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-task-soundness-'));
}

function writeTaskDir(root, name, taskJson, files) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify(taskJson));
  for (const [relPath, content] of Object.entries(files)) {
    const filePath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return dir;
}

test('a task with no reference/ directory at all is left unvalidated (sound by default) and never calls the evaluator', async () => {
  const root = mkTmp();
  const dir = writeTaskDir(root, 'task-1', { id: 'task-1', promptFile: 'TASK.md', testFile: 'test/x.test.js' }, {});
  const task = loadTaskSpec(dir);
  const evaluator = { async evaluate() { throw new Error('must not be called when there is no reference/ directory'); } };

  const result = await checkTaskSoundness(task, { evaluator, scratchRoot: mkTmp() });

  assert.deepEqual(result, { sound: true });
});

test('a task whose reference solution passes every test is sound', async () => {
  const root = mkTmp();
  const dir = writeTaskDir(
    root,
    'task-1',
    { id: 'task-1', promptFile: 'TASK.md', testFile: 'test/x.test.js' },
    { 'reference/src/x.js': 'module.exports = { real: true };' }
  );
  const task = loadTaskSpec(dir);
  const evaluator = { async evaluate() { return { passed: 4, total: 4 }; } };

  const result = await checkTaskSoundness(task, { evaluator, scratchRoot: mkTmp() });

  assert.deepEqual(result, { sound: true });
});

test('a task whose reference solution FAILS its own tests is refused, with a stated reason', async () => {
  const root = mkTmp();
  const dir = writeTaskDir(
    root,
    'task-1',
    { id: 'task-1', promptFile: 'TASK.md', testFile: 'test/x.test.js' },
    { 'reference/src/x.js': 'module.exports = { broken: true };' }
  );
  const task = loadTaskSpec(dir);
  const evaluator = { async evaluate() { return { passed: 2, total: 4 }; } };

  const result = await checkTaskSoundness(task, { evaluator, scratchRoot: mkTmp() });

  assert.equal(result.sound, false);
  assert.match(result.reason, /task-1/);
  assert.match(result.reason, /2\/4/);
});

test('a task whose reference solution has zero tests to run is refused, never treated as a silent pass', async () => {
  const root = mkTmp();
  const dir = writeTaskDir(
    root,
    'task-1',
    { id: 'task-1', promptFile: 'TASK.md', testFile: 'test/x.test.js' },
    { 'reference/src/x.js': 'module.exports = {};' }
  );
  const task = loadTaskSpec(dir);
  const evaluator = { async evaluate() { return { passed: 0, total: 0 }; } };

  const result = await checkTaskSoundness(task, { evaluator, scratchRoot: mkTmp() });

  assert.equal(result.sound, false);
});

test('the reference solution is validated against a MATERIALIZED copy, never the pinned fixtureDir itself', async () => {
  const root = mkTmp();
  const dir = writeTaskDir(
    root,
    'task-1',
    { id: 'task-1', promptFile: 'TASK.md', testFile: 'test/x.test.js' },
    { 'src/x.js': 'throw new Error("stub");', 'reference/src/x.js': 'module.exports = { real: true };' }
  );
  const task = loadTaskSpec(dir);
  const evaluator = {
    async evaluate(cwd) {
      assert.notEqual(cwd, task.fixtureDir, 'must evaluate a materialized copy, never the pinned fixture');
      return { passed: 1, total: 1 };
    },
  };

  const result = await checkTaskSoundness(task, { evaluator, scratchRoot: mkTmp() });

  assert.deepEqual(result, { sound: true });
  // The pinned stub must remain untouched.
  assert.match(fs.readFileSync(path.join(dir, 'src', 'x.js'), 'utf8'), /stub/);
});
