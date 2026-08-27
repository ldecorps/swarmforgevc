const assert = require('node:assert/strict');
const {
  parseParkCycleLog,
  pairParkCycles,
  deriveBreakEvenMs,
  computeRoutingBreakEvenReport,
} = require('../out/metrics/parkCycleReport');

function usageRecord(overrides = {}) {
  return {
    messageId: 'm1',
    timestampMs: Date.parse('2026-07-13T08:00:00Z'),
    model: 'claude-sonnet-5',
    usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5 },
    ...overrides,
  };
}

// ── parseParkCycleLog — routing-break-even-01/02 setup ──────────────────

test('BL-343 parseParkCycleLog: parses one real event per line', () => {
  const content = '{"event":"park","role":"cleaner","atMs":1000}\n{"event":"unpark","role":"cleaner","atMs":2000}\n';
  const events = parseParkCycleLog(content);
  assert.deepEqual(events, [
    { event: 'park', role: 'cleaner', atMs: 1000 },
    { event: 'unpark', role: 'cleaner', atMs: 2000 },
  ]);
});

test('parseParkCycleLog: skips blank lines and malformed JSON, never throws', () => {
  const content = '\n{"event":"park","role":"cleaner","atMs":1000}\nnot json\n{"event":"bogus"}\n';
  const events = parseParkCycleLog(content);
  assert.deepEqual(events, [{ event: 'park', role: 'cleaner', atMs: 1000 }]);
});

test('parseParkCycleLog: an empty log is zero events, not an error', () => {
  assert.deepEqual(parseParkCycleLog(''), []);
});

// ── pairParkCycles — routing-break-even-07: only REAL complete cycles ───

test('BL-343 pairParkCycles: a real park followed by a real unpark pairs into one complete cycle', () => {
  const cycles = pairParkCycles([
    { event: 'park', role: 'cleaner', atMs: 1000 },
    { event: 'unpark', role: 'cleaner', atMs: 5000 },
  ]);
  assert.deepEqual(cycles, [{ role: 'cleaner', parkedAtMs: 1000, unparkedAtMs: 5000 }]);
});

test('routing-break-even-07: a still-parked role (no unpark yet) is never fabricated into a cycle', () => {
  const cycles = pairParkCycles([{ event: 'park', role: 'cleaner', atMs: 1000 }]);
  assert.deepEqual(cycles, []);
});

test('routing-break-even-07: a leading unpark with no preceding park is never fabricated into a cycle', () => {
  const cycles = pairParkCycles([{ event: 'unpark', role: 'cleaner', atMs: 1000 }]);
  assert.deepEqual(cycles, []);
});

test('pairParkCycles: two full cycles for the same role both pair correctly, in order', () => {
  const cycles = pairParkCycles([
    { event: 'park', role: 'cleaner', atMs: 1000 },
    { event: 'unpark', role: 'cleaner', atMs: 2000 },
    { event: 'park', role: 'cleaner', atMs: 3000 },
    { event: 'unpark', role: 'cleaner', atMs: 9000 },
  ]);
  assert.deepEqual(cycles, [
    { role: 'cleaner', parkedAtMs: 1000, unparkedAtMs: 2000 },
    { role: 'cleaner', parkedAtMs: 3000, unparkedAtMs: 9000 },
  ]);
});

test('pairParkCycles: events out of chronological order in the input are still sorted by real atMs before pairing', () => {
  const cycles = pairParkCycles([
    { event: 'unpark', role: 'cleaner', atMs: 9000 },
    { event: 'park', role: 'cleaner', atMs: 3000 },
    { event: 'unpark', role: 'cleaner', atMs: 2000 },
    { event: 'park', role: 'cleaner', atMs: 1000 },
  ]);
  assert.deepEqual(cycles, [
    { role: 'cleaner', parkedAtMs: 1000, unparkedAtMs: 2000 },
    { role: 'cleaner', parkedAtMs: 3000, unparkedAtMs: 9000 },
  ]);
});

test('pairParkCycles: different roles never cross-pair with each other\'s events', () => {
  const cycles = pairParkCycles([
    { event: 'park', role: 'cleaner', atMs: 1000 },
    { event: 'park', role: 'architect', atMs: 1500 },
    { event: 'unpark', role: 'architect', atMs: 2000 },
    { event: 'unpark', role: 'cleaner', atMs: 3000 },
  ]);
  assert.deepEqual(
    cycles.sort((a, b) => a.role.localeCompare(b.role)),
    [
      { role: 'architect', parkedAtMs: 1500, unparkedAtMs: 2000 },
      { role: 'cleaner', parkedAtMs: 1000, unparkedAtMs: 3000 },
    ]
  );
});

