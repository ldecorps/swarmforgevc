const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  COST_HEALTH_SIDECAR_SCHEMA_VERSION,
  bucketDailyFlowBalance,
  bucketDailyReliabilityEvents,
  buildCostHealthSidecar,
  renderCostHealthSection,
  sidecarPath,
  writeCostHealthSidecar,
  commitCostHealthSidecar,
  computeCostHealthSidecar,
} = require('../out/notify/costHealthSidecar');

const DAY_MS = 24 * 60 * 60 * 1000;

function lifecycle(ticketId, specDateIso, closeDateIso = null) {
  return { ticketId, specDateIso, closeDateIso };
}

// ── bucketDailyFlowBalance (pure) ────────────────────────────────────────

test('bucketDailyFlowBalance counts specced and closed tickets on their own days', () => {
  const day0 = Date.parse('2026-07-08T00:00:00Z');
  const nowMs = Date.parse('2026-07-09T00:00:00Z');
  const lifecycles = [
    lifecycle('BL-001', '2026-07-08T08:00:00Z', '2026-07-09T08:00:00Z'),
    lifecycle('BL-002', '2026-07-08T09:00:00Z', null),
  ];
  const { speccedSeries, closedSeries } = bucketDailyFlowBalance(lifecycles, nowMs);
  const day0Specced = speccedSeries.find((p) => p.periodStart === new Date(day0).toISOString());
  const day1Closed = closedSeries.find((p) => p.periodStart === new Date(nowMs).toISOString());
  assert.equal(day0Specced.value, 2);
  assert.equal(day1Closed.value, 1);
});

test('bucketDailyFlowBalance gap-fills days with zero, keeping both series contiguous', () => {
  const nowMs = Date.parse('2026-07-09T00:00:00Z');
  const lifecycles = [lifecycle('BL-001', '2026-07-01T00:00:00Z', null)];
  const { speccedSeries } = bucketDailyFlowBalance(lifecycles, nowMs);
  for (let i = 1; i < speccedSeries.length; i++) {
    assert.equal(Date.parse(speccedSeries[i].periodStart) - Date.parse(speccedSeries[i - 1].periodStart), DAY_MS);
  }
});

test('bucketDailyFlowBalance with no lifecycles at all returns a single today-only zero point', () => {
  const nowMs = Date.parse('2026-07-09T00:00:00Z');
  const { speccedSeries, closedSeries } = bucketDailyFlowBalance([], nowMs);
  assert.equal(speccedSeries.length, 1);
  assert.equal(speccedSeries[0].value, 0);
  assert.equal(closedSeries.length, 1);
  assert.equal(closedSeries[0].value, 0);
});

// ── bucketDailyReliabilityEvents (pure) ─────────────────────────────────

function chaserEvent(type, role, atIso) {
  return { type, role, at: atIso };
}

test('bucketDailyReliabilityEvents tallies each event type on its own day', () => {
  const nowMs = Date.parse('2026-07-09T00:00:00Z');
  const events = [
    chaserEvent('chase', 'coder', '2026-07-09T08:00:00Z'),
    chaserEvent('chase', 'coder', '2026-07-09T09:00:00Z'),
    chaserEvent('nudge', 'coder', '2026-07-09T08:00:00Z'),
    chaserEvent('respawn', 'coder', '2026-07-09T08:00:00Z'),
    chaserEvent('dead-letter', 'coder', '2026-07-09T08:00:00Z'),
  ];
  const result = bucketDailyReliabilityEvents(events, nowMs);
  const today = new Date(nowMs).toISOString();
  assert.equal(result.chases.find((p) => p.periodStart === today).value, 2);
  assert.equal(result.nudges.find((p) => p.periodStart === today).value, 1);
  assert.equal(result.respawns.find((p) => p.periodStart === today).value, 1);
  assert.equal(result.failedDeliveries.find((p) => p.periodStart === today).value, 1);
});

test('bucketDailyReliabilityEvents ignores unrecognized event types (e.g. resource_sample)', () => {
  const nowMs = Date.parse('2026-07-09T00:00:00Z');
  const events = [{ type: 'resource_sample', role: 'coder', at: '2026-07-09T08:00:00Z' }];
  const result = bucketDailyReliabilityEvents(events, nowMs);
  const today = new Date(nowMs).toISOString();
  assert.equal(result.chases.find((p) => p.periodStart === today).value, 0);
});

// ── buildCostHealthSidecar (pure) ────────────────────────────────────────

function emptyReliabilitySeries(nowIso) {
  return {
    chases: [{ periodStart: nowIso, value: 0 }],
    nudges: [{ periodStart: nowIso, value: 0 }],
    respawns: [{ periodStart: nowIso, value: 0 }],
    failedDeliveries: [{ periodStart: nowIso, value: 0 }],
  };
}

