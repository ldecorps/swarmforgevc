const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  COST_HEALTH_SIDECAR_SCHEMA_VERSION,
  bucketDailyFlowBalance,
  bucketDailyReliabilityEvents,
  bucketDailyDaemonRestarts,
  buildCostHealthSidecar,
  renderCostHealthSection,
  renderCostTrendChartLines,
  sidecarPath,
  writeCostHealthSidecar,
  commitCostHealthSidecar,
  computeCostHealthSidecar,
} = require('../out/notify/costHealthSidecar');
const { llmCostTelemetryDir } = require('../out/metrics/llmCostLedgerStore');
const { freshnessIncidentLogPath } = require('../out/metrics/swarmMetrics');
const { appendHostLoadSample } = require('../out/metrics/resourceTelemetry');
const { serializeLifecycleSnapshot } = require('../out/metrics/lifecycleSnapshot');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

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

// ── BL-635: flowBalance.rework - by-role, never pooled ──────────────────

function bounceRecord(overrides = {}) {
  return {
    ticket: 'BL-590',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: 'abc1234567',
    at: '2026-07-09T10:00:00.000Z',
    by: 'architect',
    ...overrides,
  };
}

test('flowBalance.rework is omitted entirely (not null) when no reworkInputs are given, matching the additive-optional convention', () => {
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  assert.equal(Object.prototype.hasOwnProperty.call(sidecar.flowBalance, 'rework'), false);
});

test('flowBalance.rework.roundsPerClose carries a trended number per bouncing role, split apart', () => {
  // Dated well after the 2026-07-25 by-attribution epoch so the current
  // window is available (BL-635 SEND BACK #1 site 1) - see the pre-epoch
  // and zero-closes tests below for the unavailable cases.
  const nowMs = Date.parse('2026-08-08T12:00:00.000Z');
  const bounceRecords = [
    bounceRecord({ by: 'architect', commit: 'c1', at: '2026-08-08T10:00:00.000Z' }),
    bounceRecord({ by: 'architect', commit: 'c2', at: '2026-08-08T10:00:00.000Z' }),
    bounceRecord({ by: 'architect', commit: 'c3', at: '2026-08-08T10:00:00.000Z' }),
    bounceRecord({ by: 'architect', commit: 'c4', at: '2026-08-08T10:00:00.000Z' }),
    bounceRecord({ by: 'QA', commit: 'c5', at: '2026-08-08T10:00:00.000Z' }),
    bounceRecord({ by: 'QA', commit: 'c6', at: '2026-08-08T10:00:00.000Z' }),
  ];
  const closedDateIsos = ['2026-08-07T10:00:00.000Z', '2026-08-08T10:00:00.000Z'];
  const sidecar = buildCostHealthSidecar(
    '2026-08-08',
    {},
    {},
    emptyReliabilitySeries('2026-08-08T00:00:00Z'),
    [],
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { bounceRecords, closedDateIsos, nowMs }
  );
  assert.equal(sidecar.flowBalance.rework.roundsPerClose.architect.value, 2);
  assert.equal(sidecar.flowBalance.rework.roundsPerClose.QA.value, 1);
  // "trended number" shape - a trend object rides alongside the value,
  // exactly like specced/closed already carry.
  assert.ok('direction' in sidecar.flowBalance.rework.roundsPerClose.architect.trend);
});

// A window with no honest PRIOR figure (unavailable, not zero) must never
// fabricate a trend direction/delta off it - the CURRENT point alone stays
// a single-point series (direction 'unknown'), exactly like specced/closed
// already behave with fewer than two measured points.
test('flowBalance.rework.roundsPerClose has direction "unknown" when only the current window has a real figure', () => {
  const nowMs = Date.parse('2026-07-29T12:00:00.000Z'); // prior window (07-15..07-22) is entirely pre-epoch
  const bounceRecords = [bounceRecord({ by: 'architect', commit: 'c1', at: '2026-07-27T09:00:00.000Z' })];
  const closedDateIsos = ['2026-07-27T12:00:00.000Z'];
  const sidecar = buildCostHealthSidecar(
    '2026-07-29',
    {},
    {},
    emptyReliabilitySeries('2026-07-29T00:00:00Z'),
    [],
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { bounceRecords, closedDateIsos, nowMs }
  );
  const architect = sidecar.flowBalance.rework.roundsPerClose.architect;
  assert.equal(architect.value, 1);
  assert.equal(architect.trend.direction, 'unknown');
  assert.equal(architect.trend.priorValue, null);
});

// reworkInputs can be wired (a real bounce log path exists) while the log
// itself has no records for any role yet - flowBalance.rework is present
// (additive-optional per role wired), but with zero roles it must render
// exactly like "no bounce data at all", never a stray suffix fragment.
test('the flow balance line has no rework suffix when reworkInputs are given but no role has bounced yet', () => {
  const sidecar = buildCostHealthSidecar(
    '2026-07-09',
    {},
    {},
    emptyReliabilitySeries('2026-07-09T00:00:00Z'),
    [],
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { bounceRecords: [], closedDateIsos: [], nowMs: Date.parse('2026-07-09T12:00:00.000Z') }
  );
  assert.ok(Object.prototype.hasOwnProperty.call(sidecar.flowBalance, 'rework'));
  assert.deepEqual(sidecar.flowBalance.rework.roundsPerClose, {});
  const text = renderCostHealthSection(sidecar);
  assert.doesNotMatch(text, /rework/);
  assert.doesNotMatch(text, /Stryker/);
});

test('flowBalance.rework.maxRounds names the ticket with the most bounces', () => {
  const nowMs = Date.parse('2026-07-09T12:00:00.000Z');
  const bounceRecords = [bounceRecord({ commit: 'c1' }), bounceRecord({ commit: 'c2' }), bounceRecord({ ticket: 'BL-1', by: 'QA', commit: 'c3' })];
  const sidecar = buildCostHealthSidecar(
    '2026-07-09',
    {},
    {},
    emptyReliabilitySeries('2026-07-09T00:00:00Z'),
    [],
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { bounceRecords, closedDateIsos: [], nowMs }
  );
  assert.deepEqual(sidecar.flowBalance.rework.maxRounds, { ticket: 'BL-590', rounds: 2, by: 'architect' });
});

