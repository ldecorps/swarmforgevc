'use strict';

// BL-388 (epic BL-384, slice 4): step handlers for "The leaderboard ranks
// models on what survived and what the rework cost" - THE EPIC'S WIRING
// SLICE. Drives the REAL compiled aggregateModelTrials (extension/out/
// benchmark/aggregate) and rankModels (extension/out/benchmark/rank)
// against hand-built TrialOutcome fixtures - the same "fake only the
// genuinely external boundary" posture bl387TheOracleScoresWhatSurvivesThePipelineSteps.js
// established, one layer up (no ModelExecutor/PipelineOracle needed here;
// the survived/reworkRounds signal is simply given, matching what runTrial
// already guarantees: qualityScore is 0 exactly when survived is false).
// The leaderboard-presentation scenario (03) drives the REAL pwa/index.html
// + pwa/app.js via extension/scripts/render-role-leaderboard.js, mirroring
// aTieIsReportedAsATieSteps.js's own established render pattern.
//
// Scoped (registry.defineScoped) throughout: "the benchmark ranks the
// models", "the human looks at the leaderboard", "no model is named best by
// quality" and "the benchmark reports that it could not discriminate
// between the models" are already registered UNSCOPED by
// aTieIsReportedAsATieSteps.js (BL-385) for its own (incompatible - a plain
// ModelAggregate fixture built by hand, not via the real aggregateModelTrials)
// ctx shape. Unscoped registration here would silently lose to that earlier
// one (first-match-wins) and run the WRONG handler against this feature's
// own ctx.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { aggregateModelTrials } = require(path.join(EXT_DIR, 'out', 'benchmark', 'aggregate'));
const { rankModels } = require(path.join(EXT_DIR, 'out', 'benchmark', 'rank'));
const RENDER_SCRIPT = path.join(EXT_DIR, 'scripts', 'render-role-leaderboard.js');

const FEATURE_NAME = 'The leaderboard ranks models on what survived and what the rework cost';
const QUALITY_THRESHOLD = 0.5;

function outcome(overrides) {
  return {
    taskId: 'coder-task-01-word-frequency',
    modelId: 'm',
    repetition: 1,
    ran: true,
    survived: true,
    reworkRounds: 0,
    qualityScore: 0.9,
    testsPassed: 9,
    testsTotal: 10,
    durationMs: 1000,
    costUsd: 0.05,
    tokens: { inputTokens: 100, outputTokens: 100 },
    ...overrides,
  };
}

function buildAggregate(modelId, outcomes) {
  return aggregateModelTrials({ id: modelId, provider: 'claude', model: modelId, label: modelId }, outcomes);
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl388-'));
}

function fakeDashboardShell(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-17T00:00:00Z',
    sourceSha: 'abc123',
    board: { active: [], paused: [], doneByMilestone: {} },
    notDoneCount: 0,
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown: [],
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts: { tickets: [], milestones: [] },
    },
    ...overrides,
  };
}

function fakeBenchmarkReport(ranking, models) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-17T00:00:00Z',
    taskIds: ['coder-task-01-word-frequency'],
    refusedTasks: [],
    qualityThreshold: QUALITY_THRESHOLD,
    qualityThresholdDescription: `A model is "cheapest acceptable" only if its mean quality score is >= ${QUALITY_THRESHOLD}.`,
    provenance: 'Each recorded run executes the configured provider CLI headlessly.',
    models,
    ranking,
  };
}