// ── deriveBreakEvenMs — routing-break-even-03 ────────────────────────────

test('BL-343 routing-break-even-03: break-even is where the fixed cold-start cost equals the idle rate applied over D', () => {
  // warmIdleBaselineTokens=1000 over a 1-hour parkedDuration -> 1000 tok/hr.
  // coldStartTokens=250 -> break-even = 250 tok / 1000 tok-per-hr = 0.25 hr.
  const report = { coldStartTokens: 250, warmIdleBaselineTokens: 1000, deltaTokens: 750, isLoss: false };
  const breakEvenMs = deriveBreakEvenMs(report, 60 * 60 * 1000);
  assert.equal(breakEvenMs, 0.25 * 60 * 60 * 1000);
});

test('deriveBreakEvenMs: zero idle burn (nothing to save) means parking never pays - null, not a fabricated number', () => {
  const report = { coldStartTokens: 250, warmIdleBaselineTokens: 0, deltaTokens: -250, isLoss: true };
  assert.equal(deriveBreakEvenMs(report, 60 * 60 * 1000), null);
});

test('deriveBreakEvenMs: a zero parked duration is never divided into, honestly null rather than a fabricated 0', () => {
  const report = { coldStartTokens: 250, warmIdleBaselineTokens: 1000, deltaTokens: 750, isLoss: false };
  assert.equal(deriveBreakEvenMs(report, 0), null);
});

// ── computeRoutingBreakEvenReport — the full aggregate, real-cycles-only ─

test('BL-343 routing-break-even-06: zero real cycles reports routingSavesMoney as null (unmeasured), never false', () => {
  const report = computeRoutingBreakEvenReport([], () => [], () => '/some/path', 15 * 60 * 1000);
  assert.deepEqual(report.measuredCycles, []);
  assert.equal(report.routingSavesMoney, null);
  assert.equal(report.totalDeltaTokens, 0);
});

