const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runBenchmark } = require('../out/benchmark/runBenchmark');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'benchmark', 'coder-task-01');

function loadTask() {
  return { id: 'fake-task', fixtureDir: FIXTURE_DIR, promptFile: 'TASK.md', testFile: 'test/wordFrequency.test.js' };
}

function mkScratchRoot(name) {
  return mkTmpDir(`sfvc-runbenchmark-${name}-`);
}

// BL-387: every pre-existing test below constructs a `deps` object that
// predates the oracle - a survives-with-no-rework fake keeps their
// pre-BL-387 behavior/assertions unchanged (the diff always "survives",
// so evaluate() still runs against whatever the fake executor left in the
// scratch dir, exactly as before oracle review existed).
function surviveOracle() {
  return { async review() { return { survived: true, bounces: 0 }; } };
}

test('runs every configured model from the same starting task and records quality/latency/cost/tokens', async () => {
  const task = loadTask();
  const calls = [];
  const executor = {
    async execute(prompt, cwd, model) {
      calls.push({ prompt, cwd, modelId: model.id });
      return { success: true, costUsd: 0.02, tokens: { inputTokens: 100, outputTokens: 50 }, durationMs: 1000 };
    },
  };
  const evaluator = { async evaluate() { return { passed: 5, total: 6 }; } };

  const report = await runBenchmark({
    tasks: [task],
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, oracle: surviveOracle(), scratchRoot: mkScratchRoot('basic') },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /wordFrequency/);

  const [modelReport] = report.models;
  assert.equal(modelReport.meanQuality, 5 / 6);
  assert.equal(modelReport.meanCostUsd, 0.02);
  assert.equal(modelReport.meanDurationMs, 1000);
  assert.equal(modelReport.meanTokens, 150);
});

test('repeated runs of the same model report real variance, not just a single averaged number', async () => {
  const task = loadTask();
  const execResults = [
    { success: true, costUsd: 0.01, tokens: { inputTokens: 10, outputTokens: 10 }, durationMs: 500 },
    { success: true, costUsd: 0.03, tokens: { inputTokens: 10, outputTokens: 10 }, durationMs: 1500 },
    { success: true, costUsd: 0.02, tokens: { inputTokens: 10, outputTokens: 10 }, durationMs: 1000 },
  ];
  let execCall = 0;
  const executor = { async execute() { return execResults[execCall++]; } };

  const evalResults = [{ passed: 3, total: 6 }, { passed: 6, total: 6 }, { passed: 4, total: 6 }];
  let evalCall = 0;
  const evaluator = { async evaluate() { return evalResults[evalCall++]; } };

  const report = await runBenchmark({
    tasks: [task],
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 3,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, oracle: surviveOracle(), scratchRoot: mkScratchRoot('variance') },
  });

  const [modelReport] = report.models;
  assert.equal(modelReport.repetitions, 3);
  assert.ok(modelReport.qualityStdDev > 0, 'expected nonzero quality variance across differing runs');
  assert.ok(modelReport.costStdDev > 0, 'expected nonzero cost variance across differing runs');
});

test('a provider that cannot act autonomously is excluded, not ranked as though it completed the task', async () => {
  const task = loadTask();
  const calls = [];
  const executor = {
    async execute(prompt, cwd, model) {
      calls.push(model.id);
      return { success: true, costUsd: 0.02, tokens: { inputTokens: 10, outputTokens: 10 }, durationMs: 100 };
    },
  };
  const evaluator = { async evaluate() { return { passed: 6, total: 6 }; } };

  const report = await runBenchmark({
    tasks: [task],
    models: [
      { id: 'aider-mistral', provider: 'aider', model: 'mistral-large' },
      { id: 'claude-sonnet', provider: 'claude', model: 'sonnet' },
    ],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, oracle: surviveOracle(), scratchRoot: mkScratchRoot('excluded') },
  });

  const excluded = report.models.find((m) => m.modelId === 'aider-mistral');
  assert.equal(excluded.excluded, true);
  assert.ok(excluded.exclusionReason);
  assert.equal(excluded.repetitions, 0);
  assert.deepEqual(calls, ['claude-sonnet']);

  assert.notEqual(report.ranking.bestByQuality, 'aider-mistral');
  assert.notEqual(report.ranking.cheapestAcceptable, 'aider-mistral');
});