function renderFixture(dashboard) {
  const dir = mkTmp();
  const fixturePath = path.join(dir, 'backlog.json');
  fs.writeFileSync(fixturePath, JSON.stringify(dashboard));
  const out = execFileSync('node', [RENDER_SCRIPT, fixturePath], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  // model-a survived only one of its two runs (the other scored 0, exactly
  // as runTrial.ts guarantees for a non-surviving diff) and needed one
  // round of rework on the run that did survive; its 0.4 mean quality still
  // beats model-b's clean-but-lower-scoring 0.3, so model-a is named "Best"
  // and its survival/rework signals reach the rendered leaderboard
  // (scenario 03), not just its ranking category (scenario 01).
  registry.defineScoped(
    /^the benchmark has run its battery through the pipeline$/,
    (ctx) => {
      ctx.models = [
        buildAggregate('model-a', [
          outcome({ modelId: 'model-a', survived: true, qualityScore: 0.8, costUsd: 0.05, reworkRounds: 1 }),
          outcome({ modelId: 'model-a', survived: false, qualityScore: 0, costUsd: 0.05, reworkRounds: 0 }),
        ]),
        buildAggregate('model-b', [
          outcome({ modelId: 'model-b', survived: true, qualityScore: 0.3, costUsd: 0.02, reworkRounds: 0 }),
          outcome({ modelId: 'model-b', survived: true, qualityScore: 0.3, costUsd: 0.02, reworkRounds: 0 }),
        ]),
      ];
    },
    FEATURE_NAME
  );

  // ── the-ranking-consumes-survival-and-rework-01 ─────────────────────
  registry.defineScoped(
    /^each model's quality reflects the work that survived the pipeline$/,
    (ctx) => {
      const modelA = ctx.models.find((m) => m.modelId === 'model-a');
      // mean of [0.8 (survived), 0 (did not survive)] - proves the aggregate
      // is built from the per-run, survival-gated score, never from only the
      // runs that happened to survive (which would read 0.8) nor from a raw
      // test count blind to survival.
      if (Math.abs(modelA.meanQuality - 0.4) > 1e-9) {
        throw new Error(`expected model-a's quality to reflect the run that did not survive the pipeline, got meanQuality=${modelA.meanQuality}`);
      }
    },
    FEATURE_NAME
  );

  // ── the-ranking-consumes-survival-and-rework-02 ─────────────────────
  registry.defineScoped(
    /^one model's diff was cheap to produce but needed a lot of rework$/,
    (ctx) => {
      ctx.cheapButReworked = buildAggregate('cheap', [outcome({ modelId: 'cheap', qualityScore: 0.9, costUsd: 0.05, reworkRounds: 3 })]);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^another model's diff cost more to produce but needed none$/,
    (ctx) => {
      ctx.costlyButClean = buildAggregate('costly', [outcome({ modelId: 'costly', qualityScore: 0.85, costUsd: 0.15, reworkRounds: 0 })]);
      ctx.models = [ctx.cheapButReworked, ctx.costlyButClean];
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the model that needed the rework is charged for it$/,
    (ctx) => {
      if (ctx.ranking.bestByValue !== 'costly') {
        throw new Error(`expected the clean, pricier-up-front model to win best value once rework is charged, got bestByValue=${ctx.ranking.bestByValue}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it is not named best value on the strength of its first diff alone$/,
    (ctx) => {
      if (ctx.ranking.bestByValue === 'cheap') {
        throw new Error('expected the cheap-but-reworked model NOT to be named best value on the strength of its first diff alone');
      }
    },
    FEATURE_NAME
  );

  // ── the-ranking-consumes-survival-and-rework-04 ─────────────────────
  registry.defineScoped(
    /^every model survived equally and needed the same rework$/,
    (ctx) => {
      ctx.models = ['tied-1', 'tied-2', 'tied-3'].map((id, i) =>
        buildAggregate(id, [outcome({ modelId: id, qualityScore: 0.8, survived: true, reworkRounds: 1, costUsd: 0.05 * (i + 1) })])
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no model is named best by quality$/,
    (ctx) => {
      if (ctx.ranking.bestByQuality !== null) {
        throw new Error(`expected no bestByQuality winner among equally-surviving, equally-reworked models, got ${ctx.ranking.bestByQuality}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the benchmark reports that it could not discriminate between the models$/,
    (ctx) => {
      if (!ctx.ranking.couldNotDiscriminateReason) {
        throw new Error('expected a stated could-not-discriminate reason, got none');
      }
    },
    FEATURE_NAME
  );

  // ── shared When: 01/02/04 ────────────────────────────────────────────
  registry.defineScoped(
    /^the benchmark ranks the models$/,
    (ctx) => {
      ctx.ranking = rankModels(ctx.models, QUALITY_THRESHOLD);
    },
    FEATURE_NAME
  );

  // ── the-ranking-consumes-survival-and-rework-03 ─────────────────────
  registry.defineScoped(
    /^the human looks at the leaderboard$/,
    (ctx) => {
      const ranking = rankModels(ctx.models, QUALITY_THRESHOLD);
      const dashboard = fakeDashboardShell({ roleLeaderboard: fakeBenchmarkReport(ranking, ctx.models) });
      ctx.rendered = renderFixture(dashboard);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the leaderboard ranks the models on what survived and what the rework cost$/,
    (ctx) => {
      const text = ctx.rendered.text;
      if (!/Survived/.test(text) || !/Rework/.test(text)) {
        throw new Error(`expected the leaderboard to present Survived and Rework columns, got: ${text}`);
      }
      // model-a is named "Best" by quality in this fixture (0.4 > model-b's
      // 0.3), so its OWN survival/rework signals - not just the column
      // headers - must reach the rendered markup.
      const modelA = ctx.models.find((m) => m.modelId === 'model-a');
      const survivalPct = Math.round(modelA.survivalRate * 100) + '%';
      if (!text.includes(survivalPct)) {
        throw new Error(`expected model-a's own survival rate (${survivalPct}) rendered on the leaderboard, got: ${text}`);
      }
      const reworkText = modelA.meanReworkRounds.toFixed(1) + ' rounds';
      if (!text.includes(reworkText)) {
        throw new Error(`expected model-a's own mean rework rounds (${reworkText}) rendered on the leaderboard, got: ${text}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
