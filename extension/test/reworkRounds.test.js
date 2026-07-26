const assert = require('node:assert/strict');
const {
  computeRoundsPerCloseSeriesByRole,
  computeMaxRoundsIndicator,
  computeDailyReworkSeries,
  computeDailyReworkSeriesByRole,
  lastNDaysIso,
  renderDailyReworkMarkdownLine,
  REWORK_ATTRIBUTION_EPOCH_ISO,
} = require('../out/metrics/reworkRounds');

// BL-635: the pure rework-rounds metric - mean rework rounds per closed
// ticket, split by bouncing role, never pooled.

function record(overrides = {}) {
  return {
    ticket: 'BL-590',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: 'abc1234567',
    at: '2026-07-25T10:00:00.000Z',
    by: 'architect',
    ...overrides,
  };
}

const NOW_MS = Date.parse('2026-07-26T12:00:00.000Z');

// ── record-bounce-by-role-08: rounds per close, split by role, never pooled ─

test('roundsPerClose is 2.0 for architect and 1.0 for QA given 4 architect + 2 QA bounces over 2 closes', () => {
  const records = [
    record({ by: 'architect', at: '2026-07-25T09:00:00.000Z', commit: 'c1' }),
    record({ by: 'architect', at: '2026-07-25T10:00:00.000Z', commit: 'c2' }),
    record({ by: 'architect', at: '2026-07-26T08:00:00.000Z', commit: 'c3' }),
    record({ by: 'architect', at: '2026-07-26T09:00:00.000Z', commit: 'c4' }),
    record({ by: 'QA', at: '2026-07-25T11:00:00.000Z', commit: 'c5' }),
    record({ by: 'QA', at: '2026-07-26T10:00:00.000Z', commit: 'c6' }),
  ];
  const closedDateIsos = ['2026-07-25T12:00:00.000Z', '2026-07-26T11:00:00.000Z'];
  const series = computeRoundsPerCloseSeriesByRole(records, closedDateIsos, NOW_MS);

  // current window (last point) = the trailing 7 days ending at NOW_MS,
  // which covers both closes and all 6 bounces above.
  const architectCurrent = series.architect[series.architect.length - 1];
  const qaCurrent = series.QA[series.QA.length - 1];
  assert.equal(architectCurrent.value, 2.0);
  assert.equal(qaCurrent.value, 1.0);
});

test('no flow balance figure pools architect and QA bounces into one number - each role gets its own series', () => {
  const records = [record({ by: 'architect' }), record({ by: 'QA', ticket: 'BL-606' })];
  const series = computeRoundsPerCloseSeriesByRole(records, ['2026-07-25T12:00:00.000Z'], NOW_MS);
  assert.deepEqual(Object.keys(series).sort(), ['QA', 'architect']);
});

test('a window with zero closed tickets reports unavailable, never a fabricated 0 (BL-635 SEND BACK #1 site 2)', () => {
  const records = [record({ by: 'architect' })];
  const series = computeRoundsPerCloseSeriesByRole(records, [], NOW_MS);
  assert.equal(series.architect[series.architect.length - 1].value, null);
});

test('the prior-window point divides by its own closed count, not the current window\'s', () => {
  // Both windows must sit fully after the by-attribution epoch
  // (2026-07-25) for the prior point to report a real value - NOW_MS above
  // is only 1 day past epoch, which would null out the whole prior window
  // (BL-635 SEND BACK #1 site 1), so this test uses its own, later "now".
  const nowMs = Date.parse('2026-08-10T12:00:00.000Z');
  // 2 architect bounces + 1 close, both 10 days before nowMs - inside the
  // PRIOR 7-day window (days 7-14 back), not the current one.
  const records = [
    record({ by: 'architect', at: '2026-07-31T09:00:00.000Z', commit: 'c1' }),
    record({ by: 'architect', at: '2026-07-31T10:00:00.000Z', commit: 'c2' }),
  ];
  const closedDateIsos = ['2026-07-31T12:00:00.000Z'];
  const series = computeRoundsPerCloseSeriesByRole(records, closedDateIsos, nowMs);
  assert.equal(series.architect[0].value, 2.0);
  // the current window has neither bounces nor closes - unavailable, never
  // a fabricated 0 (BL-635 SEND BACK #1 site 2).
  assert.equal(series.architect[series.architect.length - 1].value, null);
});