test('routing-break-even-01: the cold-start cost of a real cycle is measured from real transcript records, not estimated', () => {
  const parkedAtMs = Date.parse('2026-07-13T08:00:00Z');
  const unparkedAtMs = Date.parse('2026-07-13T09:00:00Z'); // parked 1 hour
  const records = [
    // prior idle burn: 100 tokens in the 15-minute window before park.
    usageRecord({ messageId: 'idle1', timestampMs: parkedAtMs - 5 * 60 * 1000, usage: { inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
    // cold-start: 5000 tokens right after unpark (the real re-read cost).
    usageRecord({ messageId: 'cold1', timestampMs: unparkedAtMs + 1000, usage: { inputTokens: 5000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ];
  const events = [
    { event: 'park', role: 'cleaner', atMs: parkedAtMs },
    { event: 'unpark', role: 'cleaner', atMs: unparkedAtMs },
  ];
  const report = computeRoutingBreakEvenReport(
    events,
    () => records,
    () => '/worktrees/cleaner',
    15 * 60 * 1000
  );
  assert.equal(report.measuredCycles.length, 1);
  assert.equal(report.measuredCycles[0].coldStartTokens, 5000);
  assert.equal(report.measuredCycles[0].role, 'cleaner');
  // 100 tokens in a 15-min prior window -> 400 tok/hr idle baseline, over
  // 1 hour parked -> warmIdleBaselineTokens=400. Cold-start 5000 >> 400, a
  // real observed LOSS - this specific short cycle cost more than it saved.
  assert.equal(report.measuredCycles[0].isLoss, true);
  assert.equal(report.routingSavesMoney, false);
  // breakEvenMs is derived from the real (unparkedAtMs - parkedAtMs) duration
  // at this call site, not a fabricated span: 5000 coldStartTokens * 3600000ms
  // / 400 warmIdleBaselineTokens = 45000000.
  assert.equal(report.measuredCycles[0].breakEvenMs, 45000000);
});

test('routing-break-even-04: a role idle for less than the break-even is identified as a loss from real data', () => {
  const parkedAtMs = Date.parse('2026-07-13T08:00:00Z');
  const unparkedAtMs = parkedAtMs + 60 * 1000; // parked only 1 minute - far too short
  const records = [
    usageRecord({ messageId: 'idle1', timestampMs: parkedAtMs - 5 * 60 * 1000, usage: { inputTokens: 1000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
    usageRecord({ messageId: 'cold1', timestampMs: unparkedAtMs + 1000, usage: { inputTokens: 3000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ];
  const events = [
    { event: 'park', role: 'cleaner', atMs: parkedAtMs },
    { event: 'unpark', role: 'cleaner', atMs: unparkedAtMs },
  ];
  const report = computeRoutingBreakEvenReport(events, () => records, () => '/worktrees/cleaner', 15 * 60 * 1000);
  assert.equal(report.measuredCycles[0].isLoss, true);
});

test('routing-break-even-05: the role-to-warm-core decision (breakEvenMs per role) comes from the measurement, keyed by role', () => {
  const parkedAtMs = Date.parse('2026-07-13T08:00:00Z');
  const unparkedAtMs = parkedAtMs + 60 * 60 * 1000;
  const records = [
    usageRecord({ messageId: 'idle1', timestampMs: parkedAtMs - 5 * 60 * 1000, usage: { inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
    usageRecord({ messageId: 'cold1', timestampMs: unparkedAtMs + 1000, usage: { inputTokens: 50, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ];
  const events = [
    { event: 'park', role: 'cleaner', atMs: parkedAtMs },
    { event: 'unpark', role: 'cleaner', atMs: unparkedAtMs },
  ];
  const report = computeRoutingBreakEvenReport(events, () => records, () => '/worktrees/cleaner', 15 * 60 * 1000);
  assert.ok('cleaner' in report.roleBreakEvenMs);
  assert.ok(typeof report.roleBreakEvenMs.cleaner === 'number');
  // no data at all for a role never parked - absent, never a guessed 0.
  assert.equal('architect' in report.roleBreakEvenMs, false);
});

test('routing-break-even-07: a role with no resolvable worktree path is skipped, never measured from a guess', () => {
  const events = [
    { event: 'park', role: 'ghost-role', atMs: 1000 },
    { event: 'unpark', role: 'ghost-role', atMs: 5000 },
  ];
  const report = computeRoutingBreakEvenReport(events, () => [], () => null, 15 * 60 * 1000);
  assert.deepEqual(report.measuredCycles, []);
  assert.equal(report.routingSavesMoney, null);
});

test('routing-break-even-06: a real observed net SAVING reports routingSavesMoney true, with the real summed delta', () => {
  const parkedAtMs = Date.parse('2026-07-13T08:00:00Z');
  const unparkedAtMs = parkedAtMs + 60 * 60 * 1000; // parked 1 hour
  const records = [
    // prior idle burn: 5000 tokens in the 15-minute window before park -> 20000 tok/hr baseline.
    usageRecord({ messageId: 'idle1', timestampMs: parkedAtMs - 5 * 60 * 1000, usage: { inputTokens: 5000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
    // cold-start: only 300 tokens right after unpark - far cheaper than the idle baseline saved.
    usageRecord({ messageId: 'cold1', timestampMs: unparkedAtMs + 1000, usage: { inputTokens: 300, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ];
  const events = [
    { event: 'park', role: 'cleaner', atMs: parkedAtMs },
    { event: 'unpark', role: 'cleaner', atMs: unparkedAtMs },
  ];
  const report = computeRoutingBreakEvenReport(events, () => records, () => '/worktrees/cleaner', 15 * 60 * 1000);
  assert.equal(report.measuredCycles[0].isLoss, false);
  assert.equal(report.totalDeltaTokens, report.measuredCycles[0].deltaTokens);
  assert.equal(report.routingSavesMoney, true);
});

test('routing-break-even-06: a real cycle with exactly zero net delta reports routingSavesMoney false, not true', () => {
  const parkedAtMs = Date.parse('2026-07-13T08:00:00Z');
  const unparkedAtMs = parkedAtMs + 60 * 60 * 1000; // parked 1 hour
  const records = [
    // prior idle burn: 100 tokens in the 15-minute window before park -> 400 tok/hr baseline over 1hr = 400 tokens.
    usageRecord({ messageId: 'idle1', timestampMs: parkedAtMs - 5 * 60 * 1000, usage: { inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
    // cold-start: exactly 400 tokens - a real observed break-even wash, not a saving.
    usageRecord({ messageId: 'cold1', timestampMs: unparkedAtMs + 1000, usage: { inputTokens: 400, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ];
  const events = [
    { event: 'park', role: 'cleaner', atMs: parkedAtMs },
    { event: 'unpark', role: 'cleaner', atMs: unparkedAtMs },
  ];
  const report = computeRoutingBreakEvenReport(events, () => records, () => '/worktrees/cleaner', 15 * 60 * 1000);
  assert.equal(report.totalDeltaTokens, 0);
  assert.equal(report.routingSavesMoney, false);
});
