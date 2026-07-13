const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  computeBurnRateTokensPerHour,
  computeBurnRateForRoles,
  sumTokensInSpan,
  measureParkCycleCost,
  DEFAULT_BURN_RATE_WINDOW_MS,
} = require('../out/metrics/burnRate');

function usageRecord(overrides = {}) {
  return {
    messageId: 'm1',
    timestampMs: Date.parse('2026-07-09T08:00:00Z'),
    model: 'claude-sonnet-5',
    usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5 },
    ...overrides,
  };
}

const NOW_MS = Date.parse('2026-07-09T08:15:00Z');
const WINDOW_MS = 15 * 60 * 1000;

// ── computeBurnRateTokensPerHour (pure) — burn-rate-01 ──────────────────

test('BL-273 burn-rate-01: a role\'s rate is total in-window tokens (input+output+cache) extrapolated to /hr', () => {
  const records = [
    usageRecord({
      messageId: 'a',
      timestampMs: NOW_MS - 5 * 60 * 1000,
      usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5 },
    }),
  ];
  // total in-window tokens = 165, over a 15-minute window -> x4 to reach /hr
  const rate = computeBurnRateTokensPerHour(records, NOW_MS, WINDOW_MS);
  assert.equal(rate, 165 * 4);
});

test('sums MULTIPLE in-window records before extrapolating, not just the latest one', () => {
  const records = [
    usageRecord({ messageId: 'a', timestampMs: NOW_MS - 10 * 60 * 1000, usage: { inputTokens: 40, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
    usageRecord({ messageId: 'b', timestampMs: NOW_MS - 2 * 60 * 1000, usage: { inputTokens: 20, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ];
  assert.equal(computeBurnRateTokensPerHour(records, NOW_MS, WINDOW_MS), 60 * 4);
});

test('a record just OUTSIDE the trailing window is excluded from the rate', () => {
  const records = [
    usageRecord({ messageId: 'old', timestampMs: NOW_MS - WINDOW_MS - 1, usage: { inputTokens: 1000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ];
  assert.equal(computeBurnRateTokensPerHour(records, NOW_MS, WINDOW_MS), 0);
});

test('a record at exactly the window boundary is included (inclusive lower bound)', () => {
  const records = [
    usageRecord({ messageId: 'boundary', timestampMs: NOW_MS - WINDOW_MS, usage: { inputTokens: 15, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ];
  assert.equal(computeBurnRateTokensPerHour(records, NOW_MS, WINDOW_MS), 15 * 4);
});

// ── computeBurnRateTokensPerHour (pure) — burn-rate-02 ──────────────────

test('BL-273 burn-rate-02: an idle role (no in-window records) reports a real 0, not null/NaN', () => {
  const rate = computeBurnRateTokensPerHour([], NOW_MS, WINDOW_MS);
  assert.equal(rate, 0);
  assert.notEqual(rate, null);
});

test('records entirely before the window (an idle role with a stale history) also report 0', () => {
  const records = [usageRecord({ timestampMs: NOW_MS - 24 * 60 * 60 * 1000 })];
  assert.equal(computeBurnRateTokensPerHour(records, NOW_MS, WINDOW_MS), 0);
});

test('the default window is 15 minutes', () => {
  assert.equal(DEFAULT_BURN_RATE_WINDOW_MS, 15 * 60 * 1000);
});

// ── computeBurnRateForRoles (impure orchestrator) ───────────────────────

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-burn-rate-'));
}

function writeTranscript(projectsDir, worktreePath, records) {
  const slug = worktreePath.replace(/[/.]/g, '-');
  const dir = path.join(projectsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  const lines = records.map((r) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date(r.timestampMs).toISOString(),
      message: { id: r.messageId, model: r.model, usage: usageJson(r.usage) },
    })
  );
  fs.writeFileSync(path.join(dir, 'session.jsonl'), lines.join('\n') + '\n');
}

function usageJson(usage) {
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_creation_input_tokens: usage.cacheCreationTokens,
    cache_read_input_tokens: usage.cacheReadTokens,
  };
}

test('computeBurnRateForRoles reads each role\'s transcripts via the SAME reader BL-100 uses and reports a per-role rate map', () => {
  const projectsDir = mkTmp();
  const coderWt = path.join(mkTmp(), 'coder');
  fs.mkdirSync(coderWt, { recursive: true });
  writeTranscript(projectsDir, coderWt, [
    usageRecord({ messageId: 'x', timestampMs: NOW_MS - 5 * 60 * 1000, usage: { inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ]);

  const rates = computeBurnRateForRoles('/unused/target', [{ role: 'coder', worktreePath: coderWt }], NOW_MS, WINDOW_MS, projectsDir);
  assert.equal(rates.coder, 100 * 4);
});

test('a role with no transcript directory at all reports a rate of 0, not an error (cost-07 parity)', () => {
  const projectsDir = mkTmp();
  const rates = computeBurnRateForRoles('/unused/target', [{ role: 'coder', worktreePath: '/never/ran/here' }], NOW_MS, WINDOW_MS, projectsDir);
  assert.deepEqual(rates, { coder: 0 });
});

test('every configured role appears in the result, even when idle', () => {
  const projectsDir = mkTmp();
  const rates = computeBurnRateForRoles(
    '/unused/target',
    [
      { role: 'coder', worktreePath: '/never/ran/here' },
      { role: 'cleaner', worktreePath: '/never/ran/either' },
    ],
    NOW_MS,
    WINDOW_MS,
    projectsDir
  );
  assert.deepEqual(rates, { coder: 0, cleaner: 0 });
});

// ── BL-312: master-resident worktreePath collision ──────────────────────

test('BL-312 burn-meter-master-resident-01: coordinator and specifier sharing one worktreePath report ONE combined rate, not two independent full rates', () => {
  const projectsDir = mkTmp();
  const masterWt = path.join(mkTmp(), 'master');
  fs.mkdirSync(masterWt, { recursive: true });
  writeTranscript(projectsDir, masterWt, [
    usageRecord({ messageId: 'x', timestampMs: NOW_MS - 5 * 60 * 1000, usage: { inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ]);

  const rates = computeBurnRateForRoles(
    '/unused/target',
    [
      { role: 'coordinator', worktreePath: masterWt },
      { role: 'specifier', worktreePath: masterWt },
    ],
    NOW_MS,
    WINDOW_MS,
    projectsDir
  );
  assert.deepEqual(rates, { 'coordinator+specifier': 100 * 4 });
  assert.equal(rates.coordinator, undefined);
  assert.equal(rates.specifier, undefined);
});

// ── sumTokensInSpan (pure) — BL-324 ─────────────────────────────────────

test('BL-324: sumTokensInSpan is the raw total, not extrapolated to an hourly rate', () => {
  const records = [
    usageRecord({ messageId: 'a', timestampMs: NOW_MS, usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5 } }),
  ];
  assert.equal(sumTokensInSpan(records, NOW_MS - 1000, NOW_MS + 1000), 165);
});

test('BL-324: sumTokensInSpan sums multiple in-span records', () => {
  const records = [
    usageRecord({ messageId: 'a', timestampMs: NOW_MS, usage: { inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
    usageRecord({ messageId: 'b', timestampMs: NOW_MS + 500, usage: { inputTokens: 50, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ];
  assert.equal(sumTokensInSpan(records, NOW_MS - 1000, NOW_MS + 1000), 150);
});

test('BL-324: sumTokensInSpan excludes records outside [start, end]', () => {
  const records = [
    usageRecord({ messageId: 'before', timestampMs: NOW_MS - 2000, usage: { inputTokens: 999, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
    usageRecord({ messageId: 'after', timestampMs: NOW_MS + 2000, usage: { inputTokens: 999, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ];
  assert.equal(sumTokensInSpan(records, NOW_MS - 1000, NOW_MS + 1000), 0);
});

test('BL-324: sumTokensInSpan is 0 for an empty span with no records', () => {
  assert.equal(sumTokensInSpan([], NOW_MS, NOW_MS + 1000), 0);
});

// ── measureParkCycleCost (pure) — BL-324 per-role-lifecycle-06 ───────────

test('BL-324 per-role-lifecycle-06: a park cycle that saved tokens reports a positive delta, not a loss', () => {
  const parkedAtMs = NOW_MS;
  const unparkedAtMs = NOW_MS + 60 * 60 * 1000; // parked for 1 hour
  const records = [
    // Prior idle window (just before parking): 10 tokens/15min -> 40 tokens/hr baseline.
    usageRecord({ messageId: 'prior', timestampMs: parkedAtMs - 5 * 60 * 1000, usage: { inputTokens: 10, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
    // Cold-start cost right after unpark: only 20 tokens - cheaper than the
    // ~40-token/hr warm-idle baseline over the 1-hour parked span would have been.
    usageRecord({ messageId: 'cold', timestampMs: unparkedAtMs + 1000, usage: { inputTokens: 20, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ];
  const report = measureParkCycleCost(records, parkedAtMs, unparkedAtMs, 5 * 60 * 1000, 15 * 60 * 1000);
  assert.equal(report.coldStartTokens, 20);
  assert.equal(report.warmIdleBaselineTokens, 40);
  assert.equal(report.deltaTokens, 20);
  assert.equal(report.isLoss, false);
});

test('BL-324 per-role-lifecycle-06: a park cycle whose churn cost MORE than staying warm is reported as a loss, not hidden', () => {
  const parkedAtMs = NOW_MS;
  const unparkedAtMs = NOW_MS + 60 * 60 * 1000;
  const records = [
    // A near-silent prior idle window - almost nothing would have been spent staying warm.
    usageRecord({ messageId: 'prior', timestampMs: parkedAtMs - 5 * 60 * 1000, usage: { inputTokens: 1, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
    // A big, expensive cold-start re-read of the full system/constitution/role prompt.
    usageRecord({ messageId: 'cold', timestampMs: unparkedAtMs + 1000, usage: { inputTokens: 5000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ];
  const report = measureParkCycleCost(records, parkedAtMs, unparkedAtMs, 5 * 60 * 1000, 15 * 60 * 1000);
  assert.equal(report.coldStartTokens, 5000);
  assert.ok(report.deltaTokens < 0);
  assert.equal(report.isLoss, true);
});

test('BL-324: measureParkCycleCost never crashes on a zero-duration or negative-duration span', () => {
  const report = measureParkCycleCost([], NOW_MS, NOW_MS - 1000, 60000, 60000);
  assert.equal(report.warmIdleBaselineTokens, 0);
  assert.equal(report.coldStartTokens, 0);
  assert.equal(report.deltaTokens, 0);
  assert.equal(report.isLoss, false);
});

test('BL-324 burn-meter reuse: measureParkCycleCost never reads outside its own [parkedAt-priorIdleWindow, parkedAt) / [unparkedAt, unparkedAt+coldStartWindow] spans', () => {
  const parkedAtMs = NOW_MS;
  const unparkedAtMs = NOW_MS + 60 * 60 * 1000;
  const records = [
    // Mid-park activity (should never count toward either side of the delta).
    usageRecord({ messageId: 'mid-park', timestampMs: parkedAtMs + 30 * 60 * 1000, usage: { inputTokens: 99999, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ];
  const report = measureParkCycleCost(records, parkedAtMs, unparkedAtMs, 5 * 60 * 1000, 15 * 60 * 1000);
  assert.equal(report.coldStartTokens, 0);
  assert.equal(report.warmIdleBaselineTokens, 0);
});

test('BL-312 burn-meter-master-resident-03: a role on its own distinct worktreePath is unaffected by a collision elsewhere', () => {
  const projectsDir = mkTmp();
  const masterWt = path.join(mkTmp(), 'master');
  const coderWt = path.join(mkTmp(), 'coder');
  fs.mkdirSync(masterWt, { recursive: true });
  writeTranscript(projectsDir, coderWt, [
    usageRecord({ messageId: 'x', timestampMs: NOW_MS - 5 * 60 * 1000, usage: { inputTokens: 50, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } }),
  ]);

  const rates = computeBurnRateForRoles(
    '/unused/target',
    [
      { role: 'coordinator', worktreePath: masterWt },
      { role: 'specifier', worktreePath: masterWt },
      { role: 'coder', worktreePath: coderWt },
    ],
    NOW_MS,
    WINDOW_MS,
    projectsDir
  );
  assert.equal(rates.coder, 50 * 4);
});
