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

// Split out of isBridgeCostRecord below for the same CRAP-budget reason
// qaBounceStore.ts's hasQaBounceRecordShape/hasKnownQaBounceValues split
// documents - a flat multi-clause boolean chain pushed the type guard's own
// branch count over the project's CRAP threshold.
function isKnownKind(kind: unknown): kind is BridgeCostRecord['kind'] {
  return kind === 'front-desk';
}

function isValidCost(cost: unknown): cost is number | null {
  return cost === null || typeof cost === 'number';
}

// hardener note: the `!value || typeof value !== 'object'` guard and its `return false`
// are mutation-equivalent at every real call site (parseBridgeCostLine below is the
// only caller, and it wraps this whole call in a try/catch) - removing the guard just
// means a non-object `value` (e.g. null) throws reading `candidate.ts` instead of
// returning false, and that throw is caught one frame up with the same net result
// (null). Do not chase a test to kill those mutants; there is no observable difference
// to assert on.
function isBridgeCostRecord(value: unknown): value is BridgeCostRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<BridgeCostRecord>;
  return typeof candidate.ts === 'string' && isKnownKind(candidate.kind) && isValidCost(candidate.total_cost_usd);
}

// A malformed/unrecognized line is skipped, never a crash - same forgiving-
// reader posture as qaBounceStore.ts's readQaBounceFile/parseQaBounceLine
// split, which this mirrors for the same CRAP-budget reason.
//
// hardener note: an empty `catch {}` (dropping the explicit `return null`) is also
// mutation-equivalent - the only caller (readBridgeCostRecords below) only ever checks
// the result for truthiness (`if (record)`), so an implicit `undefined` return behaves
// identically to `null` there.
function parseBridgeCostLine(line: string): BridgeCostRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isBridgeCostRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// A missing or unreadable log file degrades to an empty list
// (line-omitted-when-nothing-to-show-07's "absent"/"unreadable" cases),
// never an error.
export function readBridgeCostRecords(logPath: string): BridgeCostRecord[] {
  let content: string;
  try {
    content = fs.readFileSync(logPath, 'utf8');
  } catch {
    return [];
  }
  const records: BridgeCostRecord[] = [];
  for (const line of content.split('\n')) {
    // hardener note: this blank-line skip is also mutation-equivalent - a blank/
    // whitespace-only line always fails JSON.parse below regardless, so removing or
    // widening this guard produces the same end result (line skipped) either way.
    if (!line.trim()) {
      continue;
    }
    const record = parseBridgeCostLine(line);
    if (record) {
      records.push(record);
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