test('flowBalance.rework.bouncesPerDay renders unavailable (null) before the epoch, never a fabricated zero', () => {
  const nowMs = Date.parse('2026-07-26T12:00:00.000Z');
  const bounceRecords = [bounceRecord({ by: 'architect', at: '2026-07-26T09:00:00.000Z' })];
  const sidecar = buildCostHealthSidecar(
    '2026-07-26',
    {},
    {},
    emptyReliabilitySeries('2026-07-26T00:00:00Z'),
    [],
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { bounceRecords, closedDateIsos: [], nowMs }
  );
  const series = sidecar.flowBalance.rework.bouncesPerDay.architect;
  const beforeEpoch = series.find((p) => p.periodStart < '2026-07-26');
  const onEpoch = series.find((p) => p.periodStart === '2026-07-26');
  assert.equal(beforeEpoch.value, null);
  assert.equal(onEpoch.value, 1);
});

test('reliability counts carry a trend per field, and daemonRestarts is derived from the freshness incident series like its siblings, not a hardcoded literal', () => {
  const reliability = {
    chases: [{ periodStart: '2026-07-08T00:00:00Z', value: 1 }, { periodStart: '2026-07-09T00:00:00Z', value: 4 }],
    nudges: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
    respawns: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
    failedDeliveries: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
    daemonRestarts: [{ periodStart: '2026-07-08T00:00:00Z', value: 2 }, { periodStart: '2026-07-09T00:00:00Z', value: 5 }],
  };
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, reliability, [], []);
  assert.equal(sidecar.reliability.chases.value, 4);
  assert.equal(sidecar.reliability.chases.trend.direction, 'up');
  assert.equal(sidecar.reliability.daemonRestarts.value, 5);
  assert.equal(sidecar.reliability.daemonRestarts.trend.direction, 'up');
});

// BL-904 invariant 2: a missing/unreadable incident log (daemonRestarts:
// null/undefined on the input series) must report "no data" - an empty
// trend series with currentValue null - never fall back to a measured
// zero. Distinguished from BL-904's OWN "genuine zero" case below, which
// has a real (non-empty) series.
test('BL-904: daemonRestarts reports no data (empty trend series) when the input series is null, distinguishable from a measured zero', () => {
  const reliability = {
    chases: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
    nudges: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
    respawns: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
    failedDeliveries: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
    daemonRestarts: null,
  };
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, reliability, [], []);
  assert.equal(sidecar.reliability.daemonRestarts.value, 0);
  assert.deepEqual(sidecar.reliability.daemonRestarts.trend.series, []);
  assert.equal(sidecar.reliability.daemonRestarts.trend.currentValue, null);
  assert.equal(sidecar.reliability.daemonRestarts.trend.direction, 'unknown');
});

// BL-904 invariant 2: a MEASURED zero (log readable, real day(s) of
// history, zero restarts) must be distinguishable from the null case
// above via a non-null currentValue, even though direction is 'unknown'
// in both cases for a single-point series.
test('BL-904: daemonRestarts reports a measured zero (non-null currentValue) distinctly from the no-data case', () => {
  const reliability = {
    chases: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
    nudges: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
    respawns: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
    failedDeliveries: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
    daemonRestarts: [{ periodStart: '2026-07-09T00:00:00Z', value: 0 }],
  };
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, reliability, [], []);
  assert.equal(sidecar.reliability.daemonRestarts.value, 0);
  assert.equal(sidecar.reliability.daemonRestarts.trend.series.length, 1);
  assert.equal(sidecar.reliability.daemonRestarts.trend.currentValue, 0);
});

// ── bucketDailyDaemonRestarts (pure) ─────────────────────────────────────

test('bucketDailyDaemonRestarts returns null when events is null (no data source)', () => {
  assert.equal(bucketDailyDaemonRestarts(null, Date.now()), null);
});

test('bucketDailyDaemonRestarts counts only action=restart, excluding action=escalate', () => {
  const nowMs = Date.parse('2026-07-09T12:00:00Z');
  const events = [
    { epoch: Math.floor(Date.parse('2026-07-09T01:00:00Z') / 1000), daemon: 'handoffd', action: 'restart' },
    { epoch: Math.floor(Date.parse('2026-07-09T02:00:00Z') / 1000), daemon: 'handoffd', action: 'restart' },
    { epoch: Math.floor(Date.parse('2026-07-09T03:00:00Z') / 1000), daemon: 'babysitterd', action: 'escalate' },
  ];
  const series = bucketDailyDaemonRestarts(events, nowMs);
  const today = series.find((p) => p.periodStart.startsWith('2026-07-09'));
  assert.equal(today.value, 2);
});

test('bucketDailyDaemonRestarts gap-fills every day between the earliest event and now, same as the sibling reliability fields', () => {
  const nowMs = Date.parse('2026-07-09T12:00:00Z');
  const events = [{ epoch: Math.floor(Date.parse('2026-07-07T01:00:00Z') / 1000), daemon: 'handoffd', action: 'restart' }];
  const series = bucketDailyDaemonRestarts(events, nowMs);
  assert.deepEqual(
    series.map((p) => p.periodStart.slice(0, 10)),
    ['2026-07-07', '2026-07-08', '2026-07-09']
  );
});

// ── computeCostHealthSidecar end-to-end wiring (BL-904) ──────────────────

function writeFreshnessIncidentLog(targetPath, lines) {
  const logPath = freshnessIncidentLogPath(targetPath);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, lines.join('\n') + (lines.length > 0 ? '\n' : ''));
}

function freshnessLine(epochSeconds, daemon, action) {
  return `epoch=${epochSeconds} daemon=${daemon} age_secs=999 threshold=600 action=${action}`;
}

