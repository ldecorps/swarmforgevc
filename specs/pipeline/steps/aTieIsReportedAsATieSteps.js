'use strict';

// BL-385: step handlers for "The benchmark reports a tie as a tie, never
// as a winner". Drives the REAL compiled rankModels (extension/out/
// benchmark/rank) for the rank-only scenarios (01/02/03/05), and the REAL
// pwa/index.html + pwa/app.js via extension/scripts/render-role-
// leaderboard.js (jsdom) for the leaderboard-presentation scenario (04) -
// mirrors roleLeaderboardSurfaceSteps.js's own fixture/render pattern, no
// reimplementation of either.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { rankModels } = require(path.join(EXT_DIR, 'out', 'benchmark', 'rank'));
const RENDER_SCRIPT = path.join(EXT_DIR, 'scripts', 'render-role-leaderboard.js');

function agg(overrides) {
  return {
    modelId: 'm',
    provider: 'claude',
    model: 'x',
    label: 'x',
    excluded: false,
    exclusionReason: null,
    repetitions: 1,
    meanQuality: 0,
    qualityStdDev: 0,
    meanCostUsd: null,
    costStdDev: null,
    meanDurationMs: 0,
    meanTokens: null,
    runs: [],
    ...overrides,
  };
}

function tiedModels() {
  return [
    agg({ modelId: 'claude-haiku', label: 'Claude Haiku 4.5', meanQuality: 1, meanCostUsd: 0.04 }),
    agg({ modelId: 'claude-sonnet', label: 'Claude Sonnet 4.5', meanQuality: 1, meanCostUsd: 0.5 }),
    agg({ modelId: 'claude-opus', label: 'Claude Opus 4.8', meanQuality: 1, meanCostUsd: 1.5 }),
  ];
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl385-'));
}

function fakeDashboardShell(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-14T00:00:00Z',
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
    generatedAtIso: '2026-07-14T00:00:00Z',
    taskId: 'coder-task-01-word-frequency',
    qualityThreshold: 0.8,
    qualityThresholdDescription: 'A model is "cheapest acceptable" only if its mean quality score is >= 0.8.',
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
  registry.define(/^the benchmark has scored every model$/, () => {
    // Framing only - each scenario's own Given below builds its own
    // concrete fixture.
  });

  // ── a-tie-is-reported-as-a-tie-01/03/04/05 (shared Given) ───────────────
  registry.define(/^every model reached the same quality$/, (ctx) => {
    ctx.models = tiedModels();
  });

  // ── a-tie-is-reported-as-a-tie-02 ───────────────────────────────────────
  registry.define(/^one model reached a higher quality than every other$/, (ctx) => {
    ctx.models = [
      agg({ modelId: 'winner', label: 'Winner', meanQuality: 0.95, meanCostUsd: 0.5 }),
      agg({ modelId: 'runner-up-1', label: 'Runner Up 1', meanQuality: 0.8, meanCostUsd: 0.1 }),
      agg({ modelId: 'runner-up-2', label: 'Runner Up 2', meanQuality: 0.8, meanCostUsd: 0.2 }),
    ];
  });

  // ── shared When: 01/02/03 ────────────────────────────────────────────
  registry.define(/^the benchmark ranks the models$/, (ctx) => {
    ctx.ranking = rankModels(ctx.models, 0.8);
  });

  // ── a-tie-is-reported-as-a-tie-01 ───────────────────────────────────────
  registry.define(/^no model is named best by quality$/, (ctx) => {
    if (ctx.ranking.bestByQuality !== null) {
      throw new Error(`expected no bestByQuality winner, got ${ctx.ranking.bestByQuality}`);
    }
  });

  registry.define(/^the benchmark reports that it could not discriminate between the models$/, (ctx) => {
    if (!ctx.ranking.couldNotDiscriminateReason) {
      throw new Error('expected a stated could-not-discriminate reason, got none');
    }
  });

  // ── a-tie-is-reported-as-a-tie-02 (the antonym pair - distinct handlers) ─
  registry.define(/^that model is named best by quality$/, (ctx) => {
    if (ctx.ranking.bestByQuality !== 'winner') {
      throw new Error(`expected "winner" named best by quality, got ${ctx.ranking.bestByQuality}`);
    }
  });

  registry.define(/^the benchmark does not report that it could not discriminate between the models$/, (ctx) => {
    if (ctx.ranking.couldNotDiscriminateReason !== null) {
      throw new Error(`expected no could-not-discriminate reason, got ${JSON.stringify(ctx.ranking.couldNotDiscriminateReason)}`);
    }
  });

  // ── a-tie-is-reported-as-a-tie-03 ───────────────────────────────────────
  registry.define(/^the best-value answer is reported as a ranking on cost alone$/, (ctx) => {
    if (!ctx.ranking.bestByValueRankedByCostAlone) {
      throw new Error('expected bestByValueRankedByCostAlone true under a quality tie');
    }
  });

  // ── a-tie-is-reported-as-a-tie-04 ───────────────────────────────────────
  registry.define(/^the human looks at the leaderboard$/, (ctx) => {
    const ranking = rankModels(ctx.models, 0.8);
    const dashboard = fakeDashboardShell({ roleLeaderboard: fakeBenchmarkReport(ranking, ctx.models) });
    ctx.rendered = renderFixture(dashboard);
  });

  registry.define(/^the leaderboard reports that the benchmark could not discriminate$/, (ctx) => {
    if (!/could not discriminate/i.test(ctx.rendered.text)) {
      throw new Error(`expected the leaderboard text to state it could not discriminate, got: ${ctx.rendered.text}`);
    }
  });

  registry.define(/^the leaderboard names no best model$/, (ctx) => {
    const text = ctx.rendered.text;
    const bestIdx = text.indexOf('Best:');
    const bestValueIdx = text.indexOf('Best value');
    if (bestIdx === -1 || bestValueIdx === -1 || bestValueIdx <= bestIdx) {
      throw new Error(`expected a "Best:" reason segment before the "Best value" row, got: ${text}`);
    }
    const bestSegment = text.slice(bestIdx, bestValueIdx);
    const labels = ctx.models.map((m) => m.label);
    if (labels.some((label) => bestSegment.includes(label))) {
      throw new Error(`expected no model label named in the "Best" segment, got: ${bestSegment}`);
    }
  });

  // ── a-tie-is-reported-as-a-tie-05 ───────────────────────────────────────
  registry.define(/^the benchmark ranks the models in one order$/, (ctx) => {
    ctx.forwardRanking = rankModels(ctx.models, 0.8);
  });

  registry.define(/^the benchmark ranks the same models in a different order$/, (ctx) => {
    ctx.reversedRanking = rankModels([...ctx.models].reverse(), 0.8);
  });

  registry.define(/^both rankings report the same result$/, (ctx) => {
    if (JSON.stringify(ctx.forwardRanking) !== JSON.stringify(ctx.reversedRanking)) {
      throw new Error(`expected the same ranking regardless of array order, got ${JSON.stringify(ctx.forwardRanking)} vs ${JSON.stringify(ctx.reversedRanking)}`);
    }
  });
}

module.exports = { registerSteps };
