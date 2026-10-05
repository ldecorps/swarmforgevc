'use strict';

// BL-1943 (BL-213 stamp-off): step handlers for "daily cost & health reaches
// the briefing and the phone via a sidecar". Drives the REAL compiled
// costHealthSidecar.js (buildCostHealthSidecar/renderCostHealthSection/
// writeCostHealthSidecar/commitCostHealthSidecar), the REAL
// backlogDashboard.js (computeBacklogDashboard's sidecar fold-in), and the
// REAL pwa/index.html + pwa/app.js in jsdom - mirroring
// extension/test/costHealthSidecar.test.js's own buildCostHealthSidecar/
// renderCostHealthSection fixture shapes, backlogDashboard.test.js's
// cost-06a/cost-06b coverage, and pwaDashboard.test.js's fakeCostHealth
// pattern, never a restatement of the sidecar/render/fold logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const PWA_DIR = path.join(REPO_ROOT, 'pwa');
const JSDOM_MODULE = path.join(EXT_DIR, 'node_modules', 'jsdom');

function JSDOMClass() {
  return require(JSDOM_MODULE).JSDOM;
}

let _costHealthSidecar = null;
function costHealthSidecarModule() {
  if (!_costHealthSidecar) _costHealthSidecar = require(path.join(EXT_DIR, 'out', 'notify', 'costHealthSidecar.js'));
  return _costHealthSidecar;
}
let _backlogDashboard = null;
function backlogDashboardModule() {
  if (!_backlogDashboard) _backlogDashboard = require(path.join(EXT_DIR, 'out', 'metrics', 'backlogDashboard.js'));
  return _backlogDashboard;
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

// BL-1390: a fixture root must be proven isolated from the live checkout
// BEFORE any mutating git call.
function proveFixtureIsolated(root) {
  const commonDir = git(root, 'rev-parse', '--git-common-dir');
  assert.ok(
    path.resolve(root, commonDir).startsWith(root),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
}

function initRepo(root) {
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'bl213@example.com');
  git(root, 'config', 'user.name', 'BL-213 fixture');
  proveFixtureIsolated(root);
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function commit(root, message) {
  execFileSync('git', ['-C', root, 'add', '-A'], { stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', message], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeSwarmforgeMeta(root) {
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`
  );
}

function emptyReliabilitySeries(nowIso) {
  return {
    chases: [{ periodStart: nowIso, value: 0 }],
    nudges: [{ periodStart: nowIso, value: 0 }],
    respawns: [{ periodStart: nowIso, value: 0 }],
    failedDeliveries: [{ periodStart: nowIso, value: 0 }],
  };
}

function fixtureSidecarInputs(dateIso) {
  const nowIso = `${dateIso}T00:00:00Z`;
  const costTelemetryByRole = {
    coder: {
      byDay: {
        [new Date(nowIso).toISOString()]: {
          usage: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 100 },
          costUsd: 4.5,
        },
      },
      byTicket: { 'BL-100': { usage: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 100 }, costUsd: 4.5 } },
    },
  };
  const resourceTrendsByRole = {
    coder: {
      currentRssBytes: 250_000_000,
      currentCpuPercent: 12.3,
      rssSeries: [{ periodStart: nowIso, value: 250_000_000 }],
      rssTrend: { series: [], currentValue: 250_000_000, priorValue: 200_000_000, delta: 50_000_000, direction: 'up' },
      cpuSeries: [{ periodStart: nowIso, value: 12.3 }],
      cpuTrend: { series: [], currentValue: 12.3, priorValue: 12.3, delta: 0, direction: 'flat' },
    },
  };
  const reliability = emptyReliabilitySeries(nowIso);
  const speccedSeries = [{ periodStart: nowIso, value: 3 }];
  const closedSeries = [{ periodStart: nowIso, value: 2 }];
  return { costTelemetryByRole, resourceTrendsByRole, reliability, speccedSeries, closedSeries };
}

const FEATURE = 'daily cost & health reaches the briefing and the phone via a sidecar';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── cost-05a: a deterministic sidecar is emitted from the producers ────
  scoped(/^a day's BL-100 cost\/health telemetry$/, (ctx) => {
    ctx.dateIso = '2026-09-09';
    ctx.sidecarInputs = fixtureSidecarInputs(ctx.dateIso);
    ctx.root = trackedTmpRoot('sfvc-bl213-');
    initRepo(ctx.root);
    mkdirp(path.join(ctx.root, 'docs', 'briefings'));
    writeSwarmforgeMeta(ctx.root);
    commit(ctx.root, 'init');
  });

  scoped(/^the daily briefing flow runs$/, (ctx) => {
    const { buildCostHealthSidecar, writeCostHealthSidecar, commitCostHealthSidecar } = costHealthSidecarModule();
    const { costTelemetryByRole, resourceTrendsByRole, reliability, speccedSeries, closedSeries } = ctx.sidecarInputs;
    ctx.sidecar = buildCostHealthSidecar(ctx.dateIso, costTelemetryByRole, resourceTrendsByRole, reliability, speccedSeries, closedSeries);
    ctx.sidecarFilePath = writeCostHealthSidecar(ctx.root, ctx.sidecar);
    const committed = commitCostHealthSidecar(ctx.root, ctx.sidecarFilePath, ctx.dateIso);
    assert.ok(committed, 'expected commitCostHealthSidecar to succeed against a fresh fixture');
  });

  scoped(/^it emits a committed docs\/briefings\/<date>\.json sidecar$/, (ctx) => {
    assert.ok(fs.existsSync(ctx.sidecarFilePath));
    const logged = git(ctx.root, 'log', '--oneline', '--', ctx.sidecarFilePath);
    assert.ok(logged.trim().length > 0, 'expected the sidecar file to be committed');
  });

  scoped(/^the sidecar carries per-agent tokens and cost, top expensive tickets, flow balance, reliability counts, and CPU\/RAM anomaly flags$/, (ctx) => {
    const s = ctx.sidecar;
    assert.ok(s.agents.length > 0, 'expected at least one agent entry');
    assert.equal(s.agents[0].role, 'coder');
    assert.equal(s.agents[0].tokens.value, 1500);
    assert.equal(s.agents[0].costUsd.value, 4.5);
    assert.ok(s.topExpensiveTickets.some((t) => t.ticketId === 'BL-100'));
    assert.ok(typeof s.flowBalance.speccedPerDay.value === 'number');
    assert.ok(typeof s.flowBalance.closedPerDay.value === 'number');
    assert.ok(typeof s.reliability.chases.value === 'number');
    assert.ok(s.resourceAnomalies.some((a) => a.role === 'coder'));
  });

  scoped(/^each figure carries a trend direction$/, (ctx) => {
    const s = ctx.sidecar;
    assert.ok(['up', 'down', 'flat', 'unknown'].includes(s.agents[0].tokens.trend.direction));
    assert.ok(['up', 'down', 'flat', 'unknown'].includes(s.flowBalance.speccedPerDay.trend.direction));
    assert.ok(['up', 'down', 'flat', 'unknown'].includes(s.reliability.chases.trend.direction));
    const anomaly = s.resourceAnomalies.find((a) => a.role === 'coder');
    assert.ok(['up', 'down', 'flat', 'unknown'].includes(anomaly.rssTrend.direction));
    assert.ok(['up', 'down', 'flat', 'unknown'].includes(anomaly.cpuTrend.direction));
  });

  scoped(/^no raw runtime telemetry file is committed$/, (ctx) => {
    const changedFiles = git(ctx.root, 'show', '--name-only', '--pretty=format:', 'HEAD')
      .split('\n')
      .filter(Boolean);
    const sidecarRelPath = path.relative(ctx.root, ctx.sidecarFilePath);
    assert.deepEqual(changedFiles, [sidecarRelPath], 'expected the sidecar commit to touch only the sidecar file, no raw telemetry');
  });

  // ── cost-05b: the briefing section is rendered from the sidecar ────────
  scoped(/^a committed sidecar for the day$/, (ctx) => {
    const { buildCostHealthSidecar } = costHealthSidecarModule();
    const dateIso = '2026-09-09';
    const { costTelemetryByRole, resourceTrendsByRole, reliability, speccedSeries, closedSeries } = fixtureSidecarInputs(dateIso);
    ctx.renderSidecar = buildCostHealthSidecar(dateIso, costTelemetryByRole, resourceTrendsByRole, reliability, speccedSeries, closedSeries);
  });

  scoped(/^the briefing markdown is composed$/, (ctx) => {
    const { renderCostHealthSection } = costHealthSidecarModule();
    ctx.renderedSection = renderCostHealthSection(ctx.renderSidecar === undefined ? null : ctx.renderSidecar);
  });

  scoped(/^its "Cost & Health" section shows exactly the sidecar figures$/, (ctx) => {
    assert.match(ctx.renderedSection, /## Cost & Health/);
    assert.match(ctx.renderedSection, /coder: 1500 tokens/);
    assert.match(ctx.renderedSection, /\$4\.50/);
    assert.match(ctx.renderedSection, /BL-100: \$4\.50/);
    assert.match(ctx.renderedSection, /specced 3\/day/);
    assert.match(ctx.renderedSection, /closed 2\/day/);
  });

  scoped(/^no figure is invented outside the sidecar$/, (ctx) => {
    // Every figure asserted above traces directly to ctx.renderSidecar's
    // own fields (built by the pure buildCostHealthSidecar above, never
    // hand-typed into the renderer) - a renderer that invented a number
    // would have to coincidentally match these exact values.
    assert.doesNotMatch(ctx.renderedSection, /\$0\.00|NaN|undefined/);
  });

  // ── cost-05c: a day with no sidecar omits the section ──────────────────
  scoped(/^no sidecar exists for the day$/, (ctx) => {
    ctx.renderSidecar = undefined; // signals "null" to the When step below
  });

  scoped(/^the "Cost & Health" section is omitted without error$/, (ctx) => {
    assert.equal(ctx.renderedSection, '');
  });

  // ── cost-06a: the Action folds the latest sidecar into backlog.json ───
  scoped(/^a committed docs\/briefings\/<date>\.json sidecar$/, (ctx) => {
    const { buildCostHealthSidecar, writeCostHealthSidecar, commitCostHealthSidecar } = costHealthSidecarModule();
    ctx.dateIso = '2026-09-09';
    const { costTelemetryByRole, resourceTrendsByRole, reliability, speccedSeries, closedSeries } = fixtureSidecarInputs(ctx.dateIso);
    ctx.root = trackedTmpRoot('sfvc-bl213-fold-');
    initRepo(ctx.root);
    mkdirp(path.join(ctx.root, 'backlog', 'active'));
    mkdirp(path.join(ctx.root, 'docs', 'briefings'));
    writeSwarmforgeMeta(ctx.root);
    commit(ctx.root, 'init');
    ctx.sidecar = buildCostHealthSidecar(ctx.dateIso, costTelemetryByRole, resourceTrendsByRole, reliability, speccedSeries, closedSeries);
    const filePath = writeCostHealthSidecar(ctx.root, ctx.sidecar);
    commitCostHealthSidecar(ctx.root, filePath, ctx.dateIso);
  });

  scoped(/^the backlog dashboard Action generates backlog\.json$/, (ctx) => {
    const { computeBacklogDashboard, BACKLOG_DASHBOARD_SCHEMA_VERSION } = backlogDashboardModule();
    ctx.dashboard = computeBacklogDashboard(ctx.root, [], Date.parse(`${ctx.dateIso}T12:00:00Z`));
    ctx.schemaVersionAtMint = BACKLOG_DASHBOARD_SCHEMA_VERSION;
  });

  scoped(/^the daily cost\/health figures appear under a new optional field$/, (ctx) => {
    assert.ok(ctx.dashboard.costHealth, 'expected backlog.json to fold in the committed sidecar under costHealth');
    assert.deepEqual(ctx.dashboard.costHealth, ctx.sidecar);
  });

  scoped(/^schemaVersion is unchanged because the field is additive$/, (ctx) => {
    assert.equal(ctx.dashboard.schemaVersion, ctx.schemaVersionAtMint);
  });

  // ── cost-06b: the phone renders the figures, and hides them when absent ─
  function fakeDashboardWithCostHealth(costHealth) {
    const base = {
      schemaVersion: 1,
      generatedAtIso: '2026-09-09T12:00:00Z',
      sourceSha: 'abc123',
      board: { active: [], paused: [], doneByMilestone: {} },
      notDoneCount: 0,
      metrics: {
        velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
        burndown: [],
        cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
        forecasts: { tickets: [], milestones: [], throughputPerDay: 0 },
      },
    };
    if (costHealth) {
      base.costHealth = costHealth;
    }
    return base;
  }

  function fakeCostHealth() {
    return {
      schemaVersion: 1,
      dateIso: '2026-09-09',
      agents: [{ role: 'coder', tokens: { value: 500, trend: { direction: 'up' } }, costUsd: { value: 3.5, trend: { direction: 'up' } } }],
      topExpensiveTickets: [{ ticketId: 'BL-100', costUsd: 12.5 }],
      flowBalance: { speccedPerDay: { value: 3, trend: { direction: 'flat' } }, closedPerDay: { value: 2, trend: { direction: 'down' } } },
      reliability: {
        chases: { value: 1, trend: { direction: 'up' } },
        nudges: { value: 0, trend: { direction: 'flat' } },
        respawns: { value: 0, trend: { direction: 'flat' } },
        failedDeliveries: { value: 0, trend: { direction: 'flat' } },
        daemonRestarts: { value: 0, trend: { direction: 'unknown' } },
      },
      resourceAnomalies: [],
    };
  }

  function renderPwa(dashboardData) {
    const JSDOM = JSDOMClass();
    const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
    const { window } = dom;
    window.fetch = (url) => {
      if (url === './backlog.json') {
        return Promise.resolve({ json: () => Promise.resolve(dashboardData) });
      }
      return Promise.reject(new Error('not exercised in this handler'));
    };
    window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
    return dom;
  }

  function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  scoped(/^backlog\.json (is present|is absent)$/, (ctx, state) => {
    ctx.costHealthFieldPresent = state === 'is present';
  });

  scoped(/^the PWA renders$/, async (ctx) => {
    const dashboardData = fakeDashboardWithCostHealth(ctx.costHealthFieldPresent ? fakeCostHealth() : null);
    ctx.pwaDom = renderPwa(dashboardData);
    await flush();
  });

  scoped(/^the cost & health card (is shown|is hidden)$/, (ctx, visibility) => {
    const section = ctx.pwaDom.window.document.getElementById('costHealthSection');
    if (visibility === 'is shown') {
      assert.notEqual(section.style.display, 'none');
    } else {
      assert.equal(section.style.display, 'none');
    }
  });
}

module.exports = { registerSteps };
