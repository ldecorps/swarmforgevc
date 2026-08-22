const assert = require('node:assert/strict');
const {
  parseWeekday,
  parseWeekResetConfig,
  nextWeeklyResetMs,
  currentWeeklyWindowStartMs,
  deriveBurnRateFromAnchors,
  computeProjectedExhaustionMs,
  decideProjection,
  composeBurnSection,
  MS_PER_DAY,
} = require('../out/metrics/burnProjection');

const MS_PER_HOUR = 60 * 60 * 1000;

// Fixed baseline so weekday arithmetic is deterministic regardless of which
// day the suite runs on - 2026-07-24 is a Friday.
function localMs(monthDay, hhmm) {
  const [hour, minute] = hhmm.split(':').map(Number);
  return new Date(2026, 6, monthDay, hour, minute, 0, 0).getTime();
}

// ── parseWeekday / parseWeekResetConfig ─────────────────────────────────

test('BL-619: parseWeekday accepts a case-insensitive weekday name or prefix', () => {
  assert.equal(parseWeekday('thu'), 4);
  assert.equal(parseWeekday('Thursday'), 4);
  assert.equal(parseWeekday('SUN'), 0);
  assert.equal(parseWeekday('sat'), 6);
});

test('BL-619: parseWeekday rejects anything unrecognized', () => {
  assert.equal(parseWeekday('funday'), null);
  assert.equal(parseWeekday(''), null);
  assert.equal(parseWeekday(undefined), null);
});

test('BL-619: absent reset config defaults to thu 07:00, never malformed', () => {
  assert.deepEqual(parseWeekResetConfig(''), {
    config: { resetDay: 4, resetLocal: { hour: 7, minute: 0 } },
    malformed: false,
  });
});

test('BL-619: explicit valid reset config parses both fields', () => {
  const parsed = parseWeekResetConfig('config usage_week_reset_day mon\nconfig usage_week_reset_local 09:30\n');
  assert.deepEqual(parsed, { config: { resetDay: 1, resetLocal: { hour: 9, minute: 30 } }, malformed: false });
});

// malformed-reset-config-08 (unit level)
test('BL-619 malformed-reset-config-08: an unrecognized day or time is malformed with a warning', () => {
  const byDay = parseWeekResetConfig('config usage_week_reset_day funday\n');
  assert.equal(byDay.malformed, true);
  assert.equal(byDay.config, null);
  assert.match(byDay.warning, /malformed usage week reset config/);

  const byTime = parseWeekResetConfig('config usage_week_reset_local 99:99\n');
  assert.equal(byTime.malformed, true);
  assert.equal(byTime.config, null);
});

// ── nextWeeklyResetMs / currentWeeklyWindowStartMs ──────────────────────

test('BL-619: nextWeeklyResetMs finds the next occurrence of the reset weekday/time', () => {
  // 2026-07-24 is a Friday; next Thursday 07:00 is 2026-07-30.
  const now = localMs(24, '10:00');
  const next = nextWeeklyResetMs(now, 4, { hour: 7, minute: 0 });
  assert.equal(next, localMs(30, '07:00'));
});

test('BL-619: nextWeeklyResetMs rolls to next week when today IS the reset day but the time already passed', () => {
  // 2026-07-30 is a Thursday; 08:00 is after the 07:00 reset time.
  const now = localMs(30, '08:00');
  const next = nextWeeklyResetMs(now, 4, { hour: 7, minute: 0 });
  assert.equal(next, localMs(30 + 7, '07:00')); // 2026-08-06, the following Thursday
});

test('BL-619: currentWeeklyWindowStartMs is exactly 7 days before the next reset', () => {
  const now = localMs(24, '10:00');
  const windowStart = currentWeeklyWindowStartMs(now, 4, { hour: 7, minute: 0 });
  assert.equal(windowStart, localMs(30, '07:00') - 7 * MS_PER_DAY);
  assert.ok(windowStart <= now);
});

// ── deriveBurnRateFromAnchors — two-anchor-rate-04 / single-anchor-window-average-05 ──

test('BL-619 two-anchor-rate-04: two anchors in-window use the latest pair', () => {
  const windowStart = localMs(1, '00:00');
  const anchors = [
    { atMs: localMs(20, '00:00'), pct: 10, scope: 'all' },
    { atMs: localMs(21, '00:00'), pct: 23, scope: 'all' },
  ];
  const derived = deriveBurnRateFromAnchors(anchors, windowStart);
  assert.equal(derived.ratePctPerDay, 13);
});

test('BL-619 two-anchor-rate-04: order-independent - the latest pair is picked regardless of input order', () => {
  const windowStart = localMs(1, '00:00');
  const anchors = [
    { atMs: localMs(21, '00:00'), pct: 23, scope: 'all' },
    { atMs: localMs(20, '00:00'), pct: 10, scope: 'all' },
  ];
  const derived = deriveBurnRateFromAnchors(anchors, windowStart);
  assert.equal(derived.ratePctPerDay, 13);
});

test('BL-619 single-anchor-window-average-05: a single anchor averages since the window start', () => {
  const now = localMs(3, '00:00');
  const windowStart = now - 48 * MS_PER_HOUR;
  const anchors = [{ atMs: windowStart + 24 * MS_PER_HOUR, pct: 40, scope: 'all' }];
  const derived = deriveBurnRateFromAnchors(anchors, windowStart);
  assert.equal(derived.ratePctPerDay, 40);
});

test('BL-619: no anchors derives no rate', () => {
  assert.equal(deriveBurnRateFromAnchors([], localMs(1, '00:00')), null);
});

