const assert = require('node:assert/strict');
const { totalCostByTicket, computeCostPerTicketSeries, COST_PER_TICKET_BASIS } = require('../out/metrics/costPerTicket');

function lifecycle(ticketId, specDateIso, closeDateIso = null) {
  return { ticketId, specDateIso, closeDateIso };
}

function attributed(costUsd) {
  return { usage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, costUsd };
}

// ── totalCostByTicket (pure) ─────────────────────────────────────────────

test('sums a ticket\'s cost across every role, excluding the unattributed bucket', () => {
  const costTelemetryByRole = {
    coder: { byDay: {}, byTicket: { 'BL-001': attributed(5), unattributed: attributed(999) } },
    cleaner: { byDay: {}, byTicket: { 'BL-001': attributed(3) } },
  };
  const totals = totalCostByTicket(costTelemetryByRole);
  assert.equal(totals['BL-001'], 8);
  assert.equal(totals.unattributed, undefined);
});

test('a ticket with recorded usage but no priced model anywhere reports null, never $0', () => {
  const costTelemetryByRole = {
    coder: { byDay: {}, byTicket: { 'BL-002': attributed(null) } },
  };
  const totals = totalCostByTicket(costTelemetryByRole);
  assert.equal(totals['BL-002'], null);
});

test('a ticket priced under one role but unpriced under another still sums the priced part', () => {
  const costTelemetryByRole = {
    coder: { byDay: {}, byTicket: { 'BL-003': attributed(4) } },
    cleaner: { byDay: {}, byTicket: { 'BL-003': attributed(null) } },
  };
  const totals = totalCostByTicket(costTelemetryByRole);
  assert.equal(totals['BL-003'], 4);
});

// ── computeCostPerTicketSeries (pure) ────────────────────────────────────

test('averages delivered-ticket costs per week, derived from real per-role usage', () => {
  const lifecycles = [
    lifecycle('BL-001', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z'),
    lifecycle('BL-002', '2026-07-01T00:00:00Z', '2026-07-03T00:00:00Z'),
  ];
  const costTelemetryByRole = {
    coder: { byDay: {}, byTicket: { 'BL-001': attributed(10), 'BL-002': attributed(20) } },
  };
  const result = computeCostPerTicketSeries(lifecycles, costTelemetryByRole);
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].value, 15);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.excludedCount, 0);
});

// BL-312: costTelemetryByRole is already keyed by the combined,
// non-double-counted role group (e.g. "coordinator+specifier") - this test
// pins that a master-resident role's single combined entry is counted once
// toward the ticket total, not smeared across two independent role names.
test('a master-resident role\'s combined entry counts once toward the ticket total', () => {
  const lifecycles = [lifecycle('BL-010', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z')];
  const costTelemetryByRole = {
    'coordinator+specifier': { byDay: {}, byTicket: { 'BL-010': attributed(9) } },
  };
  const result = computeCostPerTicketSeries(lifecycles, costTelemetryByRole);
  assert.equal(result.series[0].value, 9);
  assert.equal(result.sampleCount, 1);
});

test('rework from a bounce is included: a ticket held twice by the same role sums both windows\' cost', () => {
  const lifecycles = [lifecycle('BL-020', '2026-07-01T00:00:00Z', '2026-07-05T00:00:00Z')];
  // attributeUsageToTickets already merges every hold's usage under one
  // ticketId key per role - this fixture models that merged output directly
  // (its own producer, costTelemetry.ts, is what performs the merge).
  const costTelemetryByRole = {
    coder: { byDay: {}, byTicket: { 'BL-020': attributed(6 /* first pass */ + 4 /* bounced rework pass */) } },
  };
  const result = computeCostPerTicketSeries(lifecycles, costTelemetryByRole);
  assert.equal(result.series[0].value, 10);
});

test('a not-yet-delivered ticket (no closeDateIso) is excluded from the average, not counted as excluded-for-cost', () => {
  const lifecycles = [lifecycle('BL-030', '2026-07-01T00:00:00Z', null)];
  const costTelemetryByRole = { coder: { byDay: {}, byTicket: { 'BL-030': attributed(50) } } };
  const result = computeCostPerTicketSeries(lifecycles, costTelemetryByRole);
  assert.equal(result.series.length, 0);
  assert.equal(result.sampleCount, 0);
  assert.equal(result.excludedCount, 0);
});

test('a delivered ticket with no priced usage anywhere is excluded from the average and tallied, never treated as $0', () => {
  const lifecycles = [
    lifecycle('BL-040', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z'),
    lifecycle('BL-041', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z'),
  ];
  const costTelemetryByRole = {
    coder: { byDay: {}, byTicket: { 'BL-040': attributed(10), 'BL-041': attributed(null) } },
  };
  const result = computeCostPerTicketSeries(lifecycles, costTelemetryByRole);
  assert.equal(result.series[0].value, 10);
  assert.equal(result.sampleCount, 1);
  assert.equal(result.excludedCount, 1);
});

test('a delivered ticket with no recorded usage under any role is excluded and tallied', () => {
  const lifecycles = [lifecycle('BL-050', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z')];
  const result = computeCostPerTicketSeries(lifecycles, {});
  assert.equal(result.series.length, 0);
  assert.equal(result.excludedCount, 1);
});

test('an empty week between deliveries is omitted from the series, never filled with a fabricated $0', () => {
  const lifecycles = [
    lifecycle('BL-060', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z'),
    lifecycle('BL-061', '2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z'),
  ];
  const costTelemetryByRole = {
    coder: { byDay: {}, byTicket: { 'BL-060': attributed(10), 'BL-061': attributed(20) } },
  };
  const result = computeCostPerTicketSeries(lifecycles, costTelemetryByRole);
  assert.equal(result.series.length, 2);
  assert.ok(result.series.every((p) => p.value === 10 || p.value === 20));
});

test('the trend over time is visible across more than one delivery period', () => {
  const lifecycles = [
    lifecycle('BL-070', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z'),
    lifecycle('BL-071', '2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z'),
  ];
  const costTelemetryByRole = {
    coder: { byDay: {}, byTicket: { 'BL-070': attributed(20), 'BL-071': attributed(10) } },
  };
  const result = computeCostPerTicketSeries(lifecycles, costTelemetryByRole);
  assert.equal(result.series[0].value, 20);
  assert.equal(result.series[1].value, 10);
});

test('the accounting basis text states both what is included and what is excluded', () => {
  assert.match(COST_PER_TICKET_BASIS, /includes/i);
  assert.match(COST_PER_TICKET_BASIS, /exclud/i);
  assert.match(COST_PER_TICKET_BASIS, /rework/i);
});