// BL-904 acceptance scenario 01/02: the real end-to-end wiring, not just
// the pure functions - a real fixture log read through computeCostHealthSidecar.
test('computeCostHealthSidecar counts real restart records from the freshness incident log and excludes escalates', () => {
  const target = mkTmpDir('sfvc-costhealth-daemonrestarts-');
  const nowMs = Date.parse('2026-07-09T12:00:00Z');
  const todayEpoch = Math.floor(Date.parse('2026-07-09T01:00:00Z') / 1000);
  const lines = [];
  for (let i = 0; i < 155; i++) {
    lines.push(freshnessLine(todayEpoch + i, 'handoffd', 'restart'));
  }
  for (let i = 0; i < 100; i++) {
    lines.push(freshnessLine(todayEpoch + i, 'handoffd', 'escalate'));
  }
  writeFreshnessIncidentLog(target, lines);
  const sidecar = computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }], nowMs);
  assert.equal(sidecar.reliability.daemonRestarts.value, 155);
});

// BL-904 invariant 2 / acceptance scenario 04: no log file at all reports
// no data, not a measured zero.
test('computeCostHealthSidecar reports daemonRestarts as no-data when the freshness incident log does not exist', () => {
  const target = mkTmpDir('sfvc-costhealth-daemonrestarts-');
  const sidecar = computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }]);
  assert.equal(sidecar.reliability.daemonRestarts.value, 0);
  assert.deepEqual(sidecar.reliability.daemonRestarts.trend.series, []);
  assert.equal(sidecar.reliability.daemonRestarts.trend.currentValue, null);
});

// BL-904 acceptance scenario 05: a malformed line does not discard the
// good records, driven through the real reader end to end.
test('computeCostHealthSidecar still counts good restart records when the log also has a truncated line', () => {
  const target = mkTmpDir('sfvc-costhealth-daemonrestarts-');
  const nowMs = Date.parse('2026-07-09T12:00:00Z');
  const todayEpoch = Math.floor(Date.parse('2026-07-09T01:00:00Z') / 1000);
  writeFreshnessIncidentLog(target, [
    freshnessLine(todayEpoch, 'handoffd', 'restart'),
    freshnessLine(todayEpoch + 1, 'handoffd', 'restart'),
    'epoch=' + (todayEpoch + 2) + ' daemon=handoffd age_secs=999 thresho',
    freshnessLine(todayEpoch + 3, 'handoffd', 'restart'),
  ]);
  const sidecar = computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }], nowMs);
  assert.equal(sidecar.reliability.daemonRestarts.value, 3);
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

// BL-350: resourceSamplesObserved is the signal that distinguishes a
// genuinely quiet day (sampled, nothing anomalous) from a sampler that
// never ran at all - both previously produced the same empty
// resourceAnomalies array with no way to tell them apart.

test('resourceSamplesObserved is true once any role has a recorded sample, even with no anomaly', () => {
  const resourceTrendsByRole = {
    coder: {
      currentRssBytes: 100_000_000, currentCpuPercent: 5,
      rssTrend: { direction: 'flat', delta: 0, priorValue: 100_000_000, currentValue: 100_000_000, series: [] },
      cpuTrend: { direction: 'flat', delta: 0, priorValue: 5, currentValue: 5, series: [] },
    },
  };
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, resourceTrendsByRole, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  assert.deepEqual(sidecar.resourceAnomalies, []);
  assert.equal(sidecar.resourceSamplesObserved, true);
});

test('resourceSamplesObserved is false when no role has any recorded sample (the broken-sampler case)', () => {
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  assert.equal(sidecar.resourceSamplesObserved, false);
});

// ── BL-822: hostLoad (additive, optional, never inside resourceAnomalies) ──

function buildWithHostLoad(hostLoadVerdict, resourceTrendsByRole = {}) {
  return buildCostHealthSidecar(
    '2026-08-06',
    {},
    resourceTrendsByRole,
    emptyReliabilitySeries('2026-08-06T00:00:00Z'),
    [],
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    hostLoadVerdict
  );
}

test('buildCostHealthSidecar carries the given hostLoad verdict verbatim', () => {
  const verdict = { severe: true, ratio: 20, sustainedMinutes: 240 };
  const sidecar = buildWithHostLoad(verdict);
  assert.deepEqual(sidecar.hostLoad, verdict);
});

test('hostLoad is omitted entirely (not null/undefined-keyed) when none is given, matching the sidecar\'s own additive-optional convention', () => {
  const sidecar = buildCostHealthSidecar('2026-08-06', {}, {}, emptyReliabilitySeries('2026-08-06T00:00:00Z'), [], []);
  assert.equal(Object.prototype.hasOwnProperty.call(sidecar, 'hostLoad'), false);
});

test('hostLoad never changes resourceAnomalies - per-role detection is unaffected (invariant 2)', () => {
  const resourceTrendsByRole = {
    coder: {
      currentRssBytes: 220_000_000, currentCpuPercent: 5,
      rssTrend: { direction: 'up', delta: 20_000_000, priorValue: 200_000_000, currentValue: 220_000_000, series: [] },
      cpuTrend: { direction: 'flat', delta: 0, priorValue: 5, currentValue: 5, series: [] },
    },
  };
  const withoutHostLoad = buildWithHostLoad(undefined, resourceTrendsByRole);
  const withSevereHostLoad = buildWithHostLoad({ severe: true, ratio: 20, sustainedMinutes: 240 }, resourceTrendsByRole);
  assert.deepEqual(withSevereHostLoad.resourceAnomalies, withoutHostLoad.resourceAnomalies);
  assert.deepEqual(withSevereHostLoad.resourceAnomalies.map((a) => a.role), ['coder']);
});