// ── decideProjection — projection-decision-table-02 ─────────────────────

for (const [hoursToReset, anchorPct, pctPerDay, decision] of [
  [72, 23, 30, 'warn'],
  [72, 23, 20, 'ok'],
  [24, 90, 15, 'warn'],
  [24, 50, 20, 'ok'],
]) {
  test(`BL-619 projection-decision-table-02: ${hoursToReset}h to reset, ${anchorPct}% @ ${pctPerDay}%/day -> ${decision}`, () => {
    const nowMs = localMs(24, '10:00');
    const nextResetMs = nowMs + hoursToReset * MS_PER_HOUR;
    assert.equal(decideProjection(anchorPct, nowMs, pctPerDay, nextResetMs), decision);
  });
}

test('BL-619: a non-positive rate never projects exhaustion (always ok)', () => {
  const nowMs = localMs(24, '10:00');
  assert.equal(computeProjectedExhaustionMs(50, nowMs, 0), Infinity);
  assert.equal(decideProjection(99, nowMs, 0, nowMs + MS_PER_HOUR), 'ok');
});

// ── composeBurnSection — the full decision, one function ────────────────

function resetConfig(overrides = {}) {
  return { config: { resetDay: 4, resetLocal: { hour: 7, minute: 0 } }, malformed: false, ...overrides };
}

test('BL-619 warning-leads-briefing-01: an anchor projecting exhaustion before the reset composes to warn', () => {
  // Friday morning, a day into the window that opened Thursday 07:00 - a
  // single anchor this early carries a representative "average since window
  // start" rate (unlike an anchor recorded late in the window, whose average
  // gets diluted by the days before it existed - see the diluted-single-
  // anchor-late-in-window test below for that contrast).
  const nowMs = localMs(24, '09:00');
  const anchorAtMs = nowMs - 2 * MS_PER_HOUR; // window opened Thu 07:00; anchor lands exactly 24h in
  const result = composeBurnSection({
    anchors: [{ atMs: anchorAtMs, pct: 23, scope: 'all' }],
    nowMs,
    resetConfig: resetConfig(),
    localBurnRateTokensPerHour: 1000,
    anchorScope: 'all',
  });
  assert.equal(result.kind, 'warn');
  assert.ok(Number.isFinite(result.runOutAtMs));
});

test('BL-619: a single anchor recorded late in the window carries a diluted average and may still compose to ok', () => {
  // Same 23% anchor as warning-leads-briefing-01 above, but recorded near
  // the END of the window instead of the start - the "average since window
  // start" rate this single data point implies is diluted by the days
  // before the anchor existed, so even a 23% checkpoint does not always
  // project exhaustion before the very next reset. This is the single-
  // anchor fallback's documented conservatism (ticket shape #2), not a bug.
  const nowMs = localMs(30, '00:00'); // Thursday, before the 07:00 reset
  const anchorAtMs = nowMs - 2 * MS_PER_HOUR;
  const result = composeBurnSection({
    anchors: [{ atMs: anchorAtMs, pct: 23, scope: 'all' }],
    nowMs,
    resetConfig: resetConfig(),
    localBurnRateTokensPerHour: 1000,
    anchorScope: 'all',
  });
  assert.equal(result.kind, 'ok');
});

test('BL-619 ok-path-one-line-status-03: an anchor projecting exhaustion after the reset composes to ok', () => {
  const nowMs = localMs(24, '10:00'); // Friday, next reset is the following Thursday
  const anchorAtMs = nowMs - 2 * MS_PER_HOUR;
  const result = composeBurnSection({
    anchors: [{ atMs: anchorAtMs, pct: 5, scope: 'all' }],
    nowMs,
    resetConfig: resetConfig(),
    localBurnRateTokensPerHour: 1000,
    anchorScope: 'all',
  });
  assert.equal(result.kind, 'ok');
});

test('BL-619 no-anchor-never-fabricates-06: no anchor in the current window composes to no-anchor, never a percentage', () => {
  const nowMs = localMs(24, '10:00');
  const result = composeBurnSection({
    anchors: [],
    nowMs,
    resetConfig: resetConfig(),
    localBurnRateTokensPerHour: 2500,
    anchorScope: 'all',
  });
  assert.deepEqual(result, { kind: 'no-anchor', localBurnRateTokensPerHour: 2500 });
});

test('BL-619: an anchor outside the current window (from the prior cycle) is ignored, same as no anchor', () => {
  const nowMs = localMs(24, '10:00');
  const windowStart = currentWeeklyWindowStartMs(nowMs, 4, { hour: 7, minute: 0 });
  const staleAnchor = { atMs: windowStart - MS_PER_HOUR, pct: 90, scope: 'all' };
  const result = composeBurnSection({
    anchors: [staleAnchor],
    nowMs,
    resetConfig: resetConfig(),
    localBurnRateTokensPerHour: 2500,
    anchorScope: 'all',
  });
  assert.equal(result.kind, 'no-anchor');
});

test('BL-619 malformed-reset-config-08: a malformed reset config composes to malformed regardless of anchors', () => {
  const nowMs = localMs(24, '10:00');
  const result = composeBurnSection({
    anchors: [{ atMs: nowMs, pct: 99, scope: 'all' }],
    nowMs,
    resetConfig: { config: null, malformed: true, warning: 'malformed usage week reset config: day=funday local=(default)' },
    localBurnRateTokensPerHour: 1500,
    anchorScope: 'all',
  });
  assert.deepEqual(result, {
    kind: 'malformed',
    localBurnRateTokensPerHour: 1500,
    warning: 'malformed usage week reset config: day=funday local=(default)',
  });
});
