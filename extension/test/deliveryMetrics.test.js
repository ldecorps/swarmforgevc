const assert = require('node:assert/strict');
const {
  computeVelocity,
  computeBurndown,
  computeCycleTime,
  computeForecasts,
  computeSuiteDurationTrend,
} = require('../out/metrics/deliveryMetrics');

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

// Mirrors the source's own (trivial, obviously-correct) floor-division
// bucketing so tests assert on real ISO boundaries without depending on the
// source module's internal constant names.
function weekBucketIso(iso) {
  return new Date(Math.floor(Date.parse(iso) / WEEK_MS) * WEEK_MS).toISOString();
}
function dayBucketIso(iso) {
  return new Date(Math.floor(Date.parse(iso) / DAY_MS) * DAY_MS).toISOString();
}

function lifecycle(ticketId, specDateIso, closeDateIso = null) {
  return { ticketId, specDateIso, closeDateIso };
}

// ── computeVelocity ───────────────────────────────────────────────────────

test('computeVelocity counts closes in the git-recorded week bucket (metrics-01)', () => {
  const NOW = Date.parse('2026-02-01T00:00:00Z');
  const lifecycles = [
    lifecycle('BL-001', '2026-01-01T00:00:00Z', '2026-01-05T00:00:00Z'),
    lifecycle('BL-002', '2026-01-01T00:00:00Z', '2026-01-06T00:00:00Z'),
    lifecycle('BL-003', '2026-01-01T00:00:00Z', '2026-01-20T00:00:00Z'),
  ];
  const result = computeVelocity(lifecycles, NOW);
  const week1 = result.weeklySeries.find((p) => p.periodStart === weekBucketIso('2026-01-05T00:00:00Z'));
  const week3 = result.weeklySeries.find((p) => p.periodStart === weekBucketIso('2026-01-20T00:00:00Z'));
  assert.equal(week1.value, 2);
  assert.equal(week3.value, 1);
});

test('computeVelocity recomputing on the same history yields the identical series (metrics-01)', () => {
  const NOW = Date.parse('2026-02-01T00:00:00Z');
  const lifecycles = [lifecycle('BL-001', '2026-01-01T00:00:00Z', '2026-01-05T00:00:00Z')];
  assert.deepEqual(computeVelocity(lifecycles, NOW), computeVelocity(lifecycles, NOW));
});

test('computeVelocity fills gap weeks with zero so trend compares adjacent weeks', () => {
  const NOW = Date.parse('2026-01-05T00:00:00Z');
  const lifecycles = [
    lifecycle('BL-001', '2025-12-01T00:00:00Z', '2025-12-01T00:00:00Z'),
    lifecycle('BL-002', '2025-12-01T00:00:00Z', '2026-01-05T00:00:00Z'),
  ];
  const result = computeVelocity(lifecycles, NOW);
  const bucketStarts = result.weeklySeries.map((p) => p.periodStart);
  const uniqueSorted = [...new Set(bucketStarts)].sort();
  assert.deepEqual(bucketStarts, uniqueSorted, 'series must be sorted, contiguous, no duplicate buckets');
  for (let i = 1; i < bucketStarts.length; i++) {
    const gapMs = Date.parse(bucketStarts[i]) - Date.parse(bucketStarts[i - 1]);
    assert.equal(gapMs, WEEK_MS, 'every consecutive pair of buckets must be exactly one week apart');
  }
});