test('hostLoad never sets resourceSamplesObserved - a host-load sample never stands in for per-role sampling (invariant 3)', () => {
  const withoutHostLoad = buildWithHostLoad(undefined, {});
  const withSevereHostLoad = buildWithHostLoad({ severe: true, ratio: 20, sustainedMinutes: 240 }, {});
  assert.equal(withoutHostLoad.resourceSamplesObserved, false);
  assert.equal(withSevereHostLoad.resourceSamplesObserved, false);
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

// ── BL-635 (record-bounce-by-role-09/14): the rework figure on the flow
//    balance line, split by bouncing role, with a trend arrow ────────────

test('a sidecar with no bounce data renders the flow balance line with no rework suffix', () => {
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  const text = renderCostHealthSection(sidecar);
  assert.doesNotMatch(text, /rework/);
});

test('the flow balance line includes the rework figure, split by role, with a trend arrow', () => {
  // Dated well after the 2026-07-25 by-attribution epoch (see the sibling
  // pre-epoch test below) so the current window is available.
  const nowMs = Date.parse('2026-08-08T12:00:00.000Z');
  const bounceRecords = [
    bounceRecord({ by: 'architect', commit: 'c1', at: '2026-08-08T10:00:00.000Z' }),
    bounceRecord({ by: 'architect', commit: 'c2', at: '2026-08-08T10:00:00.000Z' }),
    bounceRecord({ by: 'QA', commit: 'c3', at: '2026-08-08T10:00:00.000Z' }),
  ];
  const sidecar = buildCostHealthSidecar(
    '2026-08-08',
    {},
    {},
    emptyReliabilitySeries('2026-08-08T00:00:00Z'),
    [{ periodStart: '2026-08-08T00:00:00Z', value: 3 }],
    [{ periodStart: '2026-08-08T00:00:00Z', value: 2 }],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { bounceRecords, closedDateIsos: ['2026-08-08T10:00:00.000Z', '2026-08-07T10:00:00.000Z'], nowMs }
  );
  const text = renderCostHealthSection(sidecar);
  assert.match(text, /\*\*Flow balance:\*\* specced 3\/day.*closed 2\/day.*rework/);
  assert.match(text, /architect 1\.0/);
  assert.match(text, /QA 0\.5/);
  // per-role entries are joined with ", " (comma-space), never concatenated
  // bare - a role's own trailing figure/arrow must not run into the next
  // role's name with no separator. Roles render sorted (QA before
  // architect, per the roles-come-back-sorted contract).
  assert.match(text, /rework QA 0\.5[^,]*, architect 1\.0/);
});

// ── BL-635 SEND BACK #1 (evidence sites 1-4): unavailable renders as the ──
//    word "unavailable" end to end, never a fabricated 0 or bare arrow ────

test('flowBalance.rework.roundsPerClose is null for a role whose current window is entirely pre-epoch, even with real bounces and closes', () => {
  const nowMs = Date.parse('2026-07-20T12:00:00.000Z'); // current window ends 07-20, entirely before the 2026-07-25 epoch
  const bounceRecords = [bounceRecord({ by: 'architect', commit: 'c1', at: '2026-07-15T09:00:00.000Z' })];
  const sidecar = buildCostHealthSidecar(
    '2026-07-20',
    {},
    {},
    emptyReliabilitySeries('2026-07-20T00:00:00Z'),
    [],
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { bounceRecords, closedDateIsos: ['2026-07-15T12:00:00.000Z'], nowMs }
  );
  // 1 bounce / 1 close would compute to a healthy-looking 1.0 if fabricated -
  // the whole window is pre-epoch, so it must read unavailable instead.
  assert.equal(sidecar.flowBalance.rework.roundsPerClose.architect, null);
});

test('flowBalance.rework.roundsPerClose is null for a role whose current window closed zero tickets', () => {
  const nowMs = Date.parse('2026-08-08T12:00:00.000Z');
  const bounceRecords = [bounceRecord({ by: 'architect', commit: 'c1', at: '2026-08-08T10:00:00.000Z' })];
  const sidecar = buildCostHealthSidecar(
    '2026-08-08',
    {},
    {},
    emptyReliabilitySeries('2026-08-08T00:00:00Z'),
    [],
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { bounceRecords, closedDateIsos: [], nowMs }
  );
  assert.equal(sidecar.flowBalance.rework.roundsPerClose.architect, null);
});

test('the flow balance line renders "unavailable" for a role with no honest figure - never 0.0, never a bare arrow', () => {
  const nowMs = Date.parse('2026-07-20T12:00:00.000Z'); // current window entirely pre-epoch, as above
  const bounceRecords = [bounceRecord({ by: 'architect', commit: 'c1', at: '2026-07-15T09:00:00.000Z' })];
  const sidecar = buildCostHealthSidecar(
    '2026-07-20',
    {},
    {},
    emptyReliabilitySeries('2026-07-20T00:00:00Z'),
    [],
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { bounceRecords, closedDateIsos: ['2026-07-15T12:00:00.000Z'], nowMs }
  );
  const text = renderCostHealthSection(sidecar);
  assert.match(text, /rework architect unavailable rounds\/close/);
  assert.doesNotMatch(text, /architect 0\.0/);
});

// BL-350 headless-resource-sampling-03: a quiet period (samples exist, none
// anomalous) states that explicitly, rather than rendering the same nothing
// a never-sampled sidecar would.
test('a quiet period states that no resource anomaly was found', () => {
  const resourceTrendsByRole = {
    coder: {
      currentRssBytes: 100_000_000, currentCpuPercent: 5,
      rssTrend: { direction: 'flat', delta: 0, priorValue: 100_000_000, currentValue: 100_000_000, series: [] },
      cpuTrend: { direction: 'flat', delta: 0, priorValue: 5, currentValue: 5, series: [] },
    },
  };
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, resourceTrendsByRole, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  const text = renderCostHealthSection(sidecar);
  assert.match(text, /Resource anomalies:.*none found/);
});

// BL-350: the ORIGINAL defect - a sidecar with no resource data at all
// (the never-sampled/broken case) must NOT claim "none found"; it says
// nothing about resource anomalies, since it never checked.
test('a sidecar with no resource samples at all renders no resource-anomalies line', () => {
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  const text = renderCostHealthSection(sidecar);
  assert.doesNotMatch(text, /Resource anomalies/);
});

// BL-350 hardening gap: renderAnomalyLines gained a third branch
// (anomalies present / none found / never sampled) but no existing test
// drove the FIRST branch - an actual anomaly rendered as markdown - through
// renderCostHealthSection; only buildCostHealthSidecar's own
// resourceAnomalies array was ever asserted directly. Locks the rendered
// line's shape (role, MB, trend arrow, cpu%) so the refactor did not
// silently change it.
test('an actual anomaly renders its role, rss in MB, and cpu percent with trend arrows', () => {
  const resourceTrendsByRole = {
    coder: {
      currentRssBytes: 220_000_000, currentCpuPercent: 7.5,
      rssTrend: { direction: 'up', delta: 20_000_000, priorValue: 200_000_000, currentValue: 220_000_000, series: [] },
      cpuTrend: { direction: 'down', delta: -1, priorValue: 8.5, currentValue: 7.5, series: [] },
    },
  };
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, resourceTrendsByRole, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  const text = renderCostHealthSection(sidecar);
  assert.match(text, /\*\*Resource anomalies:\*\*/);
  assert.match(text, /- coder: 210MB ↑, 7\.5% cpu ↓/);
  assert.doesNotMatch(text, /none found/);
});

// ── BL-822: host load must be consulted by the "none found" verdict, both
//    the JSON field and the rendered prose (invariant 1 - the load-bearing
//    half of the ticket) ──────────────────────────────────────────────────

const QUIET_TREND = { direction: 'flat', delta: 0, priorValue: 5, currentValue: 5, series: [] };
function quietRoleTrends() {
  return { coder: { currentRssBytes: 100_000_000, currentCpuPercent: 5, rssTrend: { ...QUIET_TREND, priorValue: 100_000_000, currentValue: 100_000_000 }, cpuTrend: QUIET_TREND } };
}
function anomalousRoleTrends() {
  return {
    coder: {
      currentRssBytes: 220_000_000, currentCpuPercent: 5,
      rssTrend: { direction: 'up', delta: 20_000_000, priorValue: 200_000_000, currentValue: 220_000_000, series: [] },
      cpuTrend: QUIET_TREND,
    },
  };
}

// BL-822 severe-host-load-is-reported-01
test('a sustained severe host load is reported even when every role trend is quiet', () => {
  const sidecar = buildWithHostLoad({ severe: true, ratio: 20, sustainedMinutes: 240 }, quietRoleTrends());
  assert.equal(sidecar.hostLoad.severe, true);
  const text = renderCostHealthSection(sidecar);
  assert.doesNotMatch(text, /none found/);
  assert.match(text, /\*\*Resource anomalies:\*\*/);
  assert.match(text, /host load/);
});

// BL-822 role-anomaly-does-not-mask-host-load-02: the anti-vacuity check -
// a role anomaly is ALSO present, so an assertion that only checks "none
// found is absent" would pass for the wrong reason; this also asserts the
// host-load line and the anomaly line both appear.
test('a per-role anomaly present at the same time as severe host load does not mask either signal', () => {
  const sidecar = buildWithHostLoad({ severe: true, ratio: 20, sustainedMinutes: 240 }, anomalousRoleTrends());
  assert.equal(sidecar.hostLoad.severe, true);
  assert.deepEqual(sidecar.resourceAnomalies.map((a) => a.role), ['coder']);
  const text = renderCostHealthSection(sidecar);
  assert.doesNotMatch(text, /none found/);
  assert.match(text, /host load/);
  assert.match(text, /- coder:/);
});

// BL-822 quiet-host-still-reports-none-found-03
test('a genuinely quiet host still reports none found', () => {
  const sidecar = buildWithHostLoad({ severe: false, ratio: 1.5, sustainedMinutes: 240 }, quietRoleTrends());
  assert.equal(sidecar.hostLoad.severe, false);
  const text = renderCostHealthSection(sidecar);
  assert.match(text, /Resource anomalies:.*none found/);
});

// BL-822 role-anomalies-remain-additive-04
test('a per-role anomaly still surfaces on its own when the host was quiet', () => {
  const sidecar = buildWithHostLoad({ severe: false, ratio: 1.5, sustainedMinutes: 240 }, anomalousRoleTrends());
  assert.deepEqual(sidecar.resourceAnomalies.map((a) => a.role), ['coder']);
  assert.equal(sidecar.hostLoad.severe, false);
  const text = renderCostHealthSection(sidecar);
  assert.match(text, /- coder:/);
  assert.doesNotMatch(text, /host load/);
});

// BL-822 host-load-does-not-imply-role-sampling-06
test('a recorded severe host load never stands in for per-role sampling having run', () => {
  const sidecar = buildWithHostLoad({ severe: true, ratio: 20, sustainedMinutes: 240 }, {});
  assert.equal(sidecar.resourceSamplesObserved, false);
  assert.equal(sidecar.hostLoad.severe, true);
});

test('computeCostHealthSidecar folds in a real host-load verdict without throwing on an empty target, and reflects an injected severe sample', () => {
  const targetPath = mkTmpDir('sfvc-costhealth-hostload-');
  appendHostLoadSample(targetPath, 20, Date.now());
  const sidecar = computeCostHealthSidecar(targetPath, [{ role: 'coder', worktreePath: targetPath }]);
  assert.ok(sidecar.hostLoad);
  assert.equal(typeof sidecar.hostLoad.severe, 'boolean');
});

// BL-897: with a usable shared snapshotPath given, the flow-balance and
// flowBalance.speccedPerDay reflects the SNAPSHOT's records, not a fresh
// runGitLog walk against an empty target (which would derive zero
// lifecycles) - a nonzero today's-specced-count on an otherwise-empty
// fixture proves the snapshot won. speccedPerDay.value is trendedFromSeries'
// LATEST (today's) bucket, so the fixture ticket is specced today.
test('computeCostHealthSidecar uses a shared snapshotPath for lifecycles when one is given and usable', () => {
  const targetPath = mkTmpDir('sfvc-costhealth-snapshot-');
  const nowMs = Date.now();
  const snapshotPath = path.join(targetPath, 'snapshot.json');
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(serializeLifecycleSnapshot([lifecycle('ZZ-90004', new Date(nowMs).toISOString(), null)], nowMs), null, 2),
    'utf8'
  );

  const sidecar = computeCostHealthSidecar(targetPath, [{ role: 'coder', worktreePath: targetPath }], nowMs, undefined, snapshotPath);

  assert.equal(sidecar.flowBalance.speccedPerDay.value, 1);
});

test('computeCostHealthSidecar falls back to deriving its own history when snapshotPath is missing/unreadable', () => {
  const targetPath = mkTmpDir('sfvc-costhealth-snapshot-');
  assert.doesNotThrow(() =>
    computeCostHealthSidecar(targetPath, [{ role: 'coder', worktreePath: targetPath }], Date.now(), undefined, '/no/such/snapshot.json')
  );
});

// ── writeCostHealthSidecar / commitCostHealthSidecar / sidecarPath ──────

function mkTmp() {
  return mkTmpDir('sfvc-cost-sidecar-');
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
  copySeededRepoInto(target);

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
  copySeededRepoInto(target);

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
  copySeededRepoInto(target);

  assert.doesNotThrow(() => computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }]));
  const sidecar = computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }]);
  assert.equal(sidecar.schemaVersion, COST_HEALTH_SIDECAR_SCHEMA_VERSION);
  assert.deepEqual(sidecar.topExpensiveTickets, []);
});

