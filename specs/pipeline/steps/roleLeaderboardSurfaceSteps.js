'use strict';

// BL-347: step handlers for "The Role Leaderboard reaches the human on the
// backlog dashboard". Drives the REAL compiled backlogDashboard.js
// (extension/out/metrics/backlogDashboard) for the generator half, and the
// REAL pwa/index.html + pwa/app.js via extension/scripts/
// render-role-leaderboard.js (jsdom, resolved against extension's own
// node_modules - mirrors render-suite-duration.js's own established
// pattern) for the presentation half - no reimplementation of either here.
//
// "The dashboard is generated" always computes from a FRESH CLONE of the
// fixture repo, never the working tree itself - the same constitutional
// posture backlog-dashboard.yml's own CI run has (a fresh checkout only
// ever contains committed content). This makes role-leaderboard-surface-06
// (rides only committed data) fall out of the SAME step every other
// scenario already uses, rather than a special case: an uncommitted report
// file is simply never cloned, so it cannot appear.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { computeBacklogDashboard } = require(path.join(EXT_DIR, 'out', 'metrics', 'backlogDashboard'));
const RENDER_SCRIPT = path.join(EXT_DIR, 'scripts', 'render-role-leaderboard.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl347-acceptance-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

function mkGitRepo() {
  const target = mkTmp();
  git(target, ['init', '-q']);
  git(target, ['config', 'user.email', 't@t']);
  git(target, ['config', 'user.name', 't']);
  mkdirp(path.join(target, 'backlog', 'active'));
  git(target, ['add', '.']);
  git(target, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return target;
}

function writeAndCommitReport(target, dateIso, report) {
  const dir = path.join(target, 'docs', 'benchmarks');
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, `${dateIso}.json`), JSON.stringify(report));
  git(target, ['add', '.']);
  git(target, ['commit', '-q', '-m', 'benchmark report']);
}

function fakeBenchmarkReport(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-13T16:26:31.300Z',
    taskId: 'coder-task-01-word-frequency',
    qualityThreshold: 0.8,
    qualityThresholdDescription: 'A model is "cheapest acceptable" only if its mean quality score is >= 0.8.',
    provenance: 'Each recorded run executes the configured provider CLI headlessly.',
    models: [
      {
        modelId: 'claude-haiku',
        provider: 'claude',
        model: 'haiku',
        label: 'Claude Haiku 4.5',
        excluded: false,
        exclusionReason: null,
        repetitions: 2,
        meanQuality: 1,
        qualityStdDev: 0,
        meanCostUsd: 0.0431,
        costStdDev: 0.0009,
        meanDurationMs: 23420,
        meanTokens: 1762.5,
        runs: [],
      },
    ],
    ranking: { bestByQuality: 'claude-haiku', bestByValue: 'claude-haiku', cheapestAcceptable: 'claude-haiku', noAcceptableModelReason: null },
    ...overrides,
  };
}

