#!/usr/bin/env node
/**
 * BL-511: prints ONE plain-text line estimating the day's Telegram front-
 * desk bridge cost, for briefing_email_lib.bb (a Babashka script with no
 * way to import compiled TS) to shell out to and fold into the daily
 * briefing email - same shape as qa-bounce-line.ts.
 *
 * Reads the durable per-invocation bridge-cost log
 * (.swarmforge/operator/bridge-cost.jsonl, appended by operator_lib.bb's
 * front-desk-cost-record at reap time) and computes/formats via the pure
 * metrics/telegramBridgeCost.ts module. Prints nothing (empty stdout, exit
 * 0) when the day has no records at all - briefing_email_lib.bb's
 * append-content-block already treats a blank block as "nothing to
 * append."
 *
 * The day-key is an INJECTED arg (optional positional argv[2], "YYYY-MM-DD"),
 * defaulting to real UTC-today when absent - day-bucketing never reads the
 * real clock inside the pure module itself (missing-seam + no-real-clock
 * rule); a test fixes it by passing the arg, matching the "process.argv =
 * [...]" stub convention the thin-wrapper rule already uses elsewhere. The
 * log path is resolved from process.cwd() via resolveCliMainWorktreeContext
 * (same seam qa-bounce-line.ts already relies on) - a test stubs
 * process.cwd() to point at its own fixture root rather than a repo-root
 * sibling (Stryker sandbox rule).
 *
 * Usage: node telegram-bridge-cost-line.js [YYYY-MM-DD]
 */
import * as fs from 'fs';
import * as path from 'path';
import { BridgeCostRecord, computeTelegramBridgeCostForDay, formatTelegramBridgeCostLine } from '../metrics/telegramBridgeCost';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

export function bridgeCostLogPath(mainWorktreePath: string): string {
  return path.join(mainWorktreePath, '.swarmforge', 'operator', 'bridge-cost.jsonl');
}

function isBridgeCostRecord(value: unknown): value is BridgeCostRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<BridgeCostRecord>;
  return (
    typeof candidate.ts === 'string' &&
    (candidate.kind === 'front-desk' || candidate.kind === 'operator') &&
    (candidate.total_cost_usd === null || typeof candidate.total_cost_usd === 'number')
  );
}

// A malformed/unrecognized line is skipped, never a crash - same forgiving-
// reader posture as qaBounceStore.ts's readQaBounceFile. A missing or
// unreadable log file degrades to an empty list (line-omitted-when-nothing-
// to-show-07's "absent"/"unreadable" cases), never an error.
export function readBridgeCostRecords(logPath: string): BridgeCostRecord[] {
  let content: string;
  try {
    content = fs.readFileSync(logPath, 'utf8');
  } catch {
    return [];
  }
  const records: BridgeCostRecord[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (isBridgeCostRecord(parsed)) {
        records.push(parsed);
      }
    } catch {
      // skip malformed line
    }
  }
  return records;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function main(): void {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  const dayKey = process.argv[2] || todayUtc();
  const records = readBridgeCostRecords(bridgeCostLogPath(mainWorktreePath));
  const summary = computeTelegramBridgeCostForDay(records, dayKey);
  const line = formatTelegramBridgeCostLine(summary);
  if (line) {
    console.log(line);
  }
}

if (require.main === module) {
  runCliMain(main);
}
