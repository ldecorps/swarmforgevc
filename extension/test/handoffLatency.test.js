const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  deriveHandoffLatency,
  deriveHandoffLatencyRecords,
  aggregateHandoffLatencyByRole,
  gatherRoleHandoffLatencyRecords,
} = require('../out/metrics/handoffLatency');

function writeHandoff(dir, filename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, filename), `${lines.join('\n')}\n\nbody\n`);
}

test('deriveHandoffLatency computes queue wait from enqueued and dequeued headers', () => {
  const record = deriveHandoffLatency({
    to: 'coder',
    enqueued_at: new Date(1000).toISOString(),
    dequeued_at: new Date(61000).toISOString(),
  });
  assert.equal(record?.status, 'processed');
  assert.equal(record?.latencyMs, 60000);
  assert.equal(record?.recipient, 'coder');
});

test('deriveHandoffLatency reports open wait when dequeued_at is absent', () => {
  const nowMs = Date.parse('2026-08-27T12:00:00.000Z');
  const record = deriveHandoffLatency(
    { to: 'coder', enqueued_at: '2026-08-27T10:00:00.000Z' },
    nowMs
  );
  assert.equal(record?.status, 'open');
  assert.equal(record?.openWaitMs, 2 * 60 * 60 * 1000);
});

test('aggregateHandoffLatencyByRole splits outliers per role', () => {
  const base = Date.parse('2026-08-27T10:00:00.000Z');
  const records = [
    { recipient: 'cleaner', status: 'processed', latencyMs: 30_000, enqueuedAtMs: base, dequeuedAtMs: base + 30_000 },
    { recipient: 'cleaner', status: 'processed', latencyMs: 35_000, enqueuedAtMs: base + 1000, dequeuedAtMs: base + 36_000 },
    { recipient: 'cleaner', status: 'processed', latencyMs: 40_000, enqueuedAtMs: base + 2000, dequeuedAtMs: base + 42_000 },
    { recipient: 'cleaner', status: 'processed', latencyMs: 45_000, enqueuedAtMs: base + 3000, dequeuedAtMs: base + 48_000 },
    { recipient: 'cleaner', status: 'processed', latencyMs: 900_000, enqueuedAtMs: base + 4000, dequeuedAtMs: base + 904_000 },
  ];
  const agg = aggregateHandoffLatencyByRole(records, {
    startMs: Date.parse('2026-08-27T09:00:00.000Z'),
    endMs: Date.parse('2026-08-27T13:00:00.000Z'),
  });
  const cleaner = agg.find((a) => a.role === 'cleaner');
  assert.ok(cleaner?.buckets[0]?.outliersMs.includes(900_000));
});

test('gatherRoleHandoffLatencyRecords reads master-resident mailbox layout', () => {
  const root = mkTmpDir('bl602-');
  try {
    writeHandoff(path.join(root, '.swarmforge', 'handoffs', 'coder', 'inbox', 'completed'), '50_x.handoff', {
      to: 'coder',
      enqueued_at: '2026-08-27T10:00:00.000Z',
      dequeued_at: '2026-08-27T10:01:00.000Z',
    });
    const records = gatherRoleHandoffLatencyRecords({
      role: 'coder',
      worktreeName: 'master',
      worktreePath: root,
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].latencyMs, 60_000);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deriveHandoffLatencyRecords ignores headers without enqueued_at', () => {
  const records = deriveHandoffLatencyRecords([{ to: 'coder', dequeued_at: '2026-08-27T10:00:00.000Z' }]);
  assert.equal(records.length, 0);
});
