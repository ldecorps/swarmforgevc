// BL-511 (amended 2026-07-18, front-desk-only): pure attribution/formatting
// core for the Telegram front-desk bridge's daily cost estimate. Reads the
// exact total_cost_usd each front-desk `claude -p --output-format json`
// invocation already reports (captured at reap time by operator_runtime.bb,
// before that invocation's result file is deleted - see operator_lib.bb's
// front-desk-cost-record) rather than a count x average guess.
//
// SCOPE: front-desk only. The original ticket also covered the always-on
// Operator's Telegram-attributable share, prorated by its batch's
// telegram/total event ratio - RETIRED. The Operator launches as an
// INTERACTIVE `claude --remote-control` session (launch_operator.sh), never
// a headless `-p --output-format json` call, so it emits NO per-wakeup
// total_cost_usd anywhere on disk - its cost lives only server-side on
// claude.ai, unreachable at reap time. A count x average estimate would
// violate both the human's exact-cost basis and this codebase's honest-null
// discipline (estimateCostUsd in pricingTable.ts), so the Operator's
// Telegram share is measured NOWHERE and reported NOWHERE - this comment is
// that documentation. Do not resurrect an 'operator' record kind or an
// "Operator $X attributed" line term without a real capture mechanism to
// back it; a silently-zero Operator term would falsely report an unmeasured
// share as a measured zero (exactly what unknown-cost-not-invented-06
// forbids for a single record, at the whole-dimension scale).
//
// This module stays pure (no fs, no clock, no network) so it is reachable
// by an in-process unit test and by the CLI's thin main() alike - the CLI
// (extension/src/tools/telegram-bridge-cost-line.ts) owns reading the
// durable JSONL log and resolving today's day-key, and calls these two
// functions with the result.

// Field names mirror the JSONL record's ACTUAL on-disk keys (written by
// operator_lib.bb's front-desk-cost-record via Cheshire, which serializes a
// Clojure keyword verbatim) rather than a camelCase transliteration - no
// translation layer sits between the log format and this type.
export interface BridgeCostRecord {
  ts: string; // ISO 8601 instant
  kind: 'front-desk';
  model?: string;
  total_cost_usd: number | null;
}

export interface BridgeCostDaySummary {
  totalUsd: number;
  frontDeskCount: number;
  frontDeskUsd: number;
  unknownCount: number;
}

// The date portion of an ISO 8601 instant is always its first 10
// characters ("YYYY-MM-DD") - a plain substring, never a Date object, so
// day-bucketing never touches the real clock (the day-key itself is an
// argument the CLI's caller supplies, per the ticket's own "no real-clock
// day-bucketing" scope note).
function dayKeyOf(ts: string): string {
  return ts.slice(0, 10);
}

function hasKnownCost(record: BridgeCostRecord): record is BridgeCostRecord & { total_cost_usd: number } {
  return typeof record.total_cost_usd === 'number';
}

export function computeTelegramBridgeCostForDay(records: BridgeCostRecord[], dayKey: string): BridgeCostDaySummary {
  const dayRecords = records.filter((r) => r.kind === 'front-desk' && dayKeyOf(r.ts) === dayKey);
  let frontDeskCount = 0;
  let frontDeskUsd = 0;
  let unknownCount = 0;

  for (const record of dayRecords) {
    frontDeskCount += 1;
    if (hasKnownCost(record)) {
      frontDeskUsd += record.total_cost_usd;
    } else {
      unknownCount += 1;
    }
  }

  return { totalUsd: frontDeskUsd, frontDeskCount, frontDeskUsd, unknownCount };
}

// Omitted (empty string) ONLY when the day has NO records at all -
// briefing_email_lib.bb's append-content-block already treats a blank
// block as "nothing to append." A day WITH activity but only unknown-cost
// invocations still renders (honestly noting the exclusion), since real
// activity happened - that is not the same as "nothing to show." No
// "Operator ... attributed" term - see the SCOPE comment above.
export function formatTelegramBridgeCostLine(summary: BridgeCostDaySummary): string {
  if (summary.frontDeskCount === 0) {
    return '';
  }
  const frontDeskPart = `${summary.frontDeskCount} front-desk call${summary.frontDeskCount === 1 ? '' : 's'}`;
  const unknownPart = summary.unknownCount > 0 ? `, ${summary.unknownCount} unpriced excluded` : '';
  return `Telegram bridge cost: $${summary.totalUsd.toFixed(2)} today (${frontDeskPart}${unknownPart})`;
}