test('the quality threshold is stated on the report, and "no model met it" is explicit when true', async () => {
  const task = loadTask();
  const executor = {
    async execute() {
      return { success: true, costUsd: 0.02, tokens: { inputTokens: 10, outputTokens: 10 }, durationMs: 100 };
    },
  };
  const evaluator = { async evaluate() { return { passed: 1, total: 6 }; } };

  const report = await runBenchmark({
    tasks: [task],
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.9,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, oracle: surviveOracle(), scratchRoot: mkScratchRoot('threshold') },
  });

  assert.equal(report.qualityThreshold, 0.9);
  assert.match(report.qualityThresholdDescription, /0\.9/);
  assert.equal(report.ranking.cheapestAcceptable, null);
  assert.match(report.ranking.noAcceptableModelReason, /0\.9/);
});

test('each model starts from the same pinned state', async () => {
  const task = loadTask();
  const seenStubs = [];
  const executor = {
    async execute(prompt, cwd) {
      seenStubs.push(fs.readFileSync(path.join(cwd, 'src', 'wordFrequency.js'), 'utf8'));
      return { success: true, costUsd: 0.01, tokens: { inputTokens: 1, outputTokens: 1 }, durationMs: 1 };
    },
  };
  const evaluator = { async evaluate() { return { passed: 0, total: 6 }; } };

  await runBenchmark({
    tasks: [task],
    models: [
      { id: 'a', provider: 'claude', model: 'x' },
      { id: 'b', provider: 'claude', model: 'y' },
    ],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, oracle: surviveOracle(), scratchRoot: mkScratchRoot('samestate') },
  });

  assert.equal(seenStubs.length, 2);
  assert.equal(seenStubs[0], seenStubs[1]);
  assert.match(seenStubs[0], /not implemented/);
});

test('a run that fails to execute scores 0 and carries its error, rather than being dropped', async () => {
  const task = loadTask();
  const executor = { async execute() { return { success: false, costUsd: null, tokens: null, durationMs: 50, error: 'boom' }; } };
  const evaluator = { async evaluate() { throw new Error('must not be called when the executor failed'); } };

  const report = await runBenchmark({
    tasks: [task],
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, oracle: surviveOracle(), scratchRoot: mkScratchRoot('failed') },
  });

  const [modelReport] = report.models;
  assert.equal(modelReport.meanQuality, 0);
  assert.equal(modelReport.runs[0].ran, false);
  assert.equal(modelReport.runs[0].error, 'boom');
});

test('an executed run whose fixture has zero tests scores quality 0, not NaN', async () => {
  const task = loadTask();
  const executor = {
    async execute() {
      return { success: true, costUsd: 0.01, tokens: { inputTokens: 1, outputTokens: 1 }, durationMs: 10 };
    },
  };
  const evaluator = { async evaluate() { return { passed: 0, total: 0 }; } };

  const report = await runBenchmark({
    tasks: [task],
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, oracle: surviveOracle(), scratchRoot: mkScratchRoot('zero-total') },
  });

  const [modelReport] = report.models;
  assert.equal(modelReport.runs[0].ran, true);
  assert.equal(modelReport.runs[0].qualityScore, 0);
});

// ── BL-386: a battery of several tasks, not one ───────────────────────────

function mkTmp() {
  return mkTmpDir('sfvc-battery-');
}

function fakeTask(id) {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ id, promptFile: 'TASK.md', testFile: 'test/x.test.js' }));
  fs.writeFileSync(path.join(dir, 'TASK.md'), `Task ${id}`);
  return { id, fixtureDir: dir, promptFile: 'TASK.md', testFile: 'test/x.test.js' };
}

test('a-tie-is-reported-as-a-tie-battery-01: every task in the battery is attempted, not just the first', async () => {
  const taskA = fakeTask('task-a');
  const taskB = fakeTask('task-b');
  const seenTaskIds = [];
  const executor = {
    async execute(prompt, cwd) {
      return { success: true, costUsd: 0.01, tokens: { inputTokens: 1, outputTokens: 1 }, durationMs: 10 };
    },
  };
  const evaluator = {
    async evaluate(cwd, task) {
      seenTaskIds.push(task.id);
      return { passed: 1, total: 1 };
    },
  };

  await runBenchmark({
    tasks: [taskA, taskB],
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, oracle: surviveOracle(), scratchRoot: mkScratchRoot('battery-every-task') },
  });

  assert.deepEqual(seenTaskIds, ['task-a', 'task-b']);
});

