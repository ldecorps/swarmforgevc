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
  return fs.mkdtempSync(path.join(os.tmpdir(), `sfvc-runbenchmark-${name}-`));
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
    task,
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, scratchRoot: mkScratchRoot('basic') },
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
    task,
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 3,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, scratchRoot: mkScratchRoot('variance') },
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
    task,
    models: [
      { id: 'aider-mistral', provider: 'aider', model: 'mistral-large' },
      { id: 'claude-sonnet', provider: 'claude', model: 'sonnet' },
    ],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, scratchRoot: mkScratchRoot('excluded') },
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
    task,
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.9,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, scratchRoot: mkScratchRoot('threshold') },
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
    task,
    models: [
      { id: 'a', provider: 'claude', model: 'x' },
      { id: 'b', provider: 'claude', model: 'y' },
    ],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, scratchRoot: mkScratchRoot('samestate') },
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
    task,
    models: [{ id: 'a', provider: 'claude', model: 'sonnet' }],
    repetitions: 1,
    qualityThreshold: 0.5,
    generatedAtIso: '2026-07-13T00:00:00Z',
    deps: { executor, evaluator, scratchRoot: mkScratchRoot('failed') },
  });

  const [modelReport] = report.models;
  assert.equal(modelReport.meanQuality, 0);
  assert.equal(modelReport.runs[0].ran, false);
  assert.equal(modelReport.runs[0].error, 'boom');
});
