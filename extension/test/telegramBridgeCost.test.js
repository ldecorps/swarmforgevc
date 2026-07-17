const assert = require('node:assert/strict');
const { computeTelegramBridgeCostForDay, formatTelegramBridgeCostLine } = require('../out/metrics/telegramBridgeCost');

// Same approximate-equality convention as pricingTable.test.js - avoids
// asserting bit-exact IEEE-754 equality on a computed (non-literal) float.
function assertCloseTo(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: expected ~${expected}, got ${actual}`);
}

// BL-511: the daily-briefing email estimates the Telegram front-desk
// bridge's cost per day from the exact total_cost_usd each front-desk/
// Operator `claude -p --output-format json` invocation already reports.
// Attribution rule (pinned in specs/features/BL-511-...feature): a
// front-desk invocation is DEDICATED to Telegram, so its whole cost counts
// with no proration; an Operator wakeup is SHARED, so it is attributed by
// its Telegram share of the batch (cost x telegram/total). An invocation
// with unknown/null cost is EXCLUDED from the total, never counted as $0.

const DAY = '2026-07-18';

function frontDesk(overrides = {}) {
  return { ts: `${DAY}T09:00:00Z`, kind: 'front-desk', model: 'claude-opus-4-8', total_cost_usd: 0.04, ...overrides };
}

function operatorRecord(overrides = {}) {
  return { ts: `${DAY}T09:05:00Z`, kind: 'operator', model: 'claude-opus-4-8', total_cost_usd: 0.08, telegram_events: 1, total_events: 4, ...overrides };
}

// ── BL-511 frontdesk-attributed-fully-03 ──────────────────────────────────

test('computeTelegramBridgeCostForDay: a front-desk record counts its whole cost, no proration', () => {
  const summary = computeTelegramBridgeCostForDay([frontDesk({ total_cost_usd: 0.05 })], DAY);
  assert.equal(summary.totalUsd, 0.05);
  assert.equal(summary.frontDeskUsd, 0.05);
  assert.equal(summary.operatorAttributedUsd, 0);
});

test('computeTelegramBridgeCostForDay: a front-desk record counts fully regardless of any batch event breakdown', () => {
  // A front-desk record never legitimately carries telegram_events/total_events
  // (front-desk kind is decided by :kind alone, never by an event breakdown) -
  // proves the kind-based branch, not an accidental read of those fields.
  const summary = computeTelegramBridgeCostForDay(
    [frontDesk({ total_cost_usd: 0.05, telegram_events: 0, total_events: 99 })],
    DAY
  );
  assert.equal(summary.totalUsd, 0.05);
});

// ── BL-511 operator-prorated-by-share-04 (Scenario Outline) ──────────────

test('computeTelegramBridgeCostForDay: an Operator record with telegram=3/total=3 attributes the full cost', () => {
  const summary = computeTelegramBridgeCostForDay([operatorRecord({ total_cost_usd: 0.09, telegram_events: 3, total_events: 3 })], DAY);
  assert.equal(summary.operatorAttributedUsd, 0.09);
  assert.equal(summary.totalUsd, 0.09);
});

test('computeTelegramBridgeCostForDay: an Operator record with telegram=1/total=4 attributes a quarter', () => {
  const summary = computeTelegramBridgeCostForDay([operatorRecord({ total_cost_usd: 0.08, telegram_events: 1, total_events: 4 })], DAY);
  assertCloseTo(summary.operatorAttributedUsd, 0.02, 'operatorAttributedUsd');
  assertCloseTo(summary.totalUsd, 0.02, 'totalUsd');
});

test('computeTelegramBridgeCostForDay: a purely-timer Operator batch (telegram=0) attributes none', () => {
  const summary = computeTelegramBridgeCostForDay([operatorRecord({ total_cost_usd: 0.05, telegram_events: 0, total_events: 5 })], DAY);
  assert.equal(summary.operatorAttributedUsd, 0);
  assert.equal(summary.totalUsd, 0);
});

// ── BL-511 unknown-cost-not-invented-06 ───────────────────────────────────

test('computeTelegramBridgeCostForDay: a front-desk record with unknown cost is excluded from the total, never $0', () => {
  const summary = computeTelegramBridgeCostForDay([frontDesk({ total_cost_usd: null, model: 'some-unpriced-model' })], DAY);
  assert.equal(summary.totalUsd, 0);
  assert.equal(summary.unknownCount, 1);
});

test('computeTelegramBridgeCostForDay: an Operator record with unknown cost is excluded from the total, never $0', () => {
  const summary = computeTelegramBridgeCostForDay([operatorRecord({ total_cost_usd: null })], DAY);
  assert.equal(summary.totalUsd, 0);
  assert.equal(summary.operatorAttributedUsd, 0);
  assert.equal(summary.unknownCount, 1);
});

test('computeTelegramBridgeCostForDay: a known-zero-share Operator record is NOT counted as unknown', () => {
  const summary = computeTelegramBridgeCostForDay([operatorRecord({ total_cost_usd: 0.05, telegram_events: 0, total_events: 5 })], DAY);
  assert.equal(summary.unknownCount, 0);
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
  assert.deepEqual(summary, { totalUsd: 0, frontDeskCount: 0, frontDeskUsd: 0, operatorCount: 0, operatorAttributedUsd: 0, unknownCount: 0 });
});

// ── BL-511 briefing-line-total-and-breakdown-05 ───────────────────────────

test('formatTelegramBridgeCostLine: a day with front-desk and Operator activity shows the total and a breakdown', () => {
  const summary = computeTelegramBridgeCostForDay([frontDesk({ total_cost_usd: 0.04 }), operatorRecord({ total_cost_usd: 0.08, telegram_events: 1, total_events: 4 })], DAY);
  const line = formatTelegramBridgeCostLine(summary);
  assert.ok(line.length > 0);
  assert.match(line, /\$0\.06/); // 0.04 + (0.08 * 1/4) = 0.06
  assert.match(line, /1 front-desk call/);
  assert.match(line, /Operator.*\$0\.02/i);
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
