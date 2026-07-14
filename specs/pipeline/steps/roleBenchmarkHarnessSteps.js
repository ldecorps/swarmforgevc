'use strict';

// BL-340 slice 1: step handlers for "models are benchmarked against a
// SwarmForge role, not against generic coding". Drives the REAL compiled
// producers (out/benchmark/runBenchmark.js, rank.js, aggregate.js,
// report.js, reportArtifact.js, taskFixture.js, nodeTestQualityEvaluator.js)
// against the REAL pinned fixture (extension/test/fixtures/benchmark/
// coder-task-01) and a REAL git repo, through the real node:test evaluator -
// the same "fake only the genuinely external boundary" posture the
// recruiter subsystem's own SignupSource/BatteryGate/RoleTrialRunner ports
// already use. The one faked port is ModelExecutor (an LLM actually
// running) - a fake here writes a KNOWN solution variant into the
// materialized scratch dir and returns canned cost/token/duration numbers,
// so quality is still scored by the real evaluator running the real
// fixture's real tests, never fabricated. The REAL live-model proof this
// ticket also requires lives in the separately-committed production report
// (docs/benchmarks/<date>.json), not in this fast, deterministic suite -
// standing up a real network LLM call in an acceptance run would be
// exactly the flaky/slow/nondeterministic thing engineering.prompt's
// Test Speed And Isolation article bans.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const FIXTURE_DIR = path.join(EXT_DIR, 'test', 'fixtures', 'benchmark', 'coder-task-01');

const { loadTaskSpec } = require(path.join(EXT_DIR, 'out', 'benchmark', 'taskFixture'));
const { createNodeTestQualityEvaluator } = require(path.join(EXT_DIR, 'out', 'benchmark', 'nodeTestQualityEvaluator'));
const { runBenchmark } = require(path.join(EXT_DIR, 'out', 'benchmark', 'runBenchmark'));
const { writeBenchmarkReport, commitBenchmarkReport, benchmarkReportPath } = require(path.join(EXT_DIR, 'out', 'benchmark', 'reportArtifact'));

// ── solution variants written into the scratch copy by the fake executor ──
// (real quality still comes from the real evaluator running these for real)

const FULL_SOLUTION_SRC = `'use strict';
function wordFrequency(text) {
  const counts = {};
  const matches = (text || '').match(/[a-zA-Z]+/g) || [];
  for (const raw of matches) {
    const word = raw.toLowerCase();
    counts[word] = (counts[word] || 0) + 1;
  }
  return counts;
}
module.exports = { wordFrequency };
`;

// Deliberately omits .toLowerCase() - passes the fixture's letter/separator
// tests but fails its case-insensitivity tests (4 of 6 -> quality 0.667).
const CASE_SENSITIVE_SOLUTION_SRC = `'use strict';
function wordFrequency(text) {
  const counts = {};
  const matches = (text || '').match(/[a-zA-Z]+/g) || [];
  for (const word of matches) {
    counts[word] = (counts[word] || 0) + 1;
  }
  return counts;
}
module.exports = { wordFrequency };
`;

const STUB_SOLUTION_SRC = `'use strict';

function wordFrequency(text) {
  throw new Error('not implemented');
}

module.exports = { wordFrequency };
`;

const SOLUTIONS_BY_MODEL_ID = {
  'model-full': FULL_SOLUTION_SRC,
  'model-partial': CASE_SENSITIVE_SOLUTION_SRC,
  'model-stub': STUB_SOLUTION_SRC,
};

const EXEC_CONFIG_BY_MODEL_ID = {
  'model-full': { costUsd: 2.0, tokens: { inputTokens: 800, outputTokens: 600 }, durationMs: 3000 },
  'model-partial': { costUsd: 0.01, tokens: { inputTokens: 150, outputTokens: 100 }, durationMs: 900 },
  'model-stub': { costUsd: 0.001, tokens: { inputTokens: 20, outputTokens: 10 }, durationMs: 200 },
};