test('the-battery-can-actually-separate-models-02: the report carries the model\'s score for each task separately', async () => {
  const taskA = fakeTask('task-a');
  const taskB = fakeTask('task-b');
  const results = { 'task-a': { passed: 6, total: 6 }, 'task-b': { passed: 2, total: 6 } };
  const executor = { async execute() { return { success: true, costUsd: 0.01, tokens: { inputTokens: 1, outputTokens: 1 }, durationMs: 10 }; } };
  const evaluator = { async evaluate(cwd, task) { return results[task.id]; } };

  const report = await runBenchmark({
    tasks: [taskA, taskB],
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, oracle: surviveOracle(), scratchRoot: mkScratchRoot('battery-per-task') },
  });

  const [modelReport] = report.models;
  const scoreFor = (taskId) => modelReport.taskScores.find((s) => s.taskId === taskId);
  assert.equal(scoreFor('task-a').meanQuality, 1);
  assert.equal(scoreFor('task-b').meanQuality, 2 / 6);
});

test('the-battery-can-actually-separate-models-03: a model\'s overall quality reflects every task in the battery, not one', async () => {
  const taskA = fakeTask('task-a');
  const taskB = fakeTask('task-b');
  const results = { 'task-a': { passed: 6, total: 6 }, 'task-b': { passed: 0, total: 6 } };
  const executor = { async execute() { return { success: true, costUsd: 0.01, tokens: { inputTokens: 1, outputTokens: 1 }, durationMs: 10 }; } };
  const evaluator = { async evaluate(cwd, task) { return results[task.id]; } };

  const report = await runBenchmark({
    tasks: [taskA, taskB],
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, oracle: surviveOracle(), scratchRoot: mkScratchRoot('battery-overall') },
  });

  const [modelReport] = report.models;
  // Perfect on task-a, zero on task-b: an overall mean of 0.5 proves both
  // tasks fed into it - a single-task-only mean could never land here.
  assert.equal(modelReport.meanQuality, 0.5);
  assert.deepEqual(report.taskIds, ['task-a', 'task-b']);
});

test('the-battery-can-actually-separate-models-05: a task whose own reference solution cannot pass its tests is refused, and no model is scored against it', async () => {
  const taskA = fakeTask('task-a');
  const unsoundTask = fakeTask('task-unsound');
  fs.mkdirSync(path.join(unsoundTask.fixtureDir, 'reference'), { recursive: true });
  fs.writeFileSync(path.join(unsoundTask.fixtureDir, 'reference', 'marker.txt'), 'broken reference');

  const trialCallsByTask = [];
  const executor = {
    async execute(prompt, cwd) {
      return { success: true, costUsd: 0.01, tokens: { inputTokens: 1, outputTokens: 1 }, durationMs: 10 };
    },
  };
  // The FIRST call per task-id is the soundness pre-check (against the
  // reference overlay); every call after a task is deemed sound is a real
  // trial. task-unsound's reference never passes (2/4); task-a's own
  // (nonexistent) reference dir means it skips the check entirely.
  const evaluator = {
    async evaluate(cwd, task) {
      trialCallsByTask.push(task.id);
      if (task.id === 'task-unsound') {
        return { passed: 2, total: 4 };
      }
      return { passed: 5, total: 5 };
    },
  };

  const report = await runBenchmark({
    tasks: [taskA, unsoundTask],
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, oracle: surviveOracle(), scratchRoot: mkScratchRoot('battery-refused') },
  });

  assert.deepEqual(report.taskIds, ['task-a']);
  assert.deepEqual(report.refusedTasks, [{ taskId: 'task-unsound', reason: "task task-unsound's own reference solution does not pass its tests (2/4)" }]);
  // Exactly one soundness-check call for task-unsound (the 2/4 result) and
  // no further evaluate() call for it - it was never run as a real trial.
  assert.equal(trialCallsByTask.filter((id) => id === 'task-unsound').length, 1);
  assert.equal(report.models[0].taskScores.some((s) => s.taskId === 'task-unsound'), false);
});

// ── BL-387: the oracle scores what survives the pipeline, not the diff's
//    first landing spot. The pipeline itself must never be stood up for
//    real here (no real swarm/tmux/agents) - every scenario drives a fake
//    PipelineOracle, per the ticket's own testability note. ─────────────

function fakeExecutorWritingStub() {
  return {
    async execute(prompt, cwd) {
      // Writes something distinguishable so a test can tell whether the
      // evaluator later reads the model's ORIGINAL output or the oracle's
      // revised one.
      fs.writeFileSync(path.join(cwd, 'model-output.txt'), 'model-output');
      return { success: true, costUsd: 0.01, tokens: { inputTokens: 1, outputTokens: 1 }, durationMs: 10 };
    },
  };
}

