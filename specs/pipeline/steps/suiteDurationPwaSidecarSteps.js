'use strict';

// BL-290: step handlers for "Suite-test duration rides a committed sidecar
// onto the static PWA". Drives the REAL compiled emit-cost-health-sidecar.js
// CLI (BL-272's own emitter, extended by BL-290 to also carry
// suiteDurationTrend), the REAL compiled computeBacklogDashboard (the
// fold), and the REAL pwa/app.js in jsdom via render-suite-duration.js
// (BL-290's own harness, mirroring render-burndown-chart.js's pattern) -
// no live swarm, no network, no real clock (fixture .test-durations.jsonl
// records are seeded with fixed ISO timestamps, never Date.now()).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const CLI_PATH = path.join(EXT_DIR, 'out', 'tools', 'emit-cost-health-sidecar.js');
const RENDER_SCRIPT = path.join(EXT_DIR, 'scripts', 'render-suite-duration.js');
const { computeBacklogDashboard } = require(path.join(EXT_DIR, 'out', 'metrics', 'backlogDashboard'));

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-suite-duration-pwa-')));
}

function initGitFixture() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'briefings'), { recursive: true });
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\ncoder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  return root;
}

function seedLocalSuiteDurationRecords(root) {
  const file = path.join(root, 'extension', '.test-durations.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [
    { finished_at: '2026-07-10T12:00:00Z', duration_ms: 30000 },
    { finished_at: '2026-07-11T12:00:00Z', duration_ms: 45000 },
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

function committedSidecar(root) {
  const dir = path.join(root, 'docs', 'briefings');
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.json'));
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

function writeAndCommitSidecar(root, suiteDurationTrend) {
  const dateIso = '2026-07-11';
  const filePath = path.join(root, 'docs', 'briefings', `${dateIso}.json`);
  const sidecar = { schemaVersion: 1, dateIso, agents: [], topExpensiveTickets: [], flowBalance: {}, reliability: {}, resourceAnomalies: [], suiteDurationTrend };
  fs.writeFileSync(filePath, JSON.stringify(sidecar));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed sidecar']);
  return sidecar;
}

function renderSuiteDuration(backlogFixture) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-suite-duration-render-'));
  const fixturePath = path.join(tmpDir, 'backlog.json');
  fs.writeFileSync(fixturePath, JSON.stringify(backlogFixture));
  const out = execFileSync('node', [RENDER_SCRIPT, fixturePath], { encoding: 'utf8' });
  return JSON.parse(out);
}

function baseBacklogFixture(suiteDurationTrend) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-11T12:00:00Z',
    sourceSha: 'abc123',
    board: { active: [], paused: [], doneByMilestone: {} },
    notDoneCount: 0,
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown: [],
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts: { tickets: [], milestones: [], throughputPerDay: 0 },
      ...(suiteDurationTrend ? { suiteDurationTrend } : {}),
    },
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^suite-test duration is snapshotted into the committed daily sidecar that the backlog projection reads$/, () => {
    // Framing only - each scenario's own Given builds its own fixture.
  });

  // ── suite-duration-pwa-01 ────────────────────────────────────────────
  registry.define(/^a run with local suite-duration records$/, (ctx) => {
    ctx.root = initGitFixture();
    seedLocalSuiteDurationRecords(ctx.root);
  });

  registry.define(/^the daily sidecar is emitted$/, (ctx) => {
    ctx.emitOutput = execFileSync('node', [CLI_PATH], { cwd: ctx.root, encoding: 'utf8' });
    ctx.sidecar = committedSidecar(ctx.root);
  });

  // This exact wording is ALSO suite-duration-pwa-02's own Given (below) -
  // the registry matches step TEXT regardless of Given/When/Then keyword,
  // so this one handler covers both roles: assert when a prior "the daily
  // sidecar is emitted" step already populated ctx.sidecar (pwa-01's own
  // Then), or seed a fresh committed sidecar fixture when it didn't
  // (pwa-02's own Given, which needs no real emit CLI run - it starts from
  // "the committed sidecar carries the trend" as a given fact).
  registry.define(/^the committed sidecar carries the suite-duration trend$/, (ctx) => {
    if (!ctx.sidecar) {
      ctx.root = initGitFixture();
      ctx.sidecar = writeAndCommitSidecar(ctx.root, {
        hasLocalData: true,
        dailySeries: [{ periodStart: '2026-07-11T00:00:00Z', value: 45000 }],
        trend: { direction: 'flat', delta: 0, currentValue: 45000, priorValue: 45000, series: [] },
        warn: false,
      });
      return;
    }
    if (!ctx.sidecar.suiteDurationTrend || ctx.sidecar.suiteDurationTrend.hasLocalData !== true) {
      throw new Error(`expected the committed sidecar to carry a real suite-duration trend, got: ${JSON.stringify(ctx.sidecar.suiteDurationTrend)}`);
    }
  });

  // ── suite-duration-pwa-02 ────────────────────────────────────────────
  registry.define(/^the backlog projection is built$/, (ctx) => {
    ctx.dashboard = computeBacklogDashboard(ctx.root, [{ role: 'coder', worktreePath: ctx.root }]);
  });

  registry.define(/^its metrics include the trend from that sidecar$/, (ctx) => {
    if (JSON.stringify(ctx.dashboard.metrics.suiteDurationTrend) !== JSON.stringify(ctx.sidecar.suiteDurationTrend)) {
      throw new Error(
        `expected the dashboard's metrics.suiteDurationTrend to equal the committed sidecar's own field, got: ${JSON.stringify(ctx.dashboard.metrics.suiteDurationTrend)}`
      );
    }
  });

  // ── suite-duration-pwa-03/04 ─────────────────────────────────────────
  registry.define(/^the projection has a suite-duration trend to show$/, (ctx) => {
    ctx.suiteDurationTrend = {
      hasLocalData: true,
      dailySeries: [
        { periodStart: '2026-07-10T00:00:00Z', value: 30000 },
        { periodStart: '2026-07-11T00:00:00Z', value: 45000 },
      ],
      trend: { direction: 'up', delta: 15000, currentValue: 45000, priorValue: 30000, series: [] },
      warn: false,
    };
  });

  registry.define(/^the dashboard renders$/, (ctx) => {
    ctx.rendered = renderSuiteDuration(baseBacklogFixture(ctx.suiteDurationTrend));
  });

  registry.define(/^the PWA shows the latest suite duration and its trend$/, (ctx) => {
    if (ctx.rendered.hidden || !/45s latest ▲/.test(ctx.rendered.text)) {
      throw new Error(`expected the latest duration and trend shown, got: ${JSON.stringify(ctx.rendered)}`);
    }
  });

  // ── suite-duration-pwa-04 ────────────────────────────────────────────
  registry.define(/^the projection reports the suite duration as regressing$/, (ctx) => {
    ctx.suiteDurationTrend = {
      hasLocalData: true,
      dailySeries: [
        { periodStart: '2026-07-10T00:00:00Z', value: 30000 },
        { periodStart: '2026-07-11T00:00:00Z', value: 200000 },
      ],
      trend: { direction: 'up', delta: 170000, currentValue: 200000, priorValue: 30000, series: [] },
      warn: true,
    };
  });

  registry.define(/^the PWA marks it as a regression$/, (ctx) => {
    if (ctx.rendered.hidden || !/WARN/.test(ctx.rendered.text)) {
      throw new Error(`expected the PWA to mark the regression (WARN), got: ${JSON.stringify(ctx.rendered)}`);
    }
  });

  // ── suite-duration-pwa-05 ────────────────────────────────────────────
  registry.define(/^the projection has no local suite-duration data$/, (ctx) => {
    ctx.suiteDurationTrend = { hasLocalData: false, dailySeries: [], trend: { direction: 'unknown' }, warn: false };
  });

  registry.define(/^the PWA shows a no-data suite-duration readout without any live fetch$/, (ctx) => {
    if (ctx.rendered.hidden || !/no local data/.test(ctx.rendered.text)) {
      throw new Error(`expected a visible no-data readout, got: ${JSON.stringify(ctx.rendered)}`);
    }
    const STATIC_COMMITTED_URLS = ['./backlog.json', './docs-tree.json', './recert-batch.json'];
    for (const url of ctx.rendered.fetchCalls) {
      if (!STATIC_COMMITTED_URLS.includes(url)) {
        throw new Error(`expected only static committed fetches (the two-surface rule), got a live fetch to: ${url}`);
      }
    }
  });
}

module.exports = { registerSteps };
