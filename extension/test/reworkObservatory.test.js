const assert = require('node:assert/strict');
const { computeReworkSignal } = require('../out/metrics/reworkObservatory');

function record(overrides = {}) {
  return {
    ticketId: 'BL-1',
    completedAtMs: Date.parse('2026-07-10T00:00:00Z'),
    bounced: false,
    bouncedFromRole: null,
    ticketClass: null,
    ...overrides,
  };
}

const WINDOW_START = Date.parse('2026-07-08T00:00:00Z');
const WINDOW_END = Date.parse('2026-07-15T00:00:00Z');
const BASELINE_START = Date.parse('2026-07-01T00:00:00Z');

// ── rework-observatory-01: rate over the window ─────────────────────────────

test('the observatory reports the share of tickets bounced at least once over the window', () => {
  const records = [
    record({ ticketId: 'BL-1', bounced: true, completedAtMs: Date.parse('2026-07-09T00:00:00Z') }),
    record({ ticketId: 'BL-2', bounced: false, completedAtMs: Date.parse('2026-07-10T00:00:00Z') }),
    record({ ticketId: 'BL-3', bounced: false, completedAtMs: Date.parse('2026-07-11T00:00:00Z') }),
    record({ ticketId: 'BL-4', bounced: false, completedAtMs: Date.parse('2026-07-12T00:00:00Z') }),
  ];
  const signal = computeReworkSignal(records, WINDOW_START, WINDOW_END, BASELINE_START);
  assert.equal(signal.hasSample, true);
  assert.equal(signal.reworkRate, 0.25);
  assert.equal(signal.sampleCount, 4);
});

test('a ticket completed outside the window does not count toward the rate', () => {
  const records = [
    record({ ticketId: 'BL-1', bounced: true, completedAtMs: Date.parse('2026-07-09T00:00:00Z') }),
    record({ ticketId: 'BL-2', bounced: true, completedAtMs: Date.parse('2026-06-01T00:00:00Z') }), // before the window
  ];
  const signal = computeReworkSignal(records, WINDOW_START, WINDOW_END, BASELINE_START);
  assert.equal(signal.sampleCount, 1);
  assert.equal(signal.reworkRate, 1);
});

// ── rework-observatory-02: attribution (role / ticket-class) ───────────────

test('rework is attributed to the role it concentrates in', () => {
  const records = [
    record({ ticketId: 'BL-1', bounced: true, bouncedFromRole: 'architect', completedAtMs: Date.parse('2026-07-09T00:00:00Z') }),
    record({ ticketId: 'BL-2', bounced: true, bouncedFromRole: 'architect', completedAtMs: Date.parse('2026-07-10T00:00:00Z') }),
    record({ ticketId: 'BL-3', bounced: true, bouncedFromRole: 'QA', completedAtMs: Date.parse('2026-07-11T00:00:00Z') }),
    record({ ticketId: 'BL-4', bounced: false, completedAtMs: Date.parse('2026-07-12T00:00:00Z') }),
  ];
  const signal = computeReworkSignal(records, WINDOW_START, WINDOW_END, BASELINE_START);
  assert.equal(signal.topRole, 'architect');
});

test('rework is attributed to the ticket-class it concentrates in', () => {
  const records = [
    record({ ticketId: 'BL-1', bounced: true, ticketClass: 'high', completedAtMs: Date.parse('2026-07-09T00:00:00Z') }),
    record({ ticketId: 'BL-2', bounced: true, ticketClass: 'high', completedAtMs: Date.parse('2026-07-10T00:00:00Z') }),
    record({ ticketId: 'BL-3', bounced: true, ticketClass: 'low', completedAtMs: Date.parse('2026-07-11T00:00:00Z') }),
  ];
  const signal = computeReworkSignal(records, WINDOW_START, WINDOW_END, BASELINE_START);
  assert.equal(signal.topTicketClass, 'high');
});