test('the-oracle-scores-what-survives-the-pipeline-01: the diff is put through the pipeline review stages, not scored where it lands', async () => {
  const task = loadTask();
  const reviewCalls = [];
  const oracle = {
    async review(diffDir, reviewedTask) {
      reviewCalls.push({ diffDir, taskId: reviewedTask.id });
      return { survived: true, bounces: 0 };
    },
  };
  const evaluator = { async evaluate() { return { passed: 6, total: 6 }; } };

  await runBenchmark({
    tasks: [task],
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor: fakeExecutorWritingStub(), evaluator, oracle, scratchRoot: mkScratchRoot('oracle-review-called') },
  });

  assert.equal(reviewCalls.length, 1, 'expected the diff to be put through the pipeline exactly once');
  assert.equal(reviewCalls[0].taskId, task.id);
});

test('the-oracle-scores-what-survives-the-pipeline-02: the model is scored on what the pipeline accepted, not the diff it first produced', async () => {
  const task = loadTask();
  const evaluateCalls = [];
  // The oracle REVISES the diff in place, mirroring a real review stage
  // fixing something before accepting it - this is the mechanism by which
  // "scored on what survived, not what was first produced" holds: the
  // evaluator below reads from the SAME scratch dir, unconditionally,
  // AFTER review() has already mutated it.
  const oracle = {
    async review(diffDir) {
      fs.writeFileSync(path.join(diffDir, 'model-output.txt'), 'pipeline-revised-output');
      return { survived: true, bounces: 1 };
    },
  };
  const evaluator = {
    async evaluate(cwd) {
      evaluateCalls.push(fs.readFileSync(path.join(cwd, 'model-output.txt'), 'utf8'));
      return { passed: 6, total: 6 };
    },
  };

  await runBenchmark({
    tasks: [task],
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor: fakeExecutorWritingStub(), evaluator, oracle, scratchRoot: mkScratchRoot('oracle-scores-accepted') },
  });

  assert.equal(evaluateCalls.length, 1);
  assert.equal(evaluateCalls[0], 'pipeline-revised-output', 'expected the evaluator to see the PIPELINE-ACCEPTED content, not the model\'s original output');
});

// BL-387 the-oracle-scores-what-survives-the-pipeline-03 (Scenario Outline)
for (const bounces of [0, 1, 3]) {
  test(`the-oracle-scores-what-survives-the-pipeline-03: every bounce is counted as rework (bounces=${bounces})`, async () => {
    const task = loadTask();
    const oracle = { async review() { return { survived: true, bounces }; } };
    const evaluator = { async evaluate() { return { passed: 6, total: 6 }; } };

    const report = await runBenchmark({
      tasks: [task],
      models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
      repetitions: 1,
      qualityThreshold: 0.5,
      generatedAtIso: '2026-07-13T00:00:00Z',
      deps: { executor: fakeExecutorWritingStub(), evaluator, oracle, scratchRoot: mkScratchRoot(`oracle-bounces-${bounces}`) },
    });

    assert.equal(report.models[0].runs[0].reworkRounds, bounces, `expected the trial to record ${bounces} rounds of rework`);
  });
}

test('the-oracle-scores-what-survives-the-pipeline-04: a diff the pipeline never accepts is recorded as not surviving, and is not credited', async () => {
  const task = loadTask();
  const oracle = { async review() { return { survived: false, bounces: 2 }; } };
  const evaluator = { async evaluate() { throw new Error('must not be called - the diff never survived the pipeline, so there is nothing to score'); } };

  const report = await runBenchmark({
    tasks: [task],
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor: fakeExecutorWritingStub(), evaluator, oracle, scratchRoot: mkScratchRoot('oracle-never-survived') },
  });

  const [run] = report.models[0].runs;
  assert.equal(run.ran, true, 'the model DID execute - it is the pipeline review that never accepted the result');
  assert.equal(run.survived, false);
  assert.equal(run.reworkRounds, 2, 'expected the bounces attempted before giving up to still be recorded');
  assert.equal(run.qualityScore, 0, 'expected no credit for a diff the pipeline never accepted');
  assert.equal(run.testsPassed, 0);
  assert.equal(run.testsTotal, 0);
});

test('a run that fails to execute never reaches the oracle, and records survived:false with zero rework', async () => {
  const task = loadTask();
  const executor = { async execute() { return { success: false, costUsd: null, tokens: null, durationMs: 50, error: 'boom' }; } };
  const oracle = { async review() { throw new Error('must not be called - the model never produced a diff to review'); } };
  const evaluator = { async evaluate() { throw new Error('must not be called when the executor failed'); } };

  const report = await runBenchmark({
    tasks: [task],
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, oracle, scratchRoot: mkScratchRoot('oracle-skipped-on-exec-failure') },
  });

  const [run] = report.models[0].runs;
  assert.equal(run.ran, false);
  assert.equal(run.survived, false);
  assert.equal(run.reworkRounds, 0);
});
