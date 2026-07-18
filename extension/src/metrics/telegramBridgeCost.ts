// BL-511: pure attribution/formatting core for the Telegram front-desk
// bridge's daily cost estimate. Reads the exact total_cost_usd each front-
// desk/Operator `claude -p --output-format json` invocation already
// reports (captured at reap time by operator_runtime.bb, before that
// invocation's result file is deleted - see operator_lib.bb's
// front-desk-cost-record) rather than a count x average guess.
//
// Attribution rule (pinned in specs/features/BL-511-telegram-bridge-cost-
// briefing.feature): the front-desk operator is DEDICATED to Telegram, so
// 100% of its cost is bridge cost, with no proration. The always-on
// Operator is SHARED, so a wakeup is attributed by its Telegram SHARE of
// the batch (cost x telegram_events / total_events) - a purely-timer batch
// contributes 0. An invocation whose cost is unknown (unpriced model,
// missing figure) is EXCLUDED from the total and counted separately, never
// coerced to a misleading $0 (estimateCostUsd's own honest-null
// discipline in pricingTable.ts).
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
  kind: 'front-desk' | 'operator';
  model?: string;
  total_cost_usd: number | null;
  telegram_events?: number;
  total_events?: number;
}

export interface BridgeCostDaySummary {
  totalUsd: number;
  frontDeskCount: number;
  frontDeskUsd: number;
  operatorCount: number;
  operatorAttributedUsd: number;
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

interface DayAccumulator {
  frontDeskCount: number;
  frontDeskUsd: number;
  operatorCount: number;
  operatorAttributedUsd: number;
  unknownCount: number;
}

// Split out of computeTelegramBridgeCostForDay below for the same CRAP-budget
// reason qaBounceStore.ts's isQaBounceRecord split documents - one function
// carrying both kinds' branching plus the Operator proration math pushed the
// day-aggregator over the project's CRAP threshold. Each half is scored (and
// mutation-tested) on only its own branches.
function accumulateFrontDesk(acc: DayAccumulator, record: BridgeCostRecord): void {
  acc.frontDeskCount += 1;
  if (hasKnownCost(record)) {
    acc.frontDeskUsd += record.total_cost_usd;
  } else {
    acc.unknownCount += 1;
  }
}

function operatorTelegramShare(record: BridgeCostRecord & { total_cost_usd: number }): number {
  const totalEvents = record.total_events ?? 0;
  const telegramEvents = record.telegram_events ?? 0;
  return totalEvents > 0 ? record.total_cost_usd * (telegramEvents / totalEvents) : 0;
}

function accumulateOperator(acc: DayAccumulator, record: BridgeCostRecord): void {
  acc.operatorCount += 1;
  if (hasKnownCost(record)) {
    acc.operatorAttributedUsd += operatorTelegramShare(record);
  } else {
    acc.unknownCount += 1;
  }
}

export function computeTelegramBridgeCostForDay(records: BridgeCostRecord[], dayKey: string): BridgeCostDaySummary {
  const dayRecords = records.filter((r) => dayKeyOf(r.ts) === dayKey);
  const acc: DayAccumulator = { frontDeskCount: 0, frontDeskUsd: 0, operatorCount: 0, operatorAttributedUsd: 0, unknownCount: 0 };

  for (const record of dayRecords) {
    if (record.kind === 'front-desk') {
      accumulateFrontDesk(acc, record);
    } else if (record.kind === 'operator') {
      accumulateOperator(acc, record);
    }
  }

  return { totalUsd: acc.frontDeskUsd + acc.operatorAttributedUsd, ...acc };
}

// Omitted (empty string) ONLY when the day has NO records at all -
// briefing_email_lib.bb's append-content-block already treats a blank
// block as "nothing to append." A day WITH activity but only unknown-cost
// invocations still renders (honestly noting the exclusion), since real
// activity happened - that is not the same as "nothing to show."
export function formatTelegramBridgeCostLine(summary: BridgeCostDaySummary): string {
  const recordCount = summary.frontDeskCount + summary.operatorCount;
  if (recordCount === 0) {
    return '';
  }
  const frontDeskPart = `${summary.frontDeskCount} front-desk call${summary.frontDeskCount === 1 ? '' : 's'}`;
  const operatorPart = `Operator $${summary.operatorAttributedUsd.toFixed(2)} attributed`;
  const unknownPart = summary.unknownCount > 0 ? `, ${summary.unknownCount} unpriced excluded` : '';
  return `Telegram bridge cost: $${summary.totalUsd.toFixed(2)} today (${frontDeskPart}, ${operatorPart}${unknownPart})`;
}