// ── BL-635: computeCostHealthSidecar reads the real durable bounce log ──

test('computeCostHealthSidecar folds real .swarmforge/bounces/ records into flowBalance.rework', () => {
  const target = mkTmp();
  copySeededRepoInto(target);

  const nowMs = Date.parse('2026-07-26T12:00:00.000Z');
  fs.mkdirSync(path.join(target, '.swarmforge', 'bounces'), { recursive: true });
  fs.writeFileSync(path.join(target, '.swarmforge', 'bounces', '2026-07.jsonl'), JSON.stringify(bounceRecord({ at: '2026-07-26T09:00:00.000Z' })) + '\n');

  const sidecar = computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }], nowMs);
  // this fixture repo closes no tickets, so the role's current-window value
  // is legitimately unavailable (null) - the KEY existing is the proof the
  // real bounce log was read and folded in, not a truthy value.
  assert.ok(Object.prototype.hasOwnProperty.call(sidecar.flowBalance.rework.roundsPerClose, 'architect'));
  assert.deepEqual(sidecar.flowBalance.rework.maxRounds, { ticket: 'BL-590', rounds: 1, by: 'architect' });
});

test('computeCostHealthSidecar derives closed-ticket dates from real git history, excluding a still-open ticket', () => {
  const target = mkTmp();
  copySeededRepoInto(target);

  fs.mkdirSync(path.join(target, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(target, 'backlog', 'active', 'BL-700-open.yaml'), 'id: BL-700\n');
  fs.writeFileSync(path.join(target, 'backlog', 'active', 'BL-701-closed.yaml'), 'id: BL-701\n');
  git(target, ['add', '-A']);
  git(target, ['commit', '-q', '-m', 'spec BL-700 and BL-701'], '2026-08-02T00:00:00Z');

  fs.mkdirSync(path.join(target, 'backlog', 'done'), { recursive: true });
  execFileSync('git', ['-C', target, 'mv', 'backlog/active/BL-701-closed.yaml', 'backlog/done/BL-701-closed.yaml'], { stdio: 'ignore' });
  git(target, ['commit', '-q', '-m', 'close BL-701'], '2026-08-10T00:00:00Z');

  const nowMs = Date.parse('2026-08-15T12:00:00.000Z');
  fs.mkdirSync(path.join(target, '.swarmforge', 'bounces'), { recursive: true });
  fs.writeFileSync(
    path.join(target, '.swarmforge', 'bounces', '2026-08.jsonl'),
    JSON.stringify(bounceRecord({ ticket: 'BL-701', at: '2026-08-10T09:00:00.000Z' })) + '\n'
  );

  const sidecar = computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }], nowMs);
  // BL-701 closed inside the current 7-day window with one recorded bounce
  // - a real 1.0 figure proves BL-701's own close date reached the metric
  // and the still-open BL-700 (closeDateIso null) never corrupted the count.
  assert.equal(sidecar.flowBalance.rework.roundsPerClose.architect.value, 1);
});

