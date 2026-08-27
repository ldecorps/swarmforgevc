const assert = require('node:assert/strict');
const { computeMergedSince, computeBlockedTickets, DEFAULT_BLOCKED_THRESHOLD_MS } = require('../out/metrics/briefingDigest');

// BL-256 what-merged-whats-blocked-01: pure over already-derived
// TicketLifecycleEvent / TicketHoldingWindow data (gitHistoryAdapter.ts /
// ticketHoldingWindows.ts), per the ticket's own REUSE constraint - never
// re-derives lifecycle/holding-window logic itself.

function lifecycle(ticketId, specDateIso, closeDateIso) {
  return { ticketId, specDateIso, closeDateIso };
}

// ── computeMergedSince ────────────────────────────────────────────────────

test('lists tickets closed at/after the since cutoff, sorted oldest-closed first', () => {
  const lifecycles = new Map([
    ['BL-1', lifecycle('BL-1', '2026-07-01T00:00:00Z', '2026-07-10T12:00:00Z')],
    ['BL-2', lifecycle('BL-2', '2026-07-01T00:00:00Z', '2026-07-09T08:00:00Z')],
    ['BL-3', lifecycle('BL-3', '2026-07-01T00:00:00Z', '2026-07-05T00:00:00Z')],
  ]);
  const sinceMs = Date.parse('2026-07-09T00:00:00Z');

  const merged = computeMergedSince(lifecycles, sinceMs);

  assert.deepEqual(
    merged.map((m) => m.ticketId),
    ['BL-2', 'BL-1']
  );
});

test('excludes tickets that never closed (closeDateIso null)', () => {
  const lifecycles = new Map([['BL-1', lifecycle('BL-1', '2026-07-01T00:00:00Z', null)]]);

  const merged = computeMergedSince(lifecycles, Date.parse('2026-07-01T00:00:00Z'));

  assert.deepEqual(merged, []);
});

test('an empty lifecycle map yields an empty merged list, not a crash', () => {
  assert.deepEqual(computeMergedSince(new Map(), Date.now()), []);
});

// ── computeBlockedTickets ──────────────────────────────────────────────────

test('lists only currently-open windows past the threshold, longest-open first', () => {
  const nowMs = Date.parse('2026-07-10T12:00:00Z');
  const windowsByRole = {
    coder: [
      { ticketId: 'BL-1', startMs: nowMs - 20 * 60 * 60 * 1000, endMs: null }, // 20h open
      { ticketId: 'BL-2', startMs: nowMs - 1 * 60 * 60 * 1000, endMs: null }, // 1h open, under threshold
    ],
    architect: [
      { ticketId: 'BL-3', startMs: nowMs - 14 * 60 * 60 * 1000, endMs: null }, // 14h open
      { ticketId: 'BL-4', startMs: nowMs - 30 * 60 * 60 * 1000, endMs: nowMs - 25 * 60 * 60 * 1000 }, // closed, excluded
    ],
  };

  const blocked = computeBlockedTickets(windowsByRole, nowMs);

  assert.deepEqual(
    blocked.map((b) => b.ticketId),
    ['BL-1', 'BL-3']
  );
  assert.equal(blocked[0].role, 'coder');
  assert.equal(blocked[1].role, 'architect');
});

test('a custom threshold changes which windows qualify', () => {
  const nowMs = Date.parse('2026-07-10T12:00:00Z');
  const windowsByRole = { coder: [{ ticketId: 'BL-1', startMs: nowMs - 2 * 60 * 60 * 1000, endMs: null }] };

  assert.deepEqual(computeBlockedTickets(windowsByRole, nowMs, 3 * 60 * 60 * 1000), []);
  assert.deepEqual(
    computeBlockedTickets(windowsByRole, nowMs, 1 * 60 * 60 * 1000).map((b) => b.ticketId),
    ['BL-1']
  );
});

test('no roles / no windows yields an empty blocked list, not a crash', () => {
  assert.deepEqual(computeBlockedTickets({}, Date.now()), []);
});

test('DEFAULT_BLOCKED_THRESHOLD_MS is 12 hours', () => {
  assert.equal(DEFAULT_BLOCKED_THRESHOLD_MS, 12 * 60 * 60 * 1000);
});