test('schema_version and dateIso are present', () => {
  const nowIso = '2026-07-09T00:00:00Z';
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries(nowIso), [], []);
  assert.equal(sidecar.schemaVersion, COST_HEALTH_SIDECAR_SCHEMA_VERSION);
  assert.equal(sidecar.dateIso, '2026-07-09');
});

test('an agent\'s latest daily tokens/cost carry a trend derived from their own day series', () => {
  const costTelemetryByRole = {
    coder: {
      byDay: {
        '2026-07-08T00:00:00.000Z': { usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 }, costUsd: 1 },
        '2026-07-09T00:00:00.000Z': { usage: { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 }, costUsd: 2 },
      },
      byTicket: {},
    },
  };
  const sidecar = buildCostHealthSidecar('2026-07-09', costTelemetryByRole, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  const agent = sidecar.agents.find((a) => a.role === 'coder');
  assert.equal(agent.tokens.value, 300);
  assert.equal(agent.tokens.trend.direction, 'up');
  assert.equal(agent.costUsd.value, 2);
  assert.equal(agent.costUsd.trend.direction, 'up');
});

test('an agent with no priced usage at all reports costUsd as null, not zero', () => {
  const costTelemetryByRole = {
    coder: { byDay: { '2026-07-09T00:00:00.000Z': { usage: { inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0 }, costUsd: null } }, byTicket: {} },
  };
  const sidecar = buildCostHealthSidecar('2026-07-09', costTelemetryByRole, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  assert.equal(sidecar.agents[0].costUsd, null);
});

test('top expensive tickets are summed across roles and sorted descending, excluding "unattributed"', () => {
  const costTelemetryByRole = {
    coder: { byDay: {}, byTicket: { 'BL-001': { usage: {}, costUsd: 5 }, unattributed: { usage: {}, costUsd: 999 } } },
    cleaner: { byDay: {}, byTicket: { 'BL-001': { usage: {}, costUsd: 3 }, 'BL-002': { usage: {}, costUsd: 20 } } },
  };
  const sidecar = buildCostHealthSidecar('2026-07-09', costTelemetryByRole, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], [], 5);
  assert.deepEqual(sidecar.topExpensiveTickets, [
    { ticketId: 'BL-002', costUsd: 20 },
    { ticketId: 'BL-001', costUsd: 8 },
  ]);
});

test('top expensive tickets respects the topN limit', () => {
  const byTicket = {};
  for (let i = 0; i < 10; i++) byTicket['BL-' + i] = { usage: {}, costUsd: i };
  const sidecar = buildCostHealthSidecar('2026-07-09', { coder: { byDay: {}, byTicket } }, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], [], 3);
  assert.equal(sidecar.topExpensiveTickets.length, 3);
});

test('flow balance reports today\'s specced/closed counts with a trend', () => {
  const speccedSeries = [{ periodStart: '2026-07-08T00:00:00Z', value: 2 }, { periodStart: '2026-07-09T00:00:00Z', value: 5 }];
  const closedSeries = [{ periodStart: '2026-07-08T00:00:00Z', value: 3 }, { periodStart: '2026-07-09T00:00:00Z', value: 1 }];
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), speccedSeries, closedSeries);
  assert.equal(sidecar.flowBalance.speccedPerDay.value, 5);
  assert.equal(sidecar.flowBalance.speccedPerDay.trend.direction, 'up');
  assert.equal(sidecar.flowBalance.closedPerDay.value, 1);
  assert.equal(sidecar.flowBalance.closedPerDay.trend.direction, 'down');
});

test('reliability counts carry a trend per field, and daemonRestarts is always zero (no telemetry source exists yet)', () => {
  const reliability = {
    chases: [{ periodStart: '2026-07-08T00:00:00Z', value: 1 }, { periodStart: '2026-07-09T00:00:00Z', value: 4 }],
    nudges: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
    respawns: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
    failedDeliveries: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
  };
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, reliability, [], []);
  assert.equal(sidecar.reliability.chases.value, 4);
  assert.equal(sidecar.reliability.chases.trend.direction, 'up');
  assert.equal(sidecar.reliability.daemonRestarts.value, 0);
});

test('resource anomalies include only roles whose rss or cpu moved meaningfully', () => {
  const resourceTrendsByRole = {
    coder: {
      currentRssBytes: 220_000_000, currentCpuPercent: 5,
      rssTrend: { direction: 'up', delta: 20_000_000, priorValue: 200_000_000, currentValue: 220_000_000, series: [] },
      cpuTrend: { direction: 'flat', delta: 0, priorValue: 5, currentValue: 5, series: [] },
    },
    cleaner: {
      currentRssBytes: 100_000_100, currentCpuPercent: 2,
      rssTrend: { direction: 'up', delta: 100, priorValue: 100_000_000, currentValue: 100_000_100, series: [] },
      cpuTrend: { direction: 'flat', delta: 0, priorValue: 2, currentValue: 2, series: [] },
    },
  };
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, resourceTrendsByRole, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  assert.deepEqual(sidecar.resourceAnomalies.map((a) => a.role), ['coder']);
});

