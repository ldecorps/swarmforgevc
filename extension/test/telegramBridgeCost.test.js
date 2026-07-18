const assert = require('node:assert/strict');
const { computeTelegramBridgeCostForDay, formatTelegramBridgeCostLine } = require('../out/metrics/telegramBridgeCost');

// BL-511 (amended 2026-07-18, front-desk-only): the daily-briefing email
// estimates the Telegram front-desk bridge's cost per day from the exact
// total_cost_usd each front-desk `claude -p --output-format json`
// invocation already reports. Attribution rule (pinned in specs/features/
// BL-511-...feature): a front-desk invocation is DEDICATED to Telegram, so
// its whole cost counts, no proration. The always-on Operator's Telegram
// share is OUT OF SCOPE - it runs as an interactive `claude --remote-
// control` session and emits no per-wakeup total_cost_usd anywhere on
// disk, so it cannot be captured exactly; a count x average estimate would
// violate both the human's exact-cost basis and this codebase's honest-
// null discipline, so it is reported nowhere (documented at the capture/
// compute site, never silently rendered as "Operator $0.00 attributed" -
// a false measured-zero). An invocation with unknown/null cost is
// EXCLUDED from the total, never counted as $0.

const DAY = '2026-07-18';

function frontDesk(overrides = {}) {
  return { ts: `${DAY}T09:00:00Z`, kind: 'front-desk', model: 'claude-opus-4-8', total_cost_usd: 0.04, ...overrides };
}

// ── BL-511 frontdesk-attributed-fully-03 ──────────────────────────────────

test('computeTelegramBridgeCostForDay: a front-desk record counts its whole cost, no proration', () => {
  const summary = computeTelegramBridgeCostForDay([frontDesk({ total_cost_usd: 0.05 })], DAY);
  assert.equal(summary.totalUsd, 0.05);
  assert.equal(summary.frontDeskUsd, 0.05);
});

// ── BL-511 unknown-cost-not-invented-06 ───────────────────────────────────

test('computeTelegramBridgeCostForDay: a front-desk record with unknown cost is excluded from the total, never $0', () => {
  const summary = computeTelegramBridgeCostForDay([frontDesk({ total_cost_usd: null, model: 'some-unpriced-model' })], DAY);
  assert.equal(summary.totalUsd, 0);
  assert.equal(summary.unknownCount, 1);
});

// ── day-key filtering ──────────────────────────────────────────────────

test('computeTelegramBridgeCostForDay: a record outside the given day is excluded entirely', () => {
  const summary = computeTelegramBridgeCostForDay([frontDesk({ ts: '2026-07-17T23:59:00Z', total_cost_usd: 0.5 })], DAY);
  assert.equal(summary.totalUsd, 0);
  assert.equal(summary.frontDeskCount, 0);
});

test('computeTelegramBridgeCostForDay: front-desk call count includes every front-desk record for the day, priced or not', () => {
  const summary = computeTelegramBridgeCostForDay(
    [frontDesk({ total_cost_usd: 0.01 }), frontDesk({ total_cost_usd: null })],
    DAY
  );
  assert.equal(summary.frontDeskCount, 2);
  assert.equal(summary.totalUsd, 0.01);
});

test('computeTelegramBridgeCostForDay: an empty record list yields a zeroed, empty-day summary', () => {
  const summary = computeTelegramBridgeCostForDay([], DAY);
  assert.deepEqual(summary, { totalUsd: 0, frontDeskCount: 0, frontDeskUsd: 0, unknownCount: 0 });
});

// ── BL-511 briefing-line-total-and-frontdesk-count-05 ─────────────────────

test('formatTelegramBridgeCostLine: a day with front-desk activity shows the total and the call count, no Operator term', () => {
  const summary = computeTelegramBridgeCostForDay([frontDesk({ total_cost_usd: 0.04 }), frontDesk({ total_cost_usd: 0.02 })], DAY);
  const line = formatTelegramBridgeCostLine(summary);
  assert.ok(line.length > 0);
  assert.match(line, /\$0\.06/);
  assert.match(line, /2 front-desk calls/);
  assert.doesNotMatch(line, /Operator/i, 'expected no "Operator" term - an unmeasured share must never render as a measured zero');
});

// ── BL-511 line-omitted-when-nothing-to-show-07 ───────────────────────────

test('formatTelegramBridgeCostLine: an empty-day summary (no records at all) formats to an empty string, never a fabricated line', () => {
  const summary = computeTelegramBridgeCostForDay([], DAY);
  assert.equal(formatTelegramBridgeCostLine(summary), '');
});

// A day with real activity but only unknown-cost invocations is NOT the same
// as "no records" (Scenario 7's own <log_state> examples are "no records for
// the day / absent / unreadable" - a day WITH activity is never one of
// those) - the line still renders, honestly noting the unpriced exclusion
// rather than silently vanishing real activity.
test('formatTelegramBridgeCostLine: a day of only unknown-cost invocations still renders, noting the exclusion (not silently omitted)', () => {
  const summary = computeTelegramBridgeCostForDay([frontDesk({ total_cost_usd: null })], DAY);
  const line = formatTelegramBridgeCostLine(summary);
  assert.notEqual(line, '');
  assert.match(line, /\$0\.00/);
  assert.match(line, /1 unpriced/);
});
