const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  sumUsage,
  computeDailyRoleUsage,
  attributeUsageToTickets,
  computeCostTelemetry,
} = require('../out/metrics/costTelemetry');

function usageRecord(overrides = {}) {
  return {
    messageId: 'm1',
    timestampMs: Date.parse('2026-07-09T08:00:00Z'),
    model: 'claude-sonnet-5',
    usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5 },
    ...overrides,
  };
}

// ── sumUsage (pure) ──────────────────────────────────────────────────────

test('sumUsage sums input/output/cache totals across records', () => {
  const totals = sumUsage([
    usageRecord({ usage: { inputTokens: 10, outputTokens: 5, cacheCreationTokens: 1, cacheReadTokens: 2 } }),
    usageRecord({ usage: { inputTokens: 20, outputTokens: 10, cacheCreationTokens: 3, cacheReadTokens: 4 } }),
  ]);
  assert.deepEqual(totals, { inputTokens: 30, outputTokens: 15, cacheCreationTokens: 4, cacheReadTokens: 6 });
});

test('sumUsage of an empty record list is all zeros', () => {
  assert.deepEqual(sumUsage([]), { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 });
});

// ── computeDailyRoleUsage (pure) — cost-01 ──────────────────────────────

test('per-agent daily token totals equal the sum of that role\'s transcript entries for the day (cost-01)', () => {
  const dayStart = Date.parse('2026-07-09T00:00:00Z');
  const recordsByRole = {
    coder: [
      usageRecord({ timestampMs: dayStart + 1000, usage: { inputTokens: 10, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
      usageRecord({ timestampMs: dayStart + 2000, usage: { inputTokens: 20, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
    ],
  };
  const result = computeDailyRoleUsage(recordsByRole);
  const dayKey = new Date(dayStart).toISOString();
  assert.equal(result.coder[dayKey].usage.inputTokens, 30);
  assert.equal(result.coder[dayKey].usage.outputTokens, 3);
});

test('records from different days land in separate day buckets', () => {
  const day1 = Date.parse('2026-07-09T00:00:00Z');
  const day2 = Date.parse('2026-07-10T00:00:00Z');
  const result = computeDailyRoleUsage({
    coder: [usageRecord({ timestampMs: day1 + 1000 }), usageRecord({ timestampMs: day2 + 1000 })],
  });
  assert.equal(Object.keys(result.coder).length, 2);
});

test('a role with no transcript records at all produces an empty day map, not an error (cost-07)', () => {
  const result = computeDailyRoleUsage({ coder: [] });
  assert.deepEqual(result.coder, {});
});

test('computeDailyRoleUsage reports estimated cost alongside tokens for a priced model', () => {
  const dayStart = Date.parse('2026-07-09T00:00:00Z');
  const result = computeDailyRoleUsage({
    coder: [usageRecord({ timestampMs: dayStart, model: 'claude-sonnet-5' })],
  });
  const dayKey = new Date(dayStart).toISOString();
  assert.ok(typeof result.coder[dayKey].costUsd === 'number');
  assert.ok(result.coder[dayKey].costUsd > 0);
});

// ── attributeUsageToTickets (pure) — cost-02 ────────────────────────────

test('usage inside a ticket\'s holding window is attributed to that ticket, and later usage to the next ticket (cost-02)', () => {
  const windows = [
    { ticketId: 'BL-100', startMs: Date.parse('2026-07-09T08:00:00Z'), endMs: Date.parse('2026-07-09T09:00:00Z') },
    { ticketId: 'BL-101', startMs: Date.parse('2026-07-09T09:00:00Z'), endMs: null },
  ];
  const records = [
    usageRecord({ timestampMs: Date.parse('2026-07-09T08:30:00Z') }), // inside BL-100's window
    usageRecord({ timestampMs: Date.parse('2026-07-09T09:30:00Z') }), // inside BL-101's window
  ];
  const result = attributeUsageToTickets(records, windows);
  assert.equal(result['BL-100'].usage.inputTokens, 100);
  assert.equal(result['BL-101'].usage.inputTokens, 100);
});

test('usage outside every holding window lands in the "unattributed" bucket, never silently dropped (cost-02)', () => {
  const windows = [{ ticketId: 'BL-100', startMs: Date.parse('2026-07-09T08:00:00Z'), endMs: Date.parse('2026-07-09T09:00:00Z') }];
  const records = [usageRecord({ timestampMs: Date.parse('2026-07-09T06:00:00Z') })]; // before any window
  const result = attributeUsageToTickets(records, windows);
  assert.equal(result.unattributed.usage.inputTokens, 100);
  assert.equal(result['BL-100'], undefined);
});

test('attributeUsageToTickets with no windows at all sends everything to unattributed', () => {
  const result = attributeUsageToTickets([usageRecord()], []);
  assert.equal(result.unattributed.usage.inputTokens, 100);
});

test('attributeUsageToTickets with no records reports an empty result, not an error (cost-07)', () => {
  assert.deepEqual(attributeUsageToTickets([], []), {});
});

// ── computeCostTelemetry (impure orchestrator, real fs) ─────────────────

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-cost-telemetry-'));
}

test('computeCostTelemetry wires transcripts + holding windows + pricing together for a role', () => {
  const worktree = mkTmp();
  const projectsDir = mkTmp();

  // Transcript: two messages, one inside BL-100's window.
  function slugFor(p) {
    return p.replace(/[/.]/g, '-');
  }
  const slugDir = path.join(projectsDir, slugFor(worktree));
  fs.mkdirSync(slugDir, { recursive: true });
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-07-09T08:30:00Z',
    message: { id: 'm1', model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
  fs.writeFileSync(path.join(slugDir, 's1.jsonl'), line + '\n');

  // Holding window: BL-100 held from 08:00 to 09:00.
  const completedDir = path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(completedDir, { recursive: true });
  fs.writeFileSync(
    path.join(completedDir, '00_test.handoff'),
    'task: BL-100-cost-telemetry\ndequeued_at: 2026-07-09T08:00:00Z\ncompleted_at: 2026-07-09T09:00:00Z\n\nbody\n'
  );

  const result = computeCostTelemetry(worktree, [{ role: 'coder', worktreePath: worktree }], projectsDir);
  assert.equal(result.coder.byTicket['BL-100'].usage.inputTokens, 100);
  assert.ok(result.coder.byTicket['BL-100'].costUsd > 0);
  assert.equal(Object.keys(result.coder.byDay).length, 1);
});

test('computeCostTelemetry degrades to empty/zero for a role with no transcripts and no telemetry (cost-07)', () => {
  const worktree = mkTmp();
  const projectsDir = mkTmp();
  const result = computeCostTelemetry(worktree, [{ role: 'coder', worktreePath: worktree }], projectsDir);
  assert.deepEqual(result.coder.byDay, {});
  assert.deepEqual(result.coder.byTicket, {});
});
