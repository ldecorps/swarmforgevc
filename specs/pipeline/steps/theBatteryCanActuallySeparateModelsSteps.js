'use strict';

// BL-386: step handlers for "The benchmark battery is hard enough to tell
// models apart". Drives the REAL compiled runBenchmark (extension/out/
// benchmark/runBenchmark) against fake executor/evaluator adapters for the
// harness-behavior scenarios (01/02/03/05), and reads the REAL committed
// discriminating fixture (test/fixtures/benchmark/coder-task-02-inventory-
// reservation) directly for the fixture-content scenario (04) - no
// reimplementation of either.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { runBenchmark } = require(path.join(EXT_DIR, 'out', 'benchmark', 'runBenchmark'));
const { loadTaskSpec, loadTaskPrompt, hasReferenceSolution } = require(path.join(EXT_DIR, 'out', 'benchmark', 'taskFixture'));

const DISCRIMINATING_TASK_DIR = path.join(EXT_DIR, 'test', 'fixtures', 'benchmark', 'coder-task-02-inventory-reservation');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl386-'));
}

function fakeTask(id) {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ id, promptFile: 'TASK.md', testFile: 'test/x.test.js' }));
  fs.writeFileSync(path.join(dir, 'TASK.md'), `Task ${id}`);
  return { id, fixtureDir: dir, promptFile: 'TASK.md', testFile: 'test/x.test.js' };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a benchmark battery of several tasks$/, (ctx) => {
    ctx.tasks = [fakeTask('task-a'), fakeTask('task-b')];
    ctx.seenTaskIds = [];
    ctx.evaluateResults = { 'task-a': { passed: 6, total: 6 }, 'task-b': { passed: 2, total: 6 } };
    ctx.executor = { async execute() { return { success: true, costUsd: 0.01, tokens: { inputTokens: 1, outputTokens: 1 }, durationMs: 10 }; } };
    ctx.evaluator = {
      async evaluate(cwd, task) {
        ctx.seenTaskIds.push(task.id);
        return ctx.evaluateResults[task.id];
      },
    };
  });

  // ── the-battery-can-actually-separate-models-01/02/03 (shared When) ────
  registry.define(/^the benchmark runs the battery against a model$/, async (ctx) => {
    ctx.report = await runBenchmark({
      tasks: ctx.tasks,
      models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
      repetitions: 1,
      qualityThreshold: 0.5,
      generatedAtIso: '2026-07-14T00:00:00Z',
      // BL-387: this ticket predates the pipeline-review oracle - a
      // survives-with-no-rework fake keeps this scenario scoring the diff
      // exactly where it lands, its own pre-BL-387 behavior.
      deps: { executor: ctx.executor, evaluator: ctx.evaluator, oracle: { async review() { return { survived: true, bounces: 0 }; } }, scratchRoot: mkTmp() },
    });
  });

  // ── the-battery-can-actually-separate-models-01 ─────────────────────────
  registry.define(/^every task in the battery is attempted$/, (ctx) => {
    const expected = ctx.tasks.map((t) => t.id);
    if (JSON.stringify(ctx.seenTaskIds) !== JSON.stringify(expected)) {
      throw new Error(`expected every task attempted in order ${JSON.stringify(expected)}, got ${JSON.stringify(ctx.seenTaskIds)}`);
    }
  });

  // ── the-battery-can-actually-separate-models-02 ─────────────────────────
  registry.define(/^the report carries that model's score for each task separately$/, (ctx) => {
    const [model] = ctx.report.models;
    const scoreFor = (taskId) => model.taskScores.find((s) => s.taskId === taskId);
    if (!scoreFor('task-a') || scoreFor('task-a').meanQuality !== 1) {
      throw new Error(`expected task-a's own score of 1, got ${JSON.stringify(scoreFor('task-a'))}`);
    }
    if (!scoreFor('task-b') || Math.abs(scoreFor('task-b').meanQuality - 2 / 6) > 1e-9) {
      throw new Error(`expected task-b's own score of 2/6, got ${JSON.stringify(scoreFor('task-b'))}`);
    }
  });

  // ── the-battery-can-actually-separate-models-03 ─────────────────────────
  registry.define(/^that model's overall quality reflects every task in the battery$/, (ctx) => {
    const [model] = ctx.report.models;
    // (6/6 + 2/6) / 2 = 4/6 - reachable only if BOTH tasks fed the mean.
    const expected = (1 + 2 / 6) / 2;
    if (Math.abs(model.meanQuality - expected) > 1e-9) {
      throw new Error(`expected overall meanQuality ${expected} reflecting both tasks, got ${model.meanQuality}`);
    }
  });

  // ── the-battery-can-actually-separate-models-04 ─────────────────────────
  registry.define(/^the battery holds a task whose solution spans several files$/, () => {
    const task = loadTaskSpec(DISCRIMINATING_TASK_DIR);
    if (!fs.existsSync(path.join(task.fixtureDir, 'src', 'inventory.js')) || !fs.existsSync(path.join(task.fixtureDir, 'src', 'reservations.js'))) {
      throw new Error('expected the discriminating task to have a solution spanning src/inventory.js and src/reservations.js');
    }
    const testContent = fs.readFileSync(path.join(task.fixtureDir, task.testFile), 'utf8');
    if (!/require\(['"]\.\.\/src\/reservations['"]\)/.test(testContent)) {
      throw new Error('expected the task\'s own tests to require the multi-file solution');
    }
  });

  registry.define(/^the battery holds a task that depends on an invariant its tests never state$/, () => {
    const task = loadTaskSpec(DISCRIMINATING_TASK_DIR);
    const prompt = loadTaskPrompt(task);
    const testContent = fs.readFileSync(path.join(task.fixtureDir, task.testFile), 'utf8');
    if (/reject|negative|exceed/i.test(prompt)) {
      throw new Error('expected the prompt to never state the invariant - only the hidden tests may enforce it');
    }
    if (!/exceed available stock/.test(testContent) || !/never goes negative/.test(testContent)) {
      throw new Error('expected the hidden test suite to enforce the unstated invariant');
    }
  });

  // ── the-battery-can-actually-separate-models-05 ─────────────────────────
  registry.define(/^a task whose own reference solution does not pass its tests$/, (ctx) => {
    const unsound = fakeTask('task-unsound');
    fs.mkdirSync(path.join(unsound.fixtureDir, 'reference'), { recursive: true });
    fs.writeFileSync(path.join(unsound.fixtureDir, 'reference', 'marker.txt'), 'broken reference');
    ctx.tasks.push(unsound);
    ctx.evaluateResults['task-unsound'] = { passed: 2, total: 4 };
  });

  registry.define(/^that task is refused as unsound$/, (ctx) => {
    if (ctx.report.taskIds.includes('task-unsound')) {
      throw new Error(`expected task-unsound excluded from taskIds, got ${JSON.stringify(ctx.report.taskIds)}`);
    }
    if (!ctx.report.refusedTasks.some((r) => r.taskId === 'task-unsound')) {
      throw new Error(`expected task-unsound recorded in refusedTasks, got ${JSON.stringify(ctx.report.refusedTasks)}`);
    }
  });

  registry.define(/^no model is scored against it$/, (ctx) => {
    const [model] = ctx.report.models;
    if (model.taskScores.some((s) => s.taskId === 'task-unsound')) {
      throw new Error('expected no taskScores entry for the refused task');
    }
  });
}

module.exports = { registerSteps };