function defaultModels() {
  return [
    { id: 'model-full', provider: 'claude', model: 'fake-full', label: 'Full solution' },
    { id: 'model-partial', provider: 'claude', model: 'fake-partial', label: 'Partial (case-sensitive) solution' },
    { id: 'model-stub', provider: 'claude', model: 'fake-stub', label: 'Left the stub unimplemented' },
  ];
}

function defaultExecutor(ctx) {
  return {
    async execute(prompt, cwd, model) {
      ctx.executorCalls.push({ prompt, cwd, modelId: model.id });
      ctx.startingStubByModelId[model.id] = fs.readFileSync(path.join(cwd, 'src', 'wordFrequency.js'), 'utf8');
      fs.writeFileSync(path.join(cwd, 'src', 'wordFrequency.js'), SOLUTIONS_BY_MODEL_ID[model.id]);
      return { success: true, ...EXEC_CONFIG_BY_MODEL_ID[model.id] };
    },
  };
}

function mkTmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function initRepo() {
  const root = mkTmp('aps-benchmark-repo-');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return root;
}

const MEASUREMENT_CHECKS = {
  'outcome quality': (agg) => typeof agg.meanQuality === 'number',
  'time to complete': (agg) => typeof agg.meanDurationMs === 'number' && agg.meanDurationMs > 0,
  'tokens used': (agg) => typeof agg.meanTokens === 'number' && agg.meanTokens > 0,
  cost: (agg) => typeof agg.meanCostUsd === 'number' && agg.meanCostUsd > 0,
};

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a fixed role task and a pinned starting state for it$/, (ctx) => {
    ctx.task = loadTaskSpec(FIXTURE_DIR);
    ctx.root = initRepo();
    ctx.scratchRoot = mkTmp('aps-benchmark-scratch-');
    ctx.qualityThreshold = 0.5;
    ctx.repetitions = 1;
    ctx.executorCalls = [];
    ctx.startingStubByModelId = {};
    ctx.models = defaultModels();
    ctx.deps = {
      executor: defaultExecutor(ctx),
      evaluator: createNodeTestQualityEvaluator(),
      scratchRoot: ctx.scratchRoot,
    };
  });

  // ── role-benchmark-harness-01/02/03 Given (reaffirms the Background's
  // own default 3-model configuration - same idiom as
  // costPerTicketDiagramSteps.js's own Background-reaffirming Given) ─────
  registry.define(/^several models are configured for the benchmark$/, (ctx) => {
    if (!ctx.models || ctx.models.length < 2) {
      throw new Error('expected the Background to have already configured several models');
    }
  });

  // ── role-benchmark-harness-05 Given ─────────────────────────────────
  registry.define(/^no configured model meets the quality threshold$/, (ctx) => {
    ctx.models = ctx.models.filter((m) => m.id !== 'model-full');
    ctx.qualityThreshold = 0.99;
  });

  // ── role-benchmark-harness-06 Given ─────────────────────────────────
  registry.define(/^a model is run against the same task more than once$/, (ctx) => {
    ctx.models = [{ id: 'model-variance', provider: 'claude', model: 'fake-variance', label: 'Variance model' }];
    ctx.repetitions = 3;
    const solutions = [FULL_SOLUTION_SRC, CASE_SENSITIVE_SOLUTION_SRC, STUB_SOLUTION_SRC];
    const costs = [0.02, 0.05, 0.03];
    const durations = [1000, 1100, 1200];
    let call = 0;
    ctx.deps.executor = {
      async execute(prompt, cwd, model) {
        ctx.executorCalls.push({ prompt, cwd, modelId: model.id });
        fs.writeFileSync(path.join(cwd, 'src', 'wordFrequency.js'), solutions[call]);
        const result = { success: true, costUsd: costs[call], tokens: { inputTokens: 100, outputTokens: 100 }, durationMs: durations[call] };
        call += 1;
        return result;
      },
    };
  });

  // ── role-benchmark-harness-08 Given ─────────────────────────────────
  registry.define(/^a configured model cannot carry out the role's actions$/, (ctx) => {
    ctx.models = [...ctx.models, { id: 'model-aider', provider: 'aider', model: 'mistral-large', label: "Aider (cannot act)" }];
  });

  // ── shared When ──────────────────────────────────────────────────────
  registry.define(/^the benchmark is run$/, async (ctx) => {
    ctx.report = await runBenchmark({
      task: ctx.task,
      models: ctx.models,
      repetitions: ctx.repetitions,
      qualityThreshold: ctx.qualityThreshold,
      generatedAtIso: '2026-07-13T00:00:00Z',
      deps: ctx.deps,
    });
    ctx.reportDateIso = ctx.report.generatedAtIso.slice(0, 10);
    ctx.reportFilePath = writeBenchmarkReport(ctx.root, ctx.report, ctx.reportDateIso);
    ctx.reportCommitted = commitBenchmarkReport(ctx.root, ctx.reportFilePath, ctx.report.taskId, ctx.reportDateIso);
  });

  // ── role-benchmark-harness-01 Then ──────────────────────────────────
  registry.define(/^each model is given the same task$/, (ctx) => {
    const prompts = new Set(ctx.executorCalls.map((c) => c.prompt));
    if (prompts.size !== 1) {
      throw new Error(`expected every model to receive the identical prompt, got ${prompts.size} distinct prompts`);
    }
  });

  registry.define(/^each model starts from the same state$/, (ctx) => {
    const stubs = new Set(Object.values(ctx.startingStubByModelId));
    if (stubs.size !== 1) {
      throw new Error(`expected every model's starting file content to be byte-identical, got ${stubs.size} distinct variants`);
    }
  });

  // ── role-benchmark-harness-02 Then (Scenario Outline) - <measurement>
  // is LOAD-BEARING against an explicit KNOWN_VALUES lookup, never a
  // passthrough (engineering.prompt's Scenario Outline rule) ────────────
  registry.define(/^each model's run records its (.+)$/, (ctx, measurement) => {
    const check = MEASUREMENT_CHECKS[measurement];
    if (!check) {
      throw new Error(`unknown measurement in Examples table: ${JSON.stringify(measurement)}`);
    }
    for (const modelReport of ctx.report.models.filter((m) => !m.excluded)) {
      if (!check(modelReport)) {
        throw new Error(`expected every non-excluded model to record ${measurement}, but ${modelReport.modelId} did not: ${JSON.stringify(modelReport)}`);
      }
    }
  });

  // ── role-benchmark-harness-03 Then ──────────────────────────────────
  registry.define(/^the report names the best model by quality$/, (ctx) => {
    if (ctx.report.ranking.bestByQuality !== 'model-full') {
      throw new Error(`expected the objectively best (full-solution) model to be named best by quality, got: ${ctx.report.ranking.bestByQuality}`);
    }
  });

  registry.define(/^the report names the best model by quality per unit cost$/, (ctx) => {
    if (ctx.report.ranking.bestByValue !== 'model-partial') {
      throw new Error(`expected the best-ratio (cheap, decent-quality) model to be named best by value, got: ${ctx.report.ranking.bestByValue}`);
    }
  });

  registry.define(/^the report names the cheapest model that meets the quality threshold$/, (ctx) => {
    if (!ctx.report.ranking.cheapestAcceptable) {
      throw new Error('expected a cheapest-acceptable model to be named');
    }
    const named = ctx.report.models.find((m) => m.modelId === ctx.report.ranking.cheapestAcceptable);
    if (named.meanQuality < ctx.report.qualityThreshold) {
      throw new Error(`expected the named cheapest-acceptable model to actually meet the threshold, got: ${JSON.stringify(named)}`);
    }
  });

  // ── role-benchmark-harness-04 Then ──────────────────────────────────
  registry.define(/^the report states the quality threshold a model must meet to be acceptable$/, (ctx) => {
    if (typeof ctx.report.qualityThreshold !== 'number') {
      throw new Error('expected a numeric quality threshold on the report');
    }
    if (!ctx.report.qualityThresholdDescription.includes(String(ctx.report.qualityThreshold))) {
      throw new Error(`expected the threshold description to state the numeric threshold, got: ${ctx.report.qualityThresholdDescription}`);
    }
  });

  // ── role-benchmark-harness-05 Then ──────────────────────────────────
  registry.define(/^the report states that no model met the threshold$/, (ctx) => {
    if (ctx.report.ranking.cheapestAcceptable !== null) {
      throw new Error(`expected no cheapest-acceptable model, got: ${ctx.report.ranking.cheapestAcceptable}`);
    }
    if (!ctx.report.ranking.noAcceptableModelReason) {
      throw new Error('expected an explicit stated reason, not a silently empty field');
    }
  });

  // ── role-benchmark-harness-06 Then ──────────────────────────────────
  registry.define(/^the report states the variance across those runs$/, (ctx) => {
    const [modelReport] = ctx.report.models;
    if (modelReport.repetitions !== 3) {
      throw new Error(`expected 3 recorded repetitions, got: ${modelReport.repetitions}`);
    }
    if (!(modelReport.qualityStdDev > 0)) {
      throw new Error(`expected a nonzero quality variance across differing runs, got: ${modelReport.qualityStdDev}`);
    }
  });

  // ── role-benchmark-harness-07 Then ──────────────────────────────────
  registry.define(/^the recorded results come from the models actually executing the task$/, (ctx) => {
    if (ctx.executorCalls.length === 0) {
      throw new Error('expected the executor to have actually been invoked');
    }
    const fullModelReport = ctx.report.models.find((m) => m.modelId === 'model-full');
    const [run] = fullModelReport.runs;
    if (run.testsTotal !== 6 || run.testsPassed !== 6) {
      throw new Error(
        `expected the REAL node:test evaluator to have actually run the fixture's real test suite against the written solution (6/6), got: ${JSON.stringify(run)}`
      );
    }
  });

  // ── role-benchmark-harness-08 Then ──────────────────────────────────
  registry.define(/^that model is not ranked as though it completed the task$/, (ctx) => {
    const excludedReport = ctx.report.models.find((m) => m.modelId === 'model-aider');
    if (!excludedReport || excludedReport.excluded !== true || !excludedReport.exclusionReason) {
      throw new Error(`expected model-aider to be present and marked excluded with a reason, got: ${JSON.stringify(excludedReport)}`);
    }
    if (excludedReport.repetitions !== 0) {
      throw new Error('expected an excluded model to never have run a trial');
    }
    if (ctx.executorCalls.some((c) => c.modelId === 'model-aider')) {
      throw new Error('expected the executor to never be invoked for a structurally-incapable model');
    }
    const { bestByQuality, bestByValue, cheapestAcceptable } = ctx.report.ranking;
    if ([bestByQuality, bestByValue, cheapestAcceptable].includes('model-aider')) {
      throw new Error('expected the excluded model to never win any ranking slot');
    }
  });

  // ── role-benchmark-harness-09 Then ──────────────────────────────────
  registry.define(/^the report is written as a committed artifact in the repository$/, (ctx) => {
    if (!fs.existsSync(ctx.reportFilePath)) {
      throw new Error(`expected the report file to exist at ${ctx.reportFilePath}`);
    }
    if (ctx.reportCommitted !== true) {
      throw new Error('expected the report write to have been committed');
    }
    const log = git(ctx.root, ['log', '--oneline', '--', ctx.reportFilePath]);
    if (log.trim().split('\n').filter(Boolean).length !== 1) {
      throw new Error(`expected exactly one commit touching the report file, got: ${JSON.stringify(log)}`);
    }
  });

  registry.define(/^the report can be read back from repository state without the benchmark's live state$/, (ctx) => {
    const diskPath = benchmarkReportPath(ctx.root, ctx.reportDateIso);
    const readBack = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
    if (JSON.stringify(readBack) !== JSON.stringify(ctx.report)) {
      throw new Error('expected the committed report to round-trip byte-for-byte from repository state alone');
    }
  });
}

module.exports = { registerSteps };