// ── BL-635 SEND BACK #1 (evidence sites 1/2): pre-epoch and zero-close ─────
//    windows on the roundsPerClose surface, not just the daily series ──────

test('a window lying entirely before the epoch reports unavailable even when it has real bounces and closes', () => {
  // "now" chosen so the PRIOR window (7-14 days back) - [2026-07-17T12:00,
  // 2026-07-24T12:00) - falls entirely before the 2026-07-25 epoch, even
  // though it holds real bounces and a real close.
  const nowMs = Date.parse('2026-07-31T12:00:00.000Z');
  const records = [
    record({ by: 'architect', at: '2026-07-22T09:00:00.000Z', commit: 'c1' }),
    record({ by: 'architect', at: '2026-07-22T10:00:00.000Z', commit: 'c2' }),
  ];
  const closedDateIsos = ['2026-07-22T12:00:00.000Z'];
  const series = computeRoundsPerCloseSeriesByRole(records, closedDateIsos, nowMs);
  // real data exists in this window (2 bounces, 1 close - would compute to
  // 2.0 if fabricated) but the window is entirely pre-epoch, so it must
  // read unavailable, not a healthy-looking number.
  assert.equal(series.architect[0].value, null);
});

test('a window straddling the epoch is available - only an ENTIRELY pre-epoch window is unavailable', () => {
  const nowMs = Date.parse('2026-07-28T12:00:00.000Z'); // currentStart 2026-07-21T12:00Z, spans the 2026-07-25 epoch
  const records = [record({ by: 'architect', at: '2026-07-27T09:00:00.000Z', commit: 'c1' })];
  const closedDateIsos = ['2026-07-27T10:00:00.000Z'];
  const series = computeRoundsPerCloseSeriesByRole(records, closedDateIsos, nowMs);
  assert.equal(series.architect[series.architect.length - 1].value, 1.0);
});

// ── record-bounce-by-role-10: reads the durable log, never commit subjects ─

test('the metric only ever counts durable BounceRecord entries - title/commit text plays no role', () => {
  // A ticket "titled with the word bounce" or whose fix produced several
  // merge commits mentioning "bounce" simply never appears here at all -
  // this module has no title or commit-message field to read in the first
  // place, so contamination from either source is structurally impossible.
  const records = [record({ ticket: 'BL-999-bounce-watcher-resilience', by: undefined })];
  const closedDateIsos = ['2026-07-25T12:00:00.000Z'];
  const series = computeRoundsPerCloseSeriesByRole(records, closedDateIsos, NOW_MS);
  // unattributed (no `by`) still counts as its own role, never silently
  // dropped or folded into a named role.
  assert.equal(Object.keys(series).length, 1);
  assert.equal(series.unattributed[series.unattributed.length - 1].value, 1);
});

// ── record-bounce-by-role-11: max-rounds indicator ─────────────────────────

test('computeMaxRoundsIndicator names the four-bounce ticket over four once-bounced tickets', () => {
  const records = [
    record({ ticket: 'BL-590', by: 'architect', commit: 'c1' }),
    record({ ticket: 'BL-590', by: 'architect', commit: 'c2' }),
    record({ ticket: 'BL-590', by: 'architect', commit: 'c3' }),
    record({ ticket: 'BL-590', by: 'architect', commit: 'c4' }),
    record({ ticket: 'BL-001', by: 'QA', commit: 'c5' }),
    record({ ticket: 'BL-002', by: 'QA', commit: 'c6' }),
    record({ ticket: 'BL-003', by: 'QA', commit: 'c7' }),
    record({ ticket: 'BL-004', by: 'QA', commit: 'c8' }),
  ];
  assert.deepEqual(computeMaxRoundsIndicator(records), { ticket: 'BL-590', rounds: 4, by: 'architect' });
});

test('computeMaxRoundsIndicator returns null for an empty log', () => {
  assert.equal(computeMaxRoundsIndicator([]), null);
});

test('computeMaxRoundsIndicator breaks a tied bouncing-role count alphabetically', () => {
  const records = [
    record({ ticket: 'BL-590', by: 'coder', commit: 'c1' }),
    record({ ticket: 'BL-590', by: 'coder', commit: 'c2' }),
    record({ ticket: 'BL-590', by: 'architect', commit: 'c3' }),
    record({ ticket: 'BL-590', by: 'architect', commit: 'c4' }),
  ];
  assert.equal(computeMaxRoundsIndicator(records).by, 'architect');
});