function fakeDashboardShell(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-13T18:00:00Z',
    sourceSha: 'abc123def456',
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

function renderFixture(dashboard, mode) {
  const dir = mkTmp();
  const fixturePath = path.join(dir, 'backlog.json');
  fs.writeFileSync(fixturePath, JSON.stringify(dashboard));
  const args = mode ? [RENDER_SCRIPT, fixturePath, mode] : [RENDER_SCRIPT, fixturePath];
  const out = execFileSync('node', args, { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the backlog dashboard is generated from committed repository state$/, () => {
    // Framing only - each scenario's own Given below builds its own
    // concrete fixture, per this suite's established sibling convention.
  });

  // ── role-leaderboard-surface-01 ─────────────────────────────────────
  registry.define(/^a committed benchmark report ranking several models for a role$/, (ctx) => {
    ctx.target = mkGitRepo();
    ctx.report = fakeBenchmarkReport();
    writeAndCommitReport(ctx.target, '2026-07-13', ctx.report);
  });

  registry.define(/^the leaderboard shows that role's best, best value, and cheapest acceptable model$/, (ctx) => {
    const lb = ctx.dashboard.roleLeaderboard;
    if (!lb) {
      throw new Error('expected a roleLeaderboard on the generated dashboard');
    }
    ['bestByQuality', 'bestByValue', 'cheapestAcceptable'].forEach((key) => {
      const modelId = lb.ranking[key];
      if (!modelId) {
        throw new Error(`expected ranking.${key} to name a model, got null`);
      }
      if (!lb.models.some((m) => m.modelId === modelId)) {
        throw new Error(`ranking.${key} names ${modelId} but no such model is in models[]`);
      }
    });
  });

  // ── role-leaderboard-surface-02 ─────────────────────────────────────
  registry.define(/^a committed benchmark report that states its quality threshold$/, (ctx) => {
    ctx.target = mkGitRepo();
    ctx.report = fakeBenchmarkReport({
      qualityThresholdDescription: 'A model is acceptable only if its mean quality score is >= 0.8, stated explicitly.',
    });
    writeAndCommitReport(ctx.target, '2026-07-13', ctx.report);
  });

  registry.define(/^the leaderboard shows the quality threshold the cheapest acceptable model had to clear$/, (ctx) => {
    const lb = ctx.dashboard.roleLeaderboard;
    if (!lb.qualityThresholdDescription) {
      throw new Error('expected a stated (non-empty) quality threshold description');
    }
    if (lb.qualityThresholdDescription !== ctx.report.qualityThresholdDescription) {
      throw new Error('expected the leaderboard to carry the exact threshold description from the committed report');
    }
  });

  // ── role-leaderboard-surface-03 ─────────────────────────────────────
  registry.define(/^a committed benchmark report produced by a known run$/, (ctx) => {
    ctx.target = mkGitRepo();
    ctx.report = fakeBenchmarkReport({ generatedAtIso: '2026-07-12T09:30:00.000Z' });
    writeAndCommitReport(ctx.target, '2026-07-12', ctx.report);
  });

  registry.define(/^the leaderboard shows when that report was produced$/, (ctx) => {
    if (ctx.dashboard.roleLeaderboard.generatedAtIso !== ctx.report.generatedAtIso) {
      throw new Error(`expected the report's own generatedAtIso preserved, got ${ctx.dashboard.roleLeaderboard.generatedAtIso}`);
    }
  });

  // ── role-leaderboard-surface-04 ─────────────────────────────────────
  registry.define(/^a committed benchmark report that records run-to-run variance$/, (ctx) => {
    ctx.target = mkGitRepo();
    ctx.report = fakeBenchmarkReport();
    ctx.report.models[0].qualityStdDev = 0.05;
    ctx.report.models[0].costStdDev = 0.002;
    writeAndCommitReport(ctx.target, '2026-07-13', ctx.report);
  });

  registry.define(/^the leaderboard shows that variance alongside the ranking$/, (ctx) => {
    const lb = ctx.dashboard.roleLeaderboard;
    const winner = lb.models.find((m) => m.modelId === lb.ranking.bestByQuality);
    if (typeof winner.qualityStdDev !== 'number' || typeof winner.costStdDev !== 'number') {
      throw new Error('expected variance (std-dev) fields carried alongside the ranked model, so a real difference can be told from noise');
    }
  });

  // ── role-leaderboard-surface-05 ─────────────────────────────────────
  registry.define(/^no benchmark report has been committed$/, (ctx) => {
    ctx.target = mkGitRepo();
  });

  registry.define(/^the dashboard carries no leaderboard$/, (ctx) => {
    if (Object.prototype.hasOwnProperty.call(ctx.dashboard, 'roleLeaderboard')) {
      throw new Error('expected no roleLeaderboard field on the dashboard when nothing has been committed');
    }
  });

  registry.define(/^the leaderboard section is not shown empty$/, (ctx) => {
    const rendered = renderFixture(ctx.dashboard);
    if (!rendered.hidden) {
      throw new Error('expected the Role Leaderboard section hidden entirely, not shown empty, when the dashboard carries no leaderboard');
    }
  });

  // ── role-leaderboard-surface-06 ─────────────────────────────────────
  registry.define(/^a benchmark result that exists only as live machine-local state$/, (ctx) => {
    ctx.target = mkGitRepo();
    ctx.report = fakeBenchmarkReport();
    const dir = path.join(ctx.target, 'docs', 'benchmarks');
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, '2026-07-13.json'), JSON.stringify(ctx.report));
    // Deliberately never committed - this file exists only in the working
    // tree, exactly like a benchmark run's own raw output before BL-340's
    // writer commits it.
  });

  registry.define(/^that result does not appear in the dashboard$/, (ctx) => {
    if (Object.prototype.hasOwnProperty.call(ctx.dashboard, 'roleLeaderboard')) {
      throw new Error('expected the live-only, never-committed benchmark result to be absent from a dashboard generated from a fresh checkout');
    }
  });

  // ── When: shared by every scenario above ────────────────────────────
  registry.define(/^the dashboard is generated$/, (ctx) => {
    const clone = mkTmp();
    git(clone, ['clone', '-q', ctx.target, '.']);
    ctx.dashboard = computeBacklogDashboard(clone, [], Date.parse('2026-07-13T18:00:00Z'));
  });

  // ── role-leaderboard-surface-07 ─────────────────────────────────────
  registry.define(/^the dashboard is showing the leaderboard$/, (ctx) => {
    ctx.dashboardFixture = fakeDashboardShell({ roleLeaderboard: fakeBenchmarkReport() });
  });

  registry.define(/^the human collapses the leaderboard section and returns later$/, (ctx) => {
    ctx.collapseResult = renderFixture(ctx.dashboardFixture, 'collapse-reopen');
  });

  registry.define(/^the leaderboard section is still collapsed$/, (ctx) => {
    if (ctx.collapseResult.bodyDisplayAfterReopen !== 'none') {
      throw new Error(`expected the leaderboard section body still collapsed after reopening, got "${ctx.collapseResult.bodyDisplayAfterReopen}"`);
    }
  });
}

module.exports = { registerSteps };