test('resource anomalies is empty when no role has any data', () => {
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  assert.deepEqual(sidecar.resourceAnomalies, []);
});

// ── renderCostHealthSection (pure markdown renderer, cost-05b/05c) ──────

test('a null sidecar renders an empty section (cost-05c)', () => {
  assert.equal(renderCostHealthSection(null), '');
});

test('the rendered section shows exactly the sidecar figures, nothing invented (cost-05b)', () => {
  const sidecar = buildCostHealthSidecar(
    '2026-07-09',
    { coder: { byDay: { '2026-07-09T00:00:00.000Z': { usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 }, costUsd: 4.5 } }, byTicket: { 'BL-100': { usage: {}, costUsd: 4.5 } } } },
    {},
    emptyReliabilitySeries('2026-07-09T00:00:00Z'),
    [{ periodStart: '2026-07-09T00:00:00Z', value: 3 }],
    [{ periodStart: '2026-07-09T00:00:00Z', value: 2 }]
  );
  const text = renderCostHealthSection(sidecar);
  assert.match(text, /## Cost & Health/);
  assert.match(text, /coder: 150 tokens/);
  assert.match(text, /\$4\.50/);
  assert.match(text, /BL-100: \$4\.50/);
  assert.match(text, /specced 3\/day/);
  assert.match(text, /closed 2\/day/);
});

// ── writeCostHealthSidecar / commitCostHealthSidecar / sidecarPath ──────

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-cost-sidecar-'));
}

function git(cwd, args, dateIso) {
  const env = { ...process.env };
  if (dateIso) {
    env.GIT_AUTHOR_DATE = dateIso;
    env.GIT_COMMITTER_DATE = dateIso;
  }
  execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

test('sidecarPath resolves docs/briefings/<date>.json under the target path', () => {
  assert.equal(sidecarPath('/repo', '2026-07-09'), path.join('/repo', 'docs', 'briefings', '2026-07-09.json'));
});

test('writeCostHealthSidecar writes valid JSON at the expected path', () => {
  const target = mkTmp();
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  const filePath = writeCostHealthSidecar(target, sidecar);
  assert.equal(filePath, sidecarPath(target, '2026-07-09'));
  const written = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(written.dateIso, '2026-07-09');
});

test('commitCostHealthSidecar commits only the sidecar file, scoped, into a real repo', () => {
  const target = mkTmp();
  git(target, ['init', '-q']);
  git(target, ['config', 'user.email', 't@t']);
  git(target, ['config', 'user.name', 't']);
  git(target, ['commit', '-q', '-m', 'init', '--allow-empty']);

  // An unrelated dirty file must NOT be swept into the sidecar commit.
  fs.writeFileSync(path.join(target, 'unrelated.txt'), 'do not commit me');

  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  const filePath = writeCostHealthSidecar(target, sidecar);
  const committed = commitCostHealthSidecar(target, filePath, '2026-07-09');
  assert.equal(committed, true);

  const status = execFileSync('git', ['-C', target, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.match(status, /unrelated\.txt/, 'the unrelated file must remain uncommitted (still dirty)');
  assert.doesNotMatch(status, /docs-tree-schema|docs\/briefings/, 'the sidecar itself must no longer show as dirty (it was committed)');

  const log = execFileSync('git', ['-C', target, 'log', '--format=%s'], { encoding: 'utf8' });
  assert.match(log, /2026-07-09/);
});

test('commitCostHealthSidecar returns false (never throws) when there is nothing to commit', () => {
  const target = mkTmp();
  git(target, ['init', '-q']);
  git(target, ['config', 'user.email', 't@t']);
  git(target, ['config', 'user.name', 't']);

  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  const filePath = writeCostHealthSidecar(target, sidecar);
  git(target, ['add', filePath]);
  git(target, ['commit', '-q', '-m', 'already committed']);

  assert.doesNotThrow(() => commitCostHealthSidecar(target, filePath, '2026-07-09'));
  assert.equal(commitCostHealthSidecar(target, filePath, '2026-07-09'), false);
});

// ── computeCostHealthSidecar (impure orchestrator, real fs/git) ─────────

test('computeCostHealthSidecar wires real BL-100/BL-096 producers together without throwing on an empty target', () => {
  const target = mkTmp();
  git(target, ['init', '-q']);
  git(target, ['config', 'user.email', 't@t']);
  git(target, ['config', 'user.name', 't']);
  git(target, ['commit', '-q', '-m', 'init', '--allow-empty']);

  assert.doesNotThrow(() => computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }]));
  const sidecar = computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }]);
  assert.equal(sidecar.schemaVersion, COST_HEALTH_SIDECAR_SCHEMA_VERSION);
  assert.deepEqual(sidecar.topExpensiveTickets, []);
});
