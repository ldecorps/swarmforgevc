const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deriveHoldingWindows, readRoleHoldingWindows } = require('../out/metrics/ticketHoldingWindows');

// BL-100 cost-02: per-ticket attribution needs a role's actual holding
// windows (not just an aggregate busy fraction). deriveHoldingWindows is
// pure over already-read handoff header records; readRoleHoldingWindows is
// the thin fs adapter.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-holding-windows-'));
}

test('deriveHoldingWindows extracts a completed ticket\'s start/end from dequeued_at/completed_at', () => {
  const windows = deriveHoldingWindows([
    { task: 'BL-100-cost-telemetry', dequeued_at: '2026-07-09T08:00:00Z', completed_at: '2026-07-09T10:00:00Z' },
  ]);
  assert.deepEqual(windows, [
    { ticketId: 'BL-100', startMs: Date.parse('2026-07-09T08:00:00Z'), endMs: Date.parse('2026-07-09T10:00:00Z') },
  ]);
});

test('deriveHoldingWindows reports endMs null for a still-open (in_process) window', () => {
  const windows = deriveHoldingWindows([{ task: 'BL-100-cost-telemetry', dequeued_at: '2026-07-09T08:00:00Z' }]);
  assert.equal(windows[0].endMs, null);
});

test('deriveHoldingWindows skips a record with no task header', () => {
  const windows = deriveHoldingWindows([{ dequeued_at: '2026-07-09T08:00:00Z' }]);
  assert.deepEqual(windows, []);
});

test('deriveHoldingWindows skips a record with no dequeued_at (never actually started)', () => {
  const windows = deriveHoldingWindows([{ task: 'BL-100-cost-telemetry' }]);
  assert.deepEqual(windows, []);
});

test('deriveHoldingWindows extracts multiple distinct windows independently', () => {
  const windows = deriveHoldingWindows([
    { task: 'BL-100-cost-telemetry', dequeued_at: '2026-07-09T08:00:00Z', completed_at: '2026-07-09T09:00:00Z' },
    { task: 'BL-101-other-ticket', dequeued_at: '2026-07-09T09:00:00Z', completed_at: '2026-07-09T10:00:00Z' },
  ]);
  assert.equal(windows.length, 2);
  assert.deepEqual(windows.map((w) => w.ticketId), ['BL-100', 'BL-101']);
});

// ── readRoleHoldingWindows (thin fs adapter) ────────────────────────────

function writeHandoff(dir, filename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, filename), lines.join('\n') + '\n\nbody\n');
}

test('readRoleHoldingWindows reads completed handoffs from inbox/completed', () => {
  const worktree = mkTmp();
  const completedDir = path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'completed');
  writeHandoff(completedDir, '00_test.handoff', {
    task: 'BL-100-cost-telemetry',
    dequeued_at: '2026-07-09T08:00:00Z',
    completed_at: '2026-07-09T10:00:00Z',
  });

  const windows = readRoleHoldingWindows(worktree);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].ticketId, 'BL-100');
  assert.equal(windows[0].endMs, Date.parse('2026-07-09T10:00:00Z'));
});

test('readRoleHoldingWindows reads the currently open in_process handoff as a null-ended window', () => {
  const worktree = mkTmp();
  const inProcessDir = path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  writeHandoff(inProcessDir, '00_test.handoff', {
    task: 'BL-101-still-open',
    dequeued_at: '2026-07-09T08:00:00Z',
  });

  const windows = readRoleHoldingWindows(worktree);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].ticketId, 'BL-101');
  assert.equal(windows[0].endMs, null);
});

test('readRoleHoldingWindows reads in_process handoffs nested inside a batch subdirectory', () => {
  const worktree = mkTmp();
  const batchDir = path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process', 'batch-1');
  writeHandoff(batchDir, '00_test.handoff', {
    task: 'BL-102-batched',
    dequeued_at: '2026-07-09T08:00:00Z',
  });

  const windows = readRoleHoldingWindows(worktree);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].ticketId, 'BL-102');
});

test('readRoleHoldingWindows returns an empty array for a role with no handoff directories at all (cost-07)', () => {
  const worktree = mkTmp();
  assert.doesNotThrow(() => readRoleHoldingWindows(worktree));
  assert.deepEqual(readRoleHoldingWindows(worktree), []);
});

test('readRoleHoldingWindows combines completed and in_process windows', () => {
  const worktree = mkTmp();
  writeHandoff(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'completed'), '00_a.handoff', {
    task: 'BL-100-done',
    dequeued_at: '2026-07-09T08:00:00Z',
    completed_at: '2026-07-09T09:00:00Z',
  });
  writeHandoff(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process'), '00_b.handoff', {
    task: 'BL-101-open',
    dequeued_at: '2026-07-09T09:00:00Z',
  });

  const windows = readRoleHoldingWindows(worktree);
  assert.equal(windows.length, 2);
  assert.deepEqual(windows.map((w) => w.ticketId).sort(), ['BL-100', 'BL-101']);
});