// ── BL-312: master-resident worktreePath collision reaches the sidecar too ──

test('BL-312 burn-meter-master-resident-04: coordinator+specifier sharing one worktreePath appear as ONE combined sidecar agent, not two byte-identical day-totals', () => {
  const target = mkTmp();
  copySeededRepoInto(target);

  const sidecar = computeCostHealthSidecar(target, [
    { role: 'coordinator', worktreePath: target },
    { role: 'specifier', worktreePath: target },
  ]);
  assert.deepEqual(
    sidecar.agents.map((a) => a.role),
    ['coordinator+specifier']
  );
});

// ── BL-290: suiteDurationTrend rides the same sidecar ────────────────────

test('BL-290 suite-duration-pwa-01: buildCostHealthSidecar carries the given suiteDurationTrend verbatim', () => {
  const trend = { hasLocalData: true, dailySeries: [{ periodStart: '2026-07-09T00:00:00Z', value: 45000 }], trend: { direction: 'flat', delta: 0, currentValue: 45000, priorValue: 45000, series: [] }, warn: false };
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], [], undefined, trend);
  assert.deepEqual(sidecar.suiteDurationTrend, trend);
});

test('BL-290: suiteDurationTrend is omitted entirely (not null) when none is given, matching costHealth\'s own additive-optional convention', () => {
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  assert.equal(Object.prototype.hasOwnProperty.call(sidecar, 'suiteDurationTrend'), false);
});

test('BL-290: computeCostHealthSidecar folds in a real suiteDurationTrend without throwing on an empty target', () => {
  const target = mkTmp();
  copySeededRepoInto(target);

  const sidecar = computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }]);
  assert.equal(sidecar.suiteDurationTrend.hasLocalData, false, 'no .test-durations.jsonl exists in this fixture, so hasLocalData must be false, never fabricated');
});

// ── BL-338: average cost per ticket + trend rides the same sidecar ─────

