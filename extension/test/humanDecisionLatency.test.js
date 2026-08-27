const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const {
  deriveTicketDecisionLatency,
  partitionDecisionLatencies,
  aggregateDecisionLatency,
  trendForDecisionLatencyMedian,
} = require('../out/metrics/humanDecisionLatency');

test('deriveTicketDecisionLatency computes verdict minus ask for decided tickets', () => {
  const d = deriveTicketDecisionLatency(
    { ticketId: 'BL-100', gate: 'approve', askAtMs: 1000, verdictAtMs: 3700000 },
    5000000
  );
  assert.equal(d.latencyMs, 3699000);
  assert.equal(d.gate, 'approve');
  assert.equal(d.openAgeMs, undefined);
});

test('deriveTicketDecisionLatency reports open age when verdict is absent', () => {
  const d = deriveTicketDecisionLatency({ ticketId: 'BL-300', gate: 'approve', askAtMs: 1000 }, 601000);
  assert.equal(d.openAgeMs, 600000);
  assert.equal(d.latencyMs, undefined);
});

test('aggregateDecisionLatency splits extreme latencies as outliers', () => {
  const decided = [
    { ticketId: 'BL-1', gate: 'approve', latencyMs: 60000, verdictAtMs: Date.parse('2026-01-01T12:00:00Z') },
    { ticketId: 'BL-2', gate: 'approve', latencyMs: 65000, verdictAtMs: Date.parse('2026-01-01T13:00:00Z') },
    { ticketId: 'BL-3', gate: 'approve', latencyMs: 70000, verdictAtMs: Date.parse('2026-01-01T14:00:00Z') },
    { ticketId: 'BL-4', gate: 'approve', latencyMs: 72000, verdictAtMs: Date.parse('2026-01-01T15:00:00Z') },
    { ticketId: 'BL-5', gate: 'approve', latencyMs: 3_700_000, verdictAtMs: Date.parse('2026-01-01T16:00:00Z') },
  ];
  const nowMs = Date.parse('2026-01-02T00:00:00Z');
  const agg = aggregateDecisionLatency(decided, [], nowMs);
  const day = agg.windows.find((w) => w.decidedCount === 5);
  assert.ok(day);
  assert.ok(day.outliersMs.length >= 1);
  assert.ok(day.outliersMs.includes(3_700_000));
});

test('pending asks stay out of decided window counts', () => {
  const { decided, openWaits } = partitionDecisionLatencies(
    [{ ticketId: 'BL-300', gate: 'approve', askAtMs: 1000 }],
    601000
  );
  assert.equal(decided.length, 0);
  assert.equal(openWaits.length, 1);
  const agg = aggregateDecisionLatency(decided, openWaits, 601000);
  assert.equal(agg.windows.every((w) => w.decidedCount === 0), true);
  assert.equal(agg.openWaits.length, 1);
});

test('trendForDecisionLatencyMedian reports current prior and direction', () => {
  const windows = [
    { periodStart: '2026-01-01T00:00:00.000Z', medianMs: 60000, outliersMs: [], decidedCount: 2 },
    { periodStart: '2026-01-02T00:00:00.000Z', medianMs: 90000, outliersMs: [], decidedCount: 3 },
  ];
  const trend = trendForDecisionLatencyMedian(windows);
  assert.equal(trend.currentValue, 90000);
  assert.equal(trend.priorValue, 60000);
  assert.equal(trend.direction, 'up');
});

test('trend.ts does not re-export trendForDecisionLatencyMedian (acyclic)', () => {
  const trendPath = require('node:path').join(__dirname, '..', 'src', 'metrics', 'trend.ts');
  const src = require('node:fs').readFileSync(trendPath, 'utf8');
  assert.equal(
    /export\s*\{[^}]*trendForDecisionLatencyMedian/.test(src) ||
      /export\s*\*\s*from\s*['"]\.\/humanDecisionLatency['"]/.test(src),
    false,
    'trend.ts must not re-export humanDecisionLatency helpers (dep-gate acyclic)'
  );
  const latency = require('../out/metrics/humanDecisionLatency');
  assert.equal(typeof latency.trendForDecisionLatencyMedian, 'function');
});