test('a non-bounced ticket never contributes to the role/ticket-class attribution', () => {
  const records = [
    record({ ticketId: 'BL-1', bounced: false, bouncedFromRole: 'hardener', ticketClass: 'high', completedAtMs: Date.parse('2026-07-09T00:00:00Z') }),
  ];
  const signal = computeReworkSignal(records, WINDOW_START, WINDOW_END, BASELINE_START);
  assert.equal(signal.topRole, null);
  assert.equal(signal.topTicketClass, null);
});

// ── rework-observatory-03: trailing baseline ────────────────────────────────

test('a trailing baseline rate is reported alongside the current rate, computed over the preceding window', () => {
  const records = [
    // baseline period: 2 of 4 bounced -> 0.5
    record({ ticketId: 'BL-b1', bounced: true, completedAtMs: Date.parse('2026-07-02T00:00:00Z') }),
    record({ ticketId: 'BL-b2', bounced: true, completedAtMs: Date.parse('2026-07-03T00:00:00Z') }),
    record({ ticketId: 'BL-b3', bounced: false, completedAtMs: Date.parse('2026-07-04T00:00:00Z') }),
    record({ ticketId: 'BL-b4', bounced: false, completedAtMs: Date.parse('2026-07-05T00:00:00Z') }),
    // current window: 1 of 4 bounced -> 0.25
    record({ ticketId: 'BL-1', bounced: true, completedAtMs: Date.parse('2026-07-09T00:00:00Z') }),
    record({ ticketId: 'BL-2', bounced: false, completedAtMs: Date.parse('2026-07-10T00:00:00Z') }),
    record({ ticketId: 'BL-3', bounced: false, completedAtMs: Date.parse('2026-07-11T00:00:00Z') }),
    record({ ticketId: 'BL-4', bounced: false, completedAtMs: Date.parse('2026-07-12T00:00:00Z') }),
  ];
  const signal = computeReworkSignal(records, WINDOW_START, WINDOW_END, BASELINE_START);
  assert.equal(signal.reworkRate, 0.25);
  assert.equal(signal.baselineRate, 0.5);
});

test('a baseline period with no completed tickets reports a null baseline, not zero', () => {
  const records = [record({ ticketId: 'BL-1', bounced: true, completedAtMs: Date.parse('2026-07-09T00:00:00Z') })];
  const signal = computeReworkSignal(records, WINDOW_START, WINDOW_END, BASELINE_START);
  assert.equal(signal.baselineRate, null);
});

// ── rework-observatory-04: zero-sample safety ───────────────────────────────

test('an empty window reports no sample instead of dividing by zero', () => {
  const signal = computeReworkSignal([], WINDOW_START, WINDOW_END, BASELINE_START);
  assert.equal(signal.hasSample, false);
});

test('an empty window never reports a rework rate of zero or one hundred percent', () => {
  const signal = computeReworkSignal([], WINDOW_START, WINDOW_END, BASELINE_START);
  assert.notEqual(signal.reworkRate, 0);
  assert.notEqual(signal.reworkRate, 1);
  assert.equal(signal.reworkRate, null);
});

test('a window with completed tickets but none of them bounced reports a real rate of exactly zero (distinct from no-sample null)', () => {
  const records = [
    record({ ticketId: 'BL-1', bounced: false, completedAtMs: Date.parse('2026-07-09T00:00:00Z') }),
    record({ ticketId: 'BL-2', bounced: false, completedAtMs: Date.parse('2026-07-10T00:00:00Z') }),
  ];
  const signal = computeReworkSignal(records, WINDOW_START, WINDOW_END, BASELINE_START);
  assert.equal(signal.hasSample, true);
  assert.equal(signal.reworkRate, 0);
});

test('a window where every ticket bounced reports a real rate of exactly one', () => {
  const records = [record({ ticketId: 'BL-1', bounced: true, completedAtMs: Date.parse('2026-07-09T00:00:00Z') })];
  const signal = computeReworkSignal(records, WINDOW_START, WINDOW_END, BASELINE_START);
  assert.equal(signal.reworkRate, 1);
});