test('BL-338: buildCostHealthSidecar carries the given costPerTicketSeries as a value+trend+basis summary', () => {
  const costPerTicketSeries = {
    series: [
      { periodStart: '2026-06-28T00:00:00.000Z', value: 12 },
      { periodStart: '2026-07-05T00:00:00.000Z', value: 8 },
    ],
    sampleCount: 5,
    excludedCount: 1,
  };
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], [], undefined, undefined, costPerTicketSeries);
  assert.equal(sidecar.costPerTicket.average.value, 8);
  assert.equal(sidecar.costPerTicket.average.trend.direction, 'down');
  assert.equal(sidecar.costPerTicket.sampleCount, 5);
  assert.equal(sidecar.costPerTicket.excludedCount, 1);
  assert.deepEqual(sidecar.costPerTicket.series, costPerTicketSeries.series);
  assert.match(sidecar.costPerTicket.basis, /includes/i);
  assert.match(sidecar.costPerTicket.basis, /exclud/i);
});

test('BL-338: costPerTicket reports average null (not $0) when no delivered ticket has a priced cost yet', () => {
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], [], undefined, undefined, { series: [], sampleCount: 0, excludedCount: 0 });
  assert.equal(sidecar.costPerTicket.average, null);
});

test('BL-338: costPerTicket is omitted entirely (not null) when none is given, matching the sidecar\'s own additive-optional convention', () => {
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  assert.equal(Object.prototype.hasOwnProperty.call(sidecar, 'costPerTicket'), false);
});

test('BL-338: the rendered briefing section shows the figure with its accounting basis attached', () => {
  const sidecar = buildCostHealthSidecar(
    '2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], [],
    undefined, undefined,
    { series: [{ periodStart: '2026-07-05T00:00:00.000Z', value: 8 }], sampleCount: 5, excludedCount: 1 }
  );
  const text = renderCostHealthSection(sidecar);
  assert.match(text, /Average cost\/ticket:\*\* \$8\.00/);
  assert.match(text, /over 5 delivered ticket\(s\), 1 delivered ticket\(s\) excluded/);
  assert.match(text, /includes/i);
});

test('BL-338: computeCostHealthSidecar folds in a real costPerTicket summary without throwing on an empty target', () => {
  const target = mkTmp();
  copySeededRepoInto(target);

  const sidecar = computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }]);
  assert.equal(sidecar.costPerTicket.average, null, 'no delivered ticket exists in this empty fixture, so the average must be null, never fabricated');
  assert.equal(sidecar.costPerTicket.sampleCount, 0);
});

test('BL-338: computeCostHealthSidecar accepts an injectable claudeProjectsDir, matching computeCostTelemetry\'s own testability seam', () => {
  const target = mkTmp();
  copySeededRepoInto(target);

  const claudeProjectsDir = mkTmp();
  const slug = target.replace(/[/.]/g, '-');
  fs.mkdirSync(path.join(claudeProjectsDir, slug), { recursive: true });
  fs.writeFileSync(
    path.join(claudeProjectsDir, slug, 's1.jsonl'),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-07-09T12:00:00Z',
      message: { id: 'm1', model: 'claude-sonnet-5', usage: { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    }) + '\n'
  );

  const sidecar = computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }], Date.parse('2026-07-09T18:00:00Z'), claudeProjectsDir);
  assert.equal(sidecar.agents[0].costUsd.value, 3, 'expected the injected 1M priced input tokens ($3/Mtok) to reach the sidecar via the injected claudeProjectsDir');
});

// ── BL-551 (sidecar-09): top expensive LLM-invocation origins per horizon ─

function llmOrigin(overrides = {}) {
  return {
    subsystem: 'pipeline',
    role: 'coder',
    stage: 'coder',
    trigger: 'handoff',
    ticketId: 'BL-551',
    handoffId: 'h1',
    handoffType: 'git_handoff',
    script: null,
    pack: null,
    model: 'claude-sonnet-5',
    provider: 'claude',
    ...overrides,
  };
}

function llmInvocation(overrides = {}) {
  return {
    type: 'llm_invocation',
    at: '2026-07-09T12:00:00Z',
    model: 'claude-sonnet-5',
    tokens: null,
    costUsd: 1,
    origin: llmOrigin(),
    ...overrides,
  };
}

function writeLlmLedger(target, records) {
  const dir = llmCostTelemetryDir(target);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'llm-cost-2026-07.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

test('BL-551: buildCostHealthSidecar carries the given topExpensiveOriginsByHorizon verbatim', () => {
  const byHorizon = { '3h': [], '24h': [{ key: { role: 'coder' }, costUsd: 4, syntheticCostUsd: 0, invocationCount: 2, unknownCostCount: 0, unknownSyntheticPriceCount: 0 }], '7d': [] };
  const sidecar = buildCostHealthSidecar(
    '2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], [],
    undefined, undefined, undefined, byHorizon
  );
  assert.deepEqual(sidecar.topExpensiveOriginsByHorizon, byHorizon);
});

test('BL-551: topExpensiveOriginsByHorizon is omitted entirely (not null) when none is given, matching the sidecar\'s own additive-optional convention', () => {
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  assert.equal(Object.prototype.hasOwnProperty.call(sidecar, 'topExpensiveOriginsByHorizon'), false);
});

test('BL-551: the rendered briefing section lists rolled-up origins with their summed cost, per horizon', () => {
  const byHorizon = {
    '3h': [],
    '24h': [{ key: { role: 'coder', trigger: 'handoff' }, costUsd: 4, syntheticCostUsd: 0, invocationCount: 2, unknownCostCount: 0, unknownSyntheticPriceCount: 0 }],
    '7d': [],
  };
  const sidecar = buildCostHealthSidecar(
    '2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], [],
    undefined, undefined, undefined, byHorizon
  );
  const text = renderCostHealthSection(sidecar);
  assert.match(text, /Top expensive origins:/);
  assert.match(text, /24h:/);
  assert.match(text, /coder\/handoff: \$4\.00/);
});

test('BL-551: an origin group with unpriced invocations notes the unpriced count, never folding it into the total', () => {
  const byHorizon = { '3h': [], '24h': [{ key: { role: 'coder' }, costUsd: 4, invocationCount: 2, unknownCostCount: 1 }], '7d': [] };
  const sidecar = buildCostHealthSidecar(
    '2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], [],
    undefined, undefined, undefined, byHorizon
  );
  const text = renderCostHealthSection(sidecar);
  assert.match(text, /coder: \$4\.00 \(1 unpriced\)/);
});

test('BL-551: an origin group whose every key value is null falls back to the "unknown origin" label', () => {
  const byHorizon = { '3h': [], '24h': [{ key: { role: null, trigger: null }, costUsd: 4, syntheticCostUsd: 0, invocationCount: 1, unknownCostCount: 0, unknownSyntheticPriceCount: 0 }], '7d': [] };
  const sidecar = buildCostHealthSidecar(
    '2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], [],
    undefined, undefined, undefined, byHorizon
  );
  const text = renderCostHealthSection(sidecar);
  assert.match(text, /unknown origin: \$4\.00/);
});

test('BL-551: the rendered section omits "Top expensive origins" entirely when every horizon is empty', () => {
  const byHorizon = { '3h': [], '24h': [], '7d': [] };
  const sidecar = buildCostHealthSidecar(
    '2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], [],
    undefined, undefined, undefined, byHorizon
  );
  const text = renderCostHealthSection(sidecar);
  assert.doesNotMatch(text, /Top expensive origins/);
});

test('BL-551: computeCostHealthSidecar folds in real ledger rollups without throwing on an empty target', () => {
  const target = mkTmp();
  copySeededRepoInto(target);

  const sidecar = computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }]);
  assert.deepEqual(sidecar.topExpensiveOriginsByHorizon, { '3h': [], '24h': [], '7d': [] }, 'no ledger exists in this empty fixture, so every horizon must be an empty rollup, never fabricated');
});

