const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  BACKLOG_DASHBOARD_SCHEMA_VERSION,
  buildBacklogDashboard,
  computeBacklogDashboard,
} = require('../out/metrics/backlogDashboard');
const { computeDeliveryMetrics } = require('../out/metrics/deliveryMetrics');

function item(overrides = {}) {
  return { id: 'BL-100', title: 't', status: 'active', ...overrides };
}

function emptyDeliveryMetrics() {
  return {
    velocity: { weeklySeries: [], trend: { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
    burndown: [],
    cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, weeklySeries: [], trend: { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' } },
    forecasts: { tickets: [], milestones: [], throughputPerDay: 0 },
    suiteDurationTrend: { hasLocalData: false, dailySeries: [], trend: { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' } },
  };
}

// ── buildBacklogDashboard (pure) ─────────────────────────────────────────

test('schema_version is present (dashboard-05)', () => {
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc123', '2026-07-09T00:00:00Z');
  assert.equal(data.schemaVersion, BACKLOG_DASHBOARD_SCHEMA_VERSION);
  assert.equal(typeof data.schemaVersion, 'number');
});

test('carries the generation timestamp and source SHA (dashboard-01)', () => {
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc123', '2026-07-09T00:00:00Z');
  assert.equal(data.sourceSha, 'abc123');
  assert.equal(data.generatedAtIso, '2026-07-09T00:00:00Z');
});

test('an active ticket appears on the board with its swarm (defaulting to local/primary)', () => {
  const data = buildBacklogDashboard({ active: [item()], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(data.board.active.length, 1);
  assert.equal(data.board.active[0].id, 'BL-100');
  assert.equal(data.board.active[0].swarm, 'primary');
});

test('a ticket with an explicit swarm field keeps that assignment, not the local default', () => {
  const data = buildBacklogDashboard({ active: [item({ swarm: 'secondary-1' })], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(data.board.active[0].swarm, 'secondary-1');
});

test('a paused ticket appears under board.paused', () => {
  const data = buildBacklogDashboard({ active: [], paused: [item({ id: 'BL-101' })], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(data.board.paused.length, 1);
  assert.equal(data.board.paused[0].id, 'BL-101');
});

test('done tickets are grouped by milestone', () => {
  const done = [item({ id: 'BL-101', status: 'done', milestone: 'M1' }), item({ id: 'BL-102', status: 'done', milestone: 'M2' })];
  const data = buildBacklogDashboard({ active: [], paused: [], done }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.deepEqual(data.board.doneByMilestone.M1.map((t) => t.id), ['BL-101']);
  assert.deepEqual(data.board.doneByMilestone.M2.map((t) => t.id), ['BL-102']);
});

test('an active ticket carries its spec date from the lifecycle join', () => {
  const lifecycles = [{ ticketId: 'BL-100', specDateIso: '2026-06-01T00:00:00Z', closeDateIso: null }];
  const data = buildBacklogDashboard({ active: [item()], paused: [], done: [] }, lifecycles, emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(data.board.active[0].specDateIso, '2026-06-01T00:00:00Z');
});

test('a done ticket carries both spec and close dates', () => {
  const lifecycles = [{ ticketId: 'BL-100', specDateIso: '2026-06-01T00:00:00Z', closeDateIso: '2026-06-05T00:00:00Z' }];
  const data = buildBacklogDashboard({ active: [], paused: [], done: [item({ status: 'done' })] }, lifecycles, emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  const ticket = data.board.doneByMilestone.unspecified[0];
  assert.equal(ticket.specDateIso, '2026-06-01T00:00:00Z');
  assert.equal(ticket.closeDateIso, '2026-06-05T00:00:00Z');
});

test('an open ticket carries its p50/p85 forecast from the delivery metrics join', () => {
  const metrics = emptyDeliveryMetrics();
  metrics.forecasts.tickets = [{ ticketId: 'BL-100', p50Iso: '2026-08-01T00:00:00Z', p85Iso: '2026-08-10T00:00:00Z' }];
  const data = buildBacklogDashboard({ active: [item()], paused: [], done: [] }, [], metrics, 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(data.board.active[0].p50Iso, '2026-08-01T00:00:00Z');
  assert.equal(data.board.active[0].p85Iso, '2026-08-10T00:00:00Z');
});

test('a ticket with no forecast simply omits the p50/p85 fields, not null placeholders', () => {
  const data = buildBacklogDashboard({ active: [item()], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(Object.prototype.hasOwnProperty.call(data.board.active[0], 'p50Iso'), false);
});

test('velocity, burndown, cycle-time, and forecasts pass through unmodified from delivery metrics (dashboard-02 parity)', () => {
  const metrics = emptyDeliveryMetrics();
  metrics.velocity.rollingWindowCount = 7;
  metrics.cycleTime.medianMs = 12345;
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], metrics, 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.deepEqual(data.metrics.velocity, metrics.velocity);
  assert.deepEqual(data.metrics.burndown, metrics.burndown);
  assert.deepEqual(data.metrics.cycleTime, metrics.cycleTime);
  assert.deepEqual(data.metrics.forecasts, metrics.forecasts);
});

test('suite-duration trend is never included (test-suite duration is gitignored/local-only, excluded per the ticket)', () => {
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(Object.prototype.hasOwnProperty.call(data.metrics, 'suiteDurationTrend'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'suiteDurationTrend'), false);
});

test('an empty backlog produces an empty, valid, non-throwing dashboard', () => {
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', null, '2026-07-09T00:00:00Z');
  assert.deepEqual(data.board.active, []);
  assert.deepEqual(data.board.paused, []);
  assert.deepEqual(data.board.doneByMilestone, {});
  assert.equal(data.sourceSha, null);
});

// ── BL-213 cost-06a/06b: costHealth fold-in ──────────────────────────────

test('costHealth is folded in verbatim when a sidecar is provided (cost-06a)', () => {
  const sidecar = { schemaVersion: 1, dateIso: '2026-07-09', agents: [], topExpensiveTickets: [], flowBalance: {}, reliability: {}, resourceAnomalies: [] };
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z', sidecar);
  assert.deepEqual(data.costHealth, sidecar);
  assert.equal(data.schemaVersion, BACKLOG_DASHBOARD_SCHEMA_VERSION, 'schemaVersion is unchanged - costHealth is additive');
});

test('costHealth is omitted entirely (not null) when no sidecar is provided (cost-06b: hidden when absent)', () => {
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'costHealth'), false);
});

// ── computeBacklogDashboard (impure orchestrator, real git repo) ────────

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-backlog-dashboard-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(cwd, args, dateIso) {
  const env = { ...process.env };
  if (dateIso) {
    env.GIT_AUTHOR_DATE = dateIso;
    env.GIT_COMMITTER_DATE = dateIso;
  }
  execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

test('computeBacklogDashboard wires git history + current backlog state into one dashboard payload, matching the metrics CLI (dashboard-01/02)', () => {
  const repo = mkTmp();
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 't']);

  mkdirp(path.join(repo, 'backlog', 'active'));
  fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-101.yaml'), 'id: BL-101\ntitle: t\nstatus: active\nmilestone: M4\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'spec BL-101'], '2026-06-01T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done', 'M4'));
  git(repo, ['mv', 'backlog/active/BL-101.yaml', 'backlog/done/M4/BL-101.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-101'], '2026-06-05T08:00:00');

  const nowMs = Date.parse('2026-06-10T00:00:00Z');
  const dashboard = computeBacklogDashboard(repo, [], nowMs);
  const cliMetrics = computeDeliveryMetrics(repo, [], nowMs);

  assert.deepEqual(dashboard.metrics.velocity, cliMetrics.velocity);
  assert.deepEqual(dashboard.metrics.cycleTime, cliMetrics.cycleTime);
  assert.equal(dashboard.board.doneByMilestone.M4[0].id, 'BL-101');
  assert.ok(dashboard.sourceSha, 'a real repo must resolve a source SHA');
  assert.equal(dashboard.schemaVersion, BACKLOG_DASHBOARD_SCHEMA_VERSION);
});

test('computeBacklogDashboard folds in the most recently committed sidecar (cost-06a)', () => {
  const repo = mkTmp();
  mkdirp(path.join(repo, 'backlog', 'active'));
  mkdirp(path.join(repo, 'docs', 'briefings'));
  fs.writeFileSync(
    path.join(repo, 'docs', 'briefings', '2026-07-08.json'),
    JSON.stringify({ schemaVersion: 1, dateIso: '2026-07-08', agents: [], topExpensiveTickets: [], flowBalance: {}, reliability: {}, resourceAnomalies: [] })
  );
  fs.writeFileSync(
    path.join(repo, 'docs', 'briefings', '2026-07-09.json'),
    JSON.stringify({ schemaVersion: 1, dateIso: '2026-07-09', agents: [], topExpensiveTickets: [], flowBalance: {}, reliability: {}, resourceAnomalies: [] })
  );

  const dashboard = computeBacklogDashboard(repo, [], Date.parse('2026-07-09T12:00:00Z'));
  assert.equal(dashboard.costHealth.dateIso, '2026-07-09', 'the latest sidecar by date must win, not just directory order');
});

test('computeBacklogDashboard omits costHealth when no sidecar has ever been committed (cost-06b)', () => {
  const repo = mkTmp();
  mkdirp(path.join(repo, 'backlog', 'active'));

  const dashboard = computeBacklogDashboard(repo, [], Date.parse('2026-07-09T12:00:00Z'));
  assert.equal(Object.prototype.hasOwnProperty.call(dashboard, 'costHealth'), false);
});
