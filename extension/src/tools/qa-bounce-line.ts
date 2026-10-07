#!/usr/bin/env node
/**
 * BL-454: prints ONE plain-text line/section - the bounce tally - for
 * briefing_email_lib.bb (a Babashka script with no way to import compiled
 * TS) to shell out to and fold into the daily briefing, the same shell-out
 * convention every other briefing section already uses
 * (suite-duration-line.js, not-done-count-line.js, ...). Prints nothing
 * (empty stdout, exit 0) when there are no recorded bounces yet -
 * briefing_email_lib.bb's append-content-block already treats a blank block
 * as "nothing to append," never a fabricated zero-bounce line.
 *
 * BL-635: generalised from a QA-only line to report who BOUNCED as well as
 * whose work bounced - the durable log now carries any reviewing role's
 * send-backs (record-bounce.js), not only QA's (the legacy
 * record-qa-bounce.js writer this line used to read exclusively). Reads the
 * MERGED log (readBounceRecords: the new .swarmforge/bounces/ path plus the
 * legacy .swarmforge/qa_bounces/ one, forever) so the 53 pre-BL-635 records
 * still count, attributed as unattributed rather than silently folded into
 * QA (they predate `by` on the JSONL line entirely).
 *
 * BL-1880: the briefing line used to count every bounce since the project
 * began with no date filter, so it could not answer "did a role's work
 * bounce more, or less, since its model changed?" The live briefing line
 * (main(), no --json) now leads with the bounces since the PREVIOUS
 * briefing was sent, a seven-day trend and the current model per producing
 * role, and keeps the all-time total (with the pre-existing breakdowns)
 * last. formatBounceLine itself is untouched - BL-454/635/688/689's own
 * acceptance scenarios call it directly with their own fixture tallies, not
 * through main(), so leaving it alone keeps them green by construction.
 * BL-1811: the model per role is read through backendSwitch.ts's
 * readRoleModelId, never re-derived here.
 *
 * Usage: node qa-bounce-line.js [--target <path>] [--at <iso-timestamp>] [--json]
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  computeQaBounceTally,
  computeBounceTallyByBouncingRole,
  computeDefectsPerBounce,
  BounceRecord,
  QaBounceRoleTally,
  QaBounceTally,
} from '../quality/qaBounce';
import { readBounceRecords } from '../metrics/bounceStore';
import { resolveCliMainWorktreeContext, runCliMain, printJsonToStdout } from './swarm-metrics';
import { readRoleModelId } from '../swarm/backendSwitch';
import { formatModelDisplayName } from '../swarm/modelDisplayName';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TREND_DAYS = 7;

function formatRoleCounts(counts: QaBounceRoleTally[]): string {
  return counts.map(({ role, count }) => `${role} x${count}`).join(', ');
}

// BL-689: defectsPerBounce is optional and, when omitted, produces BYTE-FOR-
// BYTE the same line this function printed before this ticket - every
// existing caller (bl635/bl688's own step handlers) keeps working unchanged.
// BL-1880 leaves this function and every one of its callers untouched -
// main()'s own printed line now comes from formatBounceWindowLine below.
export function formatBounceLine(byBouncingRole: QaBounceRoleTally[], tally: QaBounceTally, defectsPerBounce?: number): string {
  const byType = Object.entries(tally.byTicketType)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => `${type} x${count}`)
    .join(', ');
  const defectsPerBouncePart = typeof defectsPerBounce === 'number' ? ` (${defectsPerBounce.toFixed(1)} defects/bounce)` : '';
  return (
    `Bounces: ${tally.total} total${defectsPerBouncePart} - by bouncing role: ${formatRoleCounts(byBouncingRole)} - ` +
    `whose work: ${formatRoleCounts(tally.byRole)} - by ticket type: ${byType}`
  );
}

// ── BL-1880: the window + trend + model report, pure core ───────────────

export interface BounceWindowStart {
  startIso: string;
  hadPreviousBriefing: boolean;
}

// Invariant 1 half: the window's own start, computed from one input (when
// the previous briefing was sent, or undefined) rather than re-deriving it
// from the bounce log itself.
export function computeWindowStart(previousBriefingAtIso: string | undefined, nowIso: string): BounceWindowStart {
  if (previousBriefingAtIso) {
    return { startIso: previousBriefingAtIso, hadPreviousBriefing: true };
  }
  return { startIso: new Date(new Date(nowIso).getTime() - MS_PER_DAY).toISOString(), hadPreviousBriefing: false };
}

// Invariant 2: a bounce is in the window exactly when its time is AFTER the
// window start (never at-or-equal), so a bounce landing exactly on a window
// boundary is counted in exactly one of two consecutive briefings, never
// both and never neither.
export function recordsAfter(records: BounceRecord[], startIso: string): BounceRecord[] {
  const startMs = new Date(startIso).getTime();
  return records.filter((r) => new Date(r.at).getTime() > startMs);
}

// One count per day for the seven days before nowIso, oldest first - fixed
// 24-hour buckets ending at nowIso (bucket 6, the newest, is (now-24h, now];
// bucket 0, the oldest, is (now-7*24h, now-6*24h]), never calendar-day
// boundaries - the window fallback above already treats "the last 24
// hours" the same way, so the two concepts share one notion of a day.
export function computeSevenDayTrend(records: BounceRecord[], role: string, nowIso: string): number[] {
  const nowMs = new Date(nowIso).getTime();
  const counts = new Array(TREND_DAYS).fill(0) as number[];
  for (const record of records) {
    if (record.producingRole !== role) {
      continue;
    }
    const daysBefore = Math.floor((nowMs - new Date(record.at).getTime()) / MS_PER_DAY);
    if (daysBefore >= 0 && daysBefore < TREND_DAYS) {
      counts[TREND_DAYS - 1 - daysBefore] += 1;
    }
  }
  return counts;
}

export interface BounceWindowRoleEntry {
  role: string;
  windowCount: number;
  trend: number[];
  model: string;
}

export interface BounceWindowReport {
  windowStartIso: string;
  hadPreviousBriefing: boolean;
  windowTotal: number;
  windowByProducingRole: BounceWindowRoleEntry[];
  windowByBouncingRole: QaBounceRoleTally[];
  allTimeTotal: number;
  allTimeByBouncingRole: QaBounceRoleTally[];
  allTimeByTicketType: Record<string, number>;
  allTimeDefectsPerBounce: number;
}

// The one assembly point every figure (the line AND the JSON) reads
// through - invariant 1's "same reader" for the window/trend/all-time
// figures together, so a correction (BL-990, already resolved out of
// allRecords by readBounceRecords before this is called) changes every one
// of them at once. modelForRole is injected so this stays pure and
// testable without a filesystem - main() below supplies the real
// readRoleModelId-backed reader.
export function buildBounceWindowReport(
  allRecords: BounceRecord[],
  previousBriefingAtIso: string | undefined,
  nowIso: string,
  modelForRole: (role: string) => string
): BounceWindowReport {
  const { startIso, hadPreviousBriefing } = computeWindowStart(previousBriefingAtIso, nowIso);
  const windowRecords = recordsAfter(allRecords, startIso);
  const windowTally = computeQaBounceTally(windowRecords);
  const windowByProducingRole: BounceWindowRoleEntry[] = windowTally.byRole.map(({ role, count }) => ({
    role,
    windowCount: count,
    trend: computeSevenDayTrend(allRecords, role, nowIso),
    model: modelForRole(role),
  }));
  const allTimeTally = computeQaBounceTally(allRecords);
  return {
    windowStartIso: startIso,
    hadPreviousBriefing,
    windowTotal: windowTally.total,
    windowByProducingRole,
    windowByBouncingRole: computeBounceTallyByBouncingRole(windowRecords),
    allTimeTotal: allTimeTally.total,
    allTimeByBouncingRole: computeBounceTallyByBouncingRole(allRecords),
    allTimeByTicketType: allTimeTally.byTicketType,
    allTimeDefectsPerBounce: computeDefectsPerBounce(allRecords),
  };
}

function formatRoleEntry(entry: BounceWindowRoleEntry): string {
  return `${entry.role} x${entry.windowCount} (trend ${entry.trend.join(' ')}, now ${entry.model})`;
}

// The all-time total is kept LAST and labelled "all-time total" - nothing
// follows it, so a caller scanning for where the line ends always finds it
// there (scenario 05). The window leads, named by when it started or, with
// no previous briefing on record, as the last-24-hours fallback.
export function formatBounceWindowLine(report: BounceWindowReport): string {
  const windowLabel = report.hadPreviousBriefing
    ? `Bounces since ${report.windowStartIso}`
    : 'Bounces in the last 24 hours (no previous briefing was found)';
  const byProducing = report.windowByProducingRole.length > 0 ? report.windowByProducingRole.map(formatRoleEntry).join(', ') : 'none';
  const byType = Object.entries(report.allTimeByTicketType)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => `${type} x${count}`)
    .join(', ');
  return (
    `${windowLabel}: ${report.windowTotal} - by producing role: ${byProducing} - ` +
    `by bouncing role: ${formatRoleCounts(report.allTimeByBouncingRole)} - ` +
    `by ticket type: ${byType} (${report.allTimeDefectsPerBounce.toFixed(1)} defects/bounce) - ` +
    `all-time total: ${report.allTimeTotal}`
  );
}

// ── BL-1880: when was the previous briefing sent - impure shell ─────────

const DAY_KEY_PATTERN = /^(\d{4}-\d{2}-\d{2})\.md$/;

// The most recent docs/briefings/<day>.md whose day is strictly before
// nowIso's own day - never today's own file, which this CLI typically runs
// to feed content INTO, before it exists. Absent (or unreadable) briefings
// directory reads as "no previous briefing", same as an empty one.
function findPreviousBriefingFile(targetPath: string, nowIso: string): string | undefined {
  const dir = path.join(targetPath, 'docs', 'briefings');
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return undefined;
  }
  const todayKey = nowIso.slice(0, 10);
  const dayKeys = names
    .map((name) => DAY_KEY_PATTERN.exec(name)?.[1])
    .filter((day): day is string => Boolean(day) && day! < todayKey)
    .sort();
  if (dayKeys.length === 0) {
    return undefined;
  }
  return path.join(dir, `${dayKeys[dayKeys.length - 1]}.md`);
}

// "The commit that added the previous briefing's file" (the ticket's own
// suggestion): the OLDEST commit touching that path, not the newest - a
// briefing file is written once and never amended, but reading the oldest
// rather than the newest stays correct even if that ever changes. `%aI`'s
// offset form is fine here: every consumer compares it as a Date, never a
// literal string (computeWindowStart/recordsAfter above).
function gitLog(targetPath: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: targetPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return undefined;
  }
}

function findPreviousBriefingSentAtIso(targetPath: string, nowIso: string): string | undefined {
  const file = findPreviousBriefingFile(targetPath, nowIso);
  if (!file) {
    return undefined;
  }
  const out = gitLog(targetPath, ['log', '--format=%aI', '--follow', '--', file]);
  if (!out) {
    return undefined;
  }
  const lines = out.split('\n').filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : undefined;
}

function modelForRole(targetPath: string): (role: string) => string {
  return (role) => {
    const modelId = readRoleModelId(targetPath, role);
    return modelId ? formatModelDisplayName(modelId) : 'model unknown';
  };
}

export interface QaBounceLineArgs {
  target?: string;
  at?: string;
  json?: boolean;
}

// The value following `flag` at position `i` in `argv`, or undefined when
// `argv[i]` is not `flag` or `flag` is the last argument. Split out of
// parseArgv (BL-1880 hardening) so each of the two value-flags is one
// function call in the loop below, not its own && chain.
function valueFlagAt(argv: string[], i: number, flag: string): string | undefined {
  return argv[i] === flag && argv[i + 1] !== undefined ? argv[i + 1] : undefined;
}

export function parseArgv(argv: string[]): QaBounceLineArgs {
  const args: QaBounceLineArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const target = valueFlagAt(argv, i, '--target');
    if (target !== undefined) {
      args.target = target;
      i++;
      continue;
    }
    const at = valueFlagAt(argv, i, '--at');
    if (at !== undefined) {
      args.at = at;
      i++;
      continue;
    }
    if (argv[i] === '--json') {
      args.json = true;
    }
  }
  return args;
}

// args defaults to {} (never process.argv) - existing callers (bl635/bl688's
// own step handlers, and this ticket's own unit tests) call main() directly
// in-process with no arguments and must keep reading the real cwd/wall
// clock exactly as before. Only the require.main entrypoint below parses
// real argv.
export function main(args: QaBounceLineArgs = {}): void {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  const targetPath = args.target ?? mainWorktreePath;
  const nowIso = args.at ?? new Date().toISOString();
  const records = readBounceRecords(targetPath);
  if (records.length === 0 && !args.json) {
    return;
  }
  const previousBriefingAtIso = findPreviousBriefingSentAtIso(targetPath, nowIso);
  const report = buildBounceWindowReport(records, previousBriefingAtIso, nowIso, modelForRole(targetPath));
  if (args.json) {
    printJsonToStdout(report);
    return;
  }
  console.log(formatBounceWindowLine(report));
}

if (require.main === module) {
  runCliMain(() => main(parseArgv(process.argv.slice(2))));
}