// ── record-bounce-by-role-12: bounce-free day is zero, pre-epoch is unavailable ─

test('a bounce-free day at/after the epoch reports zero; every day before the epoch reports unavailable', () => {
  const days = lastNDaysIso(dayMs('2026-07-27'), 3); // 2026-07-25, 26, 27
  const series = computeDailyReworkSeries([], 'architect', days, '2026-07-26');
  assert.deepEqual(series, [
    { periodStart: '2026-07-25', value: null },
    { periodStart: '2026-07-26', value: 0 },
    { periodStart: '2026-07-27', value: 0 },
  ]);
});

// ── record-bounce-by-role-13: known fixtures land on their own day ─────────

test('BL-590 (4 architect bounces on 2026-07-25) and BL-606 (3 on 2026-07-23) land on their own days', () => {
  const records = [
    ...Array.from({ length: 4 }, (_, i) => record({ ticket: 'BL-590', at: `2026-07-25T0${i}:00:00.000Z`, commit: `bl590-${i}` })),
    ...Array.from({ length: 3 }, (_, i) => record({ ticket: 'BL-606', at: `2026-07-23T0${i}:00:00.000Z`, commit: `bl606-${i}` })),
  ];
  const days = ['2026-07-23', '2026-07-24', '2026-07-25'];
  const series = computeDailyReworkSeries(records, 'architect', days, '2026-07-01');
  assert.deepEqual(series, [
    { periodStart: '2026-07-23', value: 3 },
    { periodStart: '2026-07-24', value: 0 },
    { periodStart: '2026-07-25', value: 4 },
  ]);
});

test('computeDailyReworkSeriesByRole reports one series per role present in the log', () => {
  const records = [record({ by: 'architect', at: '2026-07-26T01:00:00.000Z' }), record({ by: 'QA', at: '2026-07-26T02:00:00.000Z', ticket: 'BL-1' })];
  const byRole = computeDailyReworkSeriesByRole(records, ['2026-07-26'], '2026-07-01');
  assert.deepEqual(byRole.architect, [{ periodStart: '2026-07-26', value: 1 }]);
  assert.deepEqual(byRole.QA, [{ periodStart: '2026-07-26', value: 1 }]);
});

test('lastNDaysIso returns n consecutive days, oldest first, ending on the day of nowMs', () => {
  assert.deepEqual(lastNDaysIso(dayMs('2026-07-26'), 3), ['2026-07-24', '2026-07-25', '2026-07-26']);
});

test('REWORK_ATTRIBUTION_EPOCH_ISO is a real, parseable calendar date', () => {
  assert.ok(!Number.isNaN(Date.parse(REWORK_ATTRIBUTION_EPOCH_ISO)));
});

test('BL-635 SEND BACK #1 (evidence site 5): a record written in the last local hour of ship day is counted, never swallowed as pre-epoch', () => {
  // record-bounce.js stamps `at` off the real UTC wall clock; a record
  // written at 2026-07-26 00:51 BST (local ship day) lands on UTC calendar
  // day 2026-07-25. The DEFAULT epoch (no override) must not discard it -
  // this is the exact record the evidence doc reproduced.
  const records = [record({ by: 'architect', at: '2026-07-25T23:51:59.370Z' })];
  const series = computeDailyReworkSeries(records, 'architect', ['2026-07-25'], REWORK_ATTRIBUTION_EPOCH_ISO);
  assert.deepEqual(series, [{ periodStart: '2026-07-25', value: 1 }]);
});

test('renderDailyReworkMarkdownLine renders "unavailable", never the digit 0, for a null point', () => {
  const points = [
    { periodStart: '2026-07-25', value: null },
    { periodStart: '2026-07-26', value: 0 },
  ];
  const line = renderDailyReworkMarkdownLine('architect', points);
  assert.equal(line, 'architect: 2026-07-25: unavailable, 2026-07-26: 0');
  assert.doesNotMatch(line, /2026-07-25: 0/);
});

function dayMs(iso) {
  return Date.parse(`${iso}T12:00:00.000Z`);
}