test('computeVelocity rollingWindowCount counts closes within the trailing window', () => {
  const NOW = Date.parse('2026-01-31T00:00:00Z');
  const lifecycles = [
    lifecycle('BL-001', '2026-01-01T00:00:00Z', '2026-01-30T00:00:00Z'), // within trailing 7d
    lifecycle('BL-002', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'), // outside trailing 7d
  ];
  const result = computeVelocity(lifecycles, NOW, 7);
  assert.equal(result.rollingWindowCount, 1);
});

test('computeVelocity ignores tickets never closed', () => {
  const NOW = Date.parse('2026-01-31T00:00:00Z');
  const lifecycles = [lifecycle('BL-001', '2026-01-01T00:00:00Z', null)];
  const result = computeVelocity(lifecycles, NOW);
  assert.equal(result.rollingWindowCount, 0);
  assert.ok(result.weeklySeries.every((p) => p.value === 0));
});

test('computeVelocity reports a trend from the weekly series', () => {
  const NOW = Date.parse('2026-01-10T00:00:00Z');
  const lifecycles = [
    lifecycle('BL-001', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
    lifecycle('BL-002', '2026-01-01T00:00:00Z', '2026-01-09T00:00:00Z'),
    lifecycle('BL-003', '2026-01-01T00:00:00Z', '2026-01-10T00:00:00Z'),
  ];
  const result = computeVelocity(lifecycles, NOW);
  assert.equal(result.trend.currentValue, 2);
  assert.equal(result.trend.priorValue, 1);
  assert.equal(result.trend.direction, 'up');
});

// ── computeBurndown ───────────────────────────────────────────────────────

test('computeBurndown reconstructs the remaining count for a milestone across history (metrics-02)', () => {
  const NOW = Date.parse('2026-01-20T00:00:00Z');
  const lifecycles = [
    lifecycle('BL-001', '2026-01-01T00:00:00Z', '2026-01-10T00:00:00Z'),
    lifecycle('BL-002', '2026-01-01T00:00:00Z', null),
  ];
  const milestoneByTicketId = new Map([
    ['BL-001', 'M2'],
    ['BL-002', 'M2'],
  ]);
  const [result] = computeBurndown(lifecycles, milestoneByTicketId, NOW);

  const beforeAnyClose = result.dailySeries.find((p) => p.periodStart === dayBucketIso('2026-01-05T00:00:00Z'));
  const afterFirstClose = result.dailySeries.find((p) => p.periodStart === dayBucketIso('2026-01-15T00:00:00Z'));
  assert.equal(beforeAnyClose.value, 2, 'both tickets specced and neither closed yet');
  assert.equal(afterFirstClose.value, 1, 'one ticket closed, one remains');
});

test('computeBurndown final point matches the current backlog folder state (metrics-02)', () => {
  const NOW = Date.parse('2026-01-20T00:00:00Z');
  const lifecycles = [
    lifecycle('BL-001', '2026-01-01T00:00:00Z', '2026-01-10T00:00:00Z'),
    lifecycle('BL-002', '2026-01-01T00:00:00Z', null),
    lifecycle('BL-003', '2026-01-01T00:00:00Z', null),
  ];
  const milestoneByTicketId = new Map([
    ['BL-001', 'M2'],
    ['BL-002', 'M2'],
    ['BL-003', 'M2'],
  ]);
  const [result] = computeBurndown(lifecycles, milestoneByTicketId, NOW);
  const lastPoint = result.dailySeries[result.dailySeries.length - 1];
  assert.equal(lastPoint.value, result.currentRemaining);
  assert.equal(result.currentRemaining, 2, 'BL-002 and BL-003 are still open');
});

test('computeBurndown excludes a ticket before its own spec date', () => {
  const NOW = Date.parse('2026-01-20T00:00:00Z');
  const lifecycles = [
    lifecycle('BL-001', '2026-01-01T00:00:00Z', null),
    lifecycle('BL-002', '2026-01-15T00:00:00Z', null), // specced later
  ];
  const milestoneByTicketId = new Map([
    ['BL-001', 'M2'],
    ['BL-002', 'M2'],
  ]);
  const [result] = computeBurndown(lifecycles, milestoneByTicketId, NOW);
  const beforeBL002Specced = result.dailySeries.find((p) => p.periodStart === dayBucketIso('2026-01-05T00:00:00Z'));
  assert.equal(beforeBL002Specced.value, 1, 'only BL-001 exists yet');
});

test('computeBurndown separates milestones into independent series', () => {
  const NOW = Date.parse('2026-01-20T00:00:00Z');
  const lifecycles = [
    lifecycle('BL-001', '2026-01-01T00:00:00Z', null),
    lifecycle('BL-002', '2026-01-01T00:00:00Z', null),
  ];
  const milestoneByTicketId = new Map([
    ['BL-001', 'M2'],
    ['BL-002', 'M3'],
  ]);
  const results = computeBurndown(lifecycles, milestoneByTicketId, NOW);
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((r) => r.milestone).sort(), ['M2', 'M3']);
  assert.ok(results.every((r) => r.currentRemaining === 1));
});

test('computeBurndown ignores tickets with no current milestone assignment', () => {
  const NOW = Date.parse('2026-01-20T00:00:00Z');
  const lifecycles = [lifecycle('BL-001', '2026-01-01T00:00:00Z', null)];
  const results = computeBurndown(lifecycles, new Map(), NOW);
  assert.deepEqual(results, []);
});

// ── computeCycleTime ─────────────────────────────────────────────────────

test('cycle time reflects the spec-to-close duration for a closed ticket (metrics-03)', () => {
  const NOW = Date.parse('2026-02-01T00:00:00Z');
  const lifecycles = [lifecycle('BL-001', '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z')];
  const result = computeCycleTime(lifecycles, NOW);
  assert.equal(result.medianMs, 2 * DAY_MS);
  assert.equal(result.sampleCount, 1);
});

test('cycle time median reflects the recent closed set (metrics-03)', () => {
  const NOW = Date.parse('2026-02-01T00:00:00Z');
  // Durations (days): 1, 2, 3, 4, 5 - closed on distinct recent dates.
  const lifecycles = [1, 2, 3, 4, 5].map((days, i) =>
    lifecycle(`BL-00${i + 1}`, '2026-01-01T00:00:00Z', new Date(Date.parse('2026-01-01T00:00:00Z') + days * DAY_MS).toISOString())
  );
  const result = computeCycleTime(lifecycles, NOW);
  assert.equal(result.medianMs, 3 * DAY_MS);
  assert.equal(result.sampleCount, 5);
});

test('cycle time p85 uses linear interpolation over the sorted recent durations', () => {
  const NOW = Date.parse('2026-02-01T00:00:00Z');
  const durationsDays = [1, 2, 3, 4, 5];
  const lifecycles = durationsDays.map((days, i) =>
    lifecycle(`BL-00${i + 1}`, '2026-01-01T00:00:00Z', new Date(Date.parse('2026-01-01T00:00:00Z') + days * DAY_MS).toISOString())
  );
  const result = computeCycleTime(lifecycles, NOW);
  // p85 of [1,2,3,4,5] (0-indexed rank = 0.85*4 = 3.4) -> between index 3 (4) and 4 (5), frac 0.4
  const expectedDays = 4 + (5 - 4) * 0.4;
  assert.ok(Math.abs(result.p85Ms - expectedDays * DAY_MS) < 1000, `expected ~${expectedDays}d, got ${result.p85Ms / DAY_MS}d`);
});

test('cycle time only considers the trailing recentWindow closes for the headline stat', () => {
  const NOW = Date.parse('2026-02-01T00:00:00Z');
  const lifecycles = [
    // huge duration, but closed long before BL-002 - excluded once window=1
    lifecycle('BL-001', '2020-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
    lifecycle('BL-002', '2026-01-30T00:00:00Z', '2026-01-31T00:00:00Z'),
  ];
  const result = computeCycleTime(lifecycles, NOW, 1);
  assert.equal(result.sampleCount, 1);
  assert.equal(result.medianMs, 1 * DAY_MS);
});

test('cycle time returns nulls with zero sample count when nothing has closed', () => {
  const NOW = Date.parse('2026-02-01T00:00:00Z');
  const result = computeCycleTime([lifecycle('BL-001', '2026-01-01T00:00:00Z', null)], NOW);
  assert.equal(result.medianMs, null);
  assert.equal(result.p85Ms, null);
  assert.equal(result.sampleCount, 0);
});

// ── computeForecasts ─────────────────────────────────────────────────────

function ticket(id, overrides = {}) {
  return { ticketId: id, ...overrides };
}

test('every open ticket carries a p50 and p85 forecast (metrics-08)', () => {
  const NOW = Date.parse('2026-02-01T00:00:00Z');
  const lifecycles = [1, 2, 3].map((d, i) =>
    lifecycle(`BL-C${i}`, '2026-01-01T00:00:00Z', new Date(Date.parse('2026-01-01T00:00:00Z') + d * DAY_MS).toISOString())
  );
  const openTickets = [ticket('BL-010', { priority: 1 }), ticket('BL-011', { priority: 2 })];
  const result = computeForecasts(lifecycles, openTickets, NOW);
  assert.equal(result.tickets.length, 2);
  for (const forecast of result.tickets) {
    assert.ok(forecast.p50Iso, `${forecast.ticketId} must have a p50 date`);
    assert.ok(forecast.p85Iso, `${forecast.ticketId} must have a p85 date`);
    assert.ok(Date.parse(forecast.p85Iso) >= Date.parse(forecast.p50Iso), 'p85 is never earlier than p50');
  }
});

test('a later-priority ticket is never forecast earlier than a higher-priority ticket ahead of it in the queue', () => {
  const NOW = Date.parse('2026-02-01T00:00:00Z');
  const lifecycles = [1, 2].map((d, i) =>
    lifecycle(`BL-C${i}`, '2026-01-01T00:00:00Z', new Date(Date.parse('2026-01-01T00:00:00Z') + d * DAY_MS).toISOString())
  );
  const openTickets = [ticket('BL-020', { priority: 5 }), ticket('BL-010', { priority: 1 })];
  const result = computeForecasts(lifecycles, openTickets, NOW);
  const high = result.tickets.find((t) => t.ticketId === 'BL-010');
  const low = result.tickets.find((t) => t.ticketId === 'BL-020');
  assert.ok(Date.parse(low.p50Iso) >= Date.parse(high.p50Iso));
});

test('no ticket\'s forecast precedes its depends_on tickets\' forecasts (metrics-08)', () => {
  const NOW = Date.parse('2026-02-01T00:00:00Z');
  const lifecycles = [1, 2].map((d, i) =>
    lifecycle(`BL-C${i}`, '2026-01-01T00:00:00Z', new Date(Date.parse('2026-01-01T00:00:00Z') + d * DAY_MS).toISOString())
  );
  // BL-030 is higher priority (earlier in queue) but depends on BL-040, which
  // must therefore push BL-030's forecast no earlier than BL-040's own.
  const openTickets = [
    ticket('BL-030', { priority: 1, dependsOn: ['BL-040'] }),
    ticket('BL-040', { priority: 9 }),
  ];
  const result = computeForecasts(lifecycles, openTickets, NOW);
  const dependent = result.tickets.find((t) => t.ticketId === 'BL-030');
  const dependency = result.tickets.find((t) => t.ticketId === 'BL-040');
  assert.ok(Date.parse(dependent.p50Iso) >= Date.parse(dependency.p50Iso));
  assert.ok(Date.parse(dependent.p85Iso) >= Date.parse(dependency.p85Iso));
});

test('a dependency on an already-closed ticket imposes no additional constraint', () => {
  const NOW = Date.parse('2026-02-01T00:00:00Z');
  const lifecycles = [lifecycle('BL-CLOSED', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')];
  const openTickets = [ticket('BL-050', { priority: 1, dependsOn: ['BL-CLOSED'] })];
  const result = computeForecasts(lifecycles, openTickets, NOW);
  assert.ok(result.tickets[0].p50Iso);
});

test('a milestone forecast is the latest (last-to-finish) date among its open member tickets (metrics-08)', () => {
  const NOW = Date.parse('2026-02-01T00:00:00Z');
  const lifecycles = [1, 2].map((d, i) =>
    lifecycle(`BL-C${i}`, '2026-01-01T00:00:00Z', new Date(Date.parse('2026-01-01T00:00:00Z') + d * DAY_MS).toISOString())
  );
  const openTickets = [
    ticket('BL-060', { priority: 1, milestone: 'M9' }),
    ticket('BL-061', { priority: 2, milestone: 'M9' }),
  ];
  const result = computeForecasts(lifecycles, openTickets, NOW);
  const milestone = result.milestones.find((m) => m.milestone === 'M9');
  const laterTicket = result.tickets.reduce((a, b) => (Date.parse(a.p50Iso) > Date.parse(b.p50Iso) ? a : b));
  assert.equal(milestone.p50Iso, laterTicket.p50Iso);
});

test('depends_on entries with trailing prose or comma lists still resolve to real ticket ids', () => {
  const NOW = Date.parse('2026-02-01T00:00:00Z');
  const lifecycles = [1].map((d, i) =>
    lifecycle(`BL-C${i}`, '2026-01-01T00:00:00Z', new Date(Date.parse('2026-01-01T00:00:00Z') + d * DAY_MS).toISOString())
  );
  const openTickets = [
    ticket('BL-070', { priority: 1, dependsOn: ['BL-080, BL-081 (assignment notes)'] }),
    ticket('BL-080', { priority: 9 }),
    ticket('BL-081', { priority: 9 }),
  ];
  const result = computeForecasts(lifecycles, openTickets, NOW);
  const dependent = result.tickets.find((t) => t.ticketId === 'BL-070');
  const dep80 = result.tickets.find((t) => t.ticketId === 'BL-080');
  const dep81 = result.tickets.find((t) => t.ticketId === 'BL-081');
  assert.ok(Date.parse(dependent.p50Iso) >= Date.parse(dep80.p50Iso));
  assert.ok(Date.parse(dependent.p50Iso) >= Date.parse(dep81.p50Iso));
});

// ── computeSuiteDurationTrend (metrics-07) ──────────────────────────────

test('a machine without a local .test-durations.jsonl reports "no local data" without error', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-suite-trend-'));
  const result = computeSuiteDurationTrend(tmpDir, [], Date.now());
  assert.equal(result.hasLocalData, false);
  assert.deepEqual(result.dailySeries, []);
});

test('suite duration trend is derived from the local records and reports a trend', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-suite-trend-'));
  fs.mkdirSync(path.join(tmpDir, 'extension'), { recursive: true });
  const lines = [
    { finished_at: '2026-01-01T00:00:00Z', test_count: 10, result: 'pass', duration_ms: 1000 },
    { finished_at: '2026-01-02T00:00:00Z', test_count: 10, result: 'pass', duration_ms: 2000 },
  ];
  fs.writeFileSync(
    path.join(tmpDir, 'extension', '.test-durations.jsonl'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  );
  const result = computeSuiteDurationTrend(tmpDir, [], Date.parse('2026-01-03T00:00:00Z'));
  assert.equal(result.hasLocalData, true);
  assert.equal(result.dailySeries.length, 2);
  assert.equal(result.trend.direction, 'up');
});