test('BL-551: computeCostHealthSidecar rolls up real ledger records for the horizon they fall inside', () => {
  const target = mkTmp();
  copySeededRepoInto(target);
  const nowMs = Date.parse('2026-07-09T18:00:00Z');
  writeLlmLedger(target, [
    llmInvocation({ at: '2026-07-09T17:00:00Z', costUsd: 5, origin: llmOrigin({ role: 'coder', trigger: 'handoff' }) }),
  ]);

  const sidecar = computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }], nowMs);
  assert.equal(sidecar.topExpensiveOriginsByHorizon['3h'].length, 1);
  assert.equal(sidecar.topExpensiveOriginsByHorizon['3h'][0].costUsd, 5);
  assert.deepEqual(sidecar.topExpensiveOriginsByHorizon['3h'][0].key, { role: 'coder', trigger: 'handoff' });
});

// ── BL-551 trend-series-11..trend-surface-15 (sidecar wiring) ────────────

test('BL-551: buildCostHealthSidecar carries the given originCostTrendSeries verbatim', () => {
  const series = [{ key: { role: 'coder' }, buckets: [{ bucketStartMs: 0, bucketEndMs: 1, costUsd: 4 }] }];
  const sidecar = buildCostHealthSidecar(
    '2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], [],
    undefined, undefined, undefined, undefined, series
  );
  assert.deepEqual(sidecar.originCostTrendSeries, series);
});

test('BL-551: originCostTrendSeries is omitted entirely (not null) when none is given', () => {
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  assert.equal(Object.prototype.hasOwnProperty.call(sidecar, 'originCostTrendSeries'), false);
});

test('BL-551: the rendered briefing section includes one line per ranked origin trend series', () => {
  const series = [
    { key: { role: 'coder' }, buckets: [{ bucketStartMs: 0, bucketEndMs: 1, costUsd: 1 }, { bucketStartMs: 1, bucketEndMs: 2, costUsd: 9 }] },
  ];
  const sidecar = buildCostHealthSidecar(
    '2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], [],
    undefined, undefined, undefined, undefined, series
  );
  const text = renderCostHealthSection(sidecar);
  assert.match(text, /Cost trend/);
  assert.match(text, /coder:/);
});

test('BL-551: the rendered section omits the cost trend block when no series is given', () => {
  const sidecar = buildCostHealthSidecar('2026-07-09', {}, {}, emptyReliabilitySeries('2026-07-09T00:00:00Z'), [], []);
  const text = renderCostHealthSection(sidecar);
  assert.doesNotMatch(text, /Cost trend/);
});

test('renderCostTrendChartLines draws each ranked origin as one line, latest measurement rightmost (trend-surface-15)', () => {
  const series = [
    { key: { role: 'coder' }, buckets: [{ bucketStartMs: 0, bucketEndMs: 1, costUsd: 1 }, { bucketStartMs: 1, bucketEndMs: 2, costUsd: 9 }] },
    { key: { role: 'qa' }, buckets: [{ bucketStartMs: 0, bucketEndMs: 1, costUsd: 2 }, { bucketStartMs: 1, bucketEndMs: 2, costUsd: 3 }] },
  ];
  const lines = renderCostTrendChartLines(series);
  const coderLine = lines.find((l) => l.includes('coder:'));
  const qaLine = lines.find((l) => l.includes('qa:'));
  assert.ok(coderLine, 'expected one line for the coder origin');
  assert.ok(qaLine, 'expected one line for the qa origin');
  assert.ok(coderLine.indexOf('9.00') > coderLine.indexOf('1.00'), 'expected the latest (rightmost) bucket value to appear after the oldest');
});

test('renderCostTrendChartLines returns no lines when there is no series to draw', () => {
  assert.deepEqual(renderCostTrendChartLines([]), []);
});

test('BL-551: computeCostHealthSidecar wires real ledger records into a rolling origin trend series', () => {
  const target = mkTmp();
  copySeededRepoInto(target);
  const nowMs = Date.parse('2026-07-09T18:00:00Z');
  writeLlmLedger(target, [
    llmInvocation({ at: '2026-07-09T17:00:00Z', costUsd: 5, origin: llmOrigin({ role: 'coder', trigger: 'handoff' }) }),
  ]);

  const sidecar = computeCostHealthSidecar(target, [{ role: 'coder', worktreePath: target }], nowMs);
  assert.ok(Array.isArray(sidecar.originCostTrendSeries));
  assert.equal(sidecar.originCostTrendSeries.length, 1);
  assert.deepEqual(sidecar.originCostTrendSeries[0].key, { role: 'coder', trigger: 'handoff', script: null });
});
