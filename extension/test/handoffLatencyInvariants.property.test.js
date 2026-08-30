'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  deriveHandoffLatency,
  aggregateHandoffLatencyByRole,
  gatherRoleHandoffLatencyRecords,
} = require('../out/metrics/handoffLatency');

const ROLES = ['coder', 'cleaner', 'architect', 'QA'];

function writeHandoff(dir, filename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, filename), `${lines.join('\n')}\n\nbody\n`);
}

const isoArb = fc
  .integer({ min: Date.parse('2026-08-01T00:00:00Z'), max: Date.parse('2026-08-28T00:00:00Z') })
  .map((ms) => new Date(ms).toISOString());

test('BL-602 P1: still-queued (no dequeued_at) is always open, never processed', () => {
  fc.assert(
    fc.property(fc.constantFrom(...ROLES), isoArb, fc.integer({ min: 0, max: 86_400_000 }), (role, enqueuedAt, waitMs) => {
      const enqueuedAtMs = Date.parse(enqueuedAt);
      const nowMs = enqueuedAtMs + waitMs;
      const record = deriveHandoffLatency({ to: role, enqueued_at: enqueuedAt }, nowMs);
      assert.ok(record);
      assert.equal(record.status, 'open');
      assert.equal(record.latencyMs, undefined);
      assert.equal(record.openWaitMs, waitMs);
      assert.equal(record.dequeuedAtMs, undefined);
    }),
    { numRuns: 40 }
  );
});

test('BL-602 P2: gather covers master and worktree mailbox layouts (new/in_process/completed)', () => {
  fc.assert(
    fc.property(fc.constantFrom('master', 'worktree'), fc.constantFrom(...ROLES), (layout, role) => {
      const root = mkTmpDir('bl602-p2-');
      try {
        const entry =
          layout === 'master'
            ? { role, worktreeName: 'master', worktreePath: root }
            : { role, worktreeName: role, worktreePath: root };
        const base =
          layout === 'master'
            ? path.join(root, '.swarmforge', 'handoffs', role, 'inbox')
            : path.join(root, '.swarmforge', 'handoffs', 'inbox');
        writeHandoff(path.join(base, 'new'), '10_open.handoff', {
          to: role,
          enqueued_at: '2026-08-27T10:00:00.000Z',
        });
        writeHandoff(path.join(base, 'in_process'), '20_ip.handoff', {
          to: role,
          enqueued_at: '2026-08-27T09:00:00.000Z',
          dequeued_at: '2026-08-27T09:05:00.000Z',
        });
        writeHandoff(path.join(base, 'completed'), '30_done.handoff', {
          to: role,
          enqueued_at: '2026-08-27T08:00:00.000Z',
          dequeued_at: '2026-08-27T08:01:00.000Z',
        });
        const records = gatherRoleHandoffLatencyRecords(entry, Date.parse('2026-08-27T12:00:00.000Z'));
        assert.equal(records.length, 3);
        assert.ok(records.some((r) => r.status === 'open'));
        assert.ok(records.filter((r) => r.status === 'processed').length >= 2);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 12 }
  );
});

test('BL-602 P3: aggregation is pure over in-memory records (no fs side effects)', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          recipient: fc.constantFrom(...ROLES),
          status: fc.constantFrom('processed', 'open'),
          latencyMs: fc.integer({ min: 0, max: 900_000 }),
          openWaitMs: fc.integer({ min: 0, max: 900_000 }),
          enqueuedAtMs: fc.integer({
            min: Date.parse('2026-08-27T09:00:00.000Z'),
            max: Date.parse('2026-08-27T12:00:00.000Z'),
          }),
        }),
        { minLength: 0, maxLength: 8 }
      ),
      (raw) => {
        const records = raw.map((r) => {
          if (r.status === 'processed') {
            return {
              recipient: r.recipient,
              status: 'processed',
              latencyMs: r.latencyMs,
              enqueuedAtMs: r.enqueuedAtMs,
              dequeuedAtMs: r.enqueuedAtMs + r.latencyMs,
            };
          }
          return {
            recipient: r.recipient,
            status: 'open',
            openWaitMs: r.openWaitMs,
            enqueuedAtMs: r.enqueuedAtMs,
          };
        });
        const window = {
          startMs: Date.parse('2026-08-27T09:00:00.000Z'),
          endMs: Date.parse('2026-08-27T13:00:00.000Z'),
        };
        const a = aggregateHandoffLatencyByRole(records, window);
        const b = aggregateHandoffLatencyByRole([...records], window);
        assert.deepEqual(a, b);
        for (const roleAgg of a) {
          for (const open of roleAgg.openWaits) {
            assert.equal(open.status, 'open');
          }
          const processedCount = roleAgg.buckets.reduce((s, bkt) => s + bkt.processedCount, 0);
          const openOnRole = records.filter((r) => r.recipient === roleAgg.role && r.status === 'open').length;
          assert.equal(roleAgg.openWaits.length, openOnRole);
          assert.equal(
            processedCount,
            records.filter((r) => r.recipient === roleAgg.role && r.status === 'processed').length
          );
        }
      }
    ),
    { numRuns: 40 }
  );
});

test('BL-602 P4: measuring module does not import dispatch/rotation/claim surfaces', () => {
  const srcPath = path.join(__dirname, '..', 'src', 'metrics', 'handoffLatency.ts');
  const src = fs.readFileSync(srcPath, 'utf8');
  assert.doesNotMatch(src, /ready_for_next|swarm_handoff|rotate-resident|rotate_to_role|handoffd/);
  assert.match(src, /Measurement only|Measuring|aggregateHandoffLatencyByRole|deriveHandoffLatency/);
});
