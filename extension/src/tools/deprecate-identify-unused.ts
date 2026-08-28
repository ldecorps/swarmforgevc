#!/usr/bin/env node
/**
 * BL-1186: read-only deprecator scan that ranks code paths, conf keys, and
 * operator verbs by trailing 90-day usage and queues a human notification
 * naming unused/seldom-used candidates. Identify + notify only — never
 * closes a ticket, deletes code, or mutates any live configuration (BL-311
 * three-bucket; BL-1174's `/deprecate` owns adjudicated retirement).
 *
 * Thresholds are LOCKED by the human addendum (approval_context):
 *   unused: 0 hits in the trailing 90 days
 *   seldom: 1 or 2 hits in the trailing 90 days (fewer than 3, but not 0 —
 *     a 0-hit surface is always "unused", never double-counted as "seldom")
 *
 * The usage ledger this reads (.swarmforge/deprecator/usage-ledger.json) is
 * expected to already carry trailing-90-day hit counts per surface, sourced
 * from whatever telemetry this pack has wired up — this scan only consumes
 * it. Fails open with an honest empty report (ledgerAvailable: false, zero
 * candidates) when no ledger file exists, never an error.
 *
 * Usage: node deprecate-identify-unused.js <project-root>
 */
import * as fs from 'fs';
import * as path from 'path';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

export interface UsageLedgerEntry {
  surface: string;
  hits90d: number;
}

export type Classification = 'unused' | 'seldom';

export interface IdentifyUnusedCandidate {
  surface: string;
  class: Classification;
  hits: number;
}

export interface IdentifyUnusedReport {
  generatedAtIso: string;
  ledgerAvailable: boolean;
  candidates: IdentifyUnusedCandidate[];
}

const SELDOM_HIT_CEILING = 3;

/**
 * Pure classification against the human-locked thresholds. 0 hits is
 * ALWAYS "unused", never "seldom" — the two classes partition disjointly,
 * they do not overlap (BL-1186 invariant 2).
 */
export function classifySurface(hits90d: number): Classification | null {
  if (hits90d === 0) {
    return 'unused';
  }
  if (hits90d < SELDOM_HIT_CEILING) {
    return 'seldom';
  }
  return null;
}

/**
 * Ranked, classified candidates for every ledger entry at or below the
 * seldom ceiling — unused first, then ascending hit count, surface name as
 * the final tiebreaker for a deterministic report order.
 */
export function buildIdentifyUnusedReport(entries: UsageLedgerEntry[]): IdentifyUnusedCandidate[] {
  const candidates: IdentifyUnusedCandidate[] = [];
  for (const entry of entries) {
    const cls = classifySurface(entry.hits90d);
    if (cls) {
      candidates.push({ surface: entry.surface, class: cls, hits: entry.hits90d });
    }
  }
  return candidates.sort((a, b) => a.hits - b.hits || a.surface.localeCompare(b.surface));
}

function usageLedgerPath(root: string): string {
  return path.join(root, '.swarmforge', 'deprecator', 'usage-ledger.json');
}

/**
 * Fail-open ledger read: a missing file, unreadable file, or malformed JSON
 * all report {available:false, entries:[]} rather than throwing — an
 * honest empty report, per the ticket's own "How" direction, not a crash.
 */
export function readUsageLedger(root: string): { available: boolean; entries: UsageLedgerEntry[] } {
  const ledgerPath = usageLedgerPath(root);
  if (!fs.existsSync(ledgerPath)) {
    return { available: false, entries: [] };
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    if (!Array.isArray(parsed)) {
      return { available: false, entries: [] };
    }
    const entries = parsed.filter(
      (e): e is UsageLedgerEntry =>
        Boolean(e) && typeof e === 'object' && typeof (e as UsageLedgerEntry).surface === 'string' && typeof (e as UsageLedgerEntry).hits90d === 'number'
    );
    return { available: true, entries };
  } catch {
    return { available: false, entries: [] };
  }
}

/**
 * Queues a human-visible notification naming every candidate and its class
 * (feature scenario notify-human-only-03) — a plain JSON file under
 * .swarmforge/deprecator/pending-notifications/, the same durable-file
 * queuing convention this repo's other "surface it to the human, do not
 * act on it" gates already use (Article 3.6's own hold notes). Writes
 * nothing when there are no candidates. Returns the written path, or null.
 */
export function writePendingNotification(root: string, report: IdentifyUnusedReport): string | null {
  if (report.candidates.length === 0) {
    return null;
  }
  const dir = path.join(root, '.swarmforge', 'deprecator', 'pending-notifications');
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `identify-unused-${report.generatedAtIso.replace(/[^0-9A-Za-z]/g, '-')}.json`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2) + '\n');
  return filePath;
}

/**
 * Required-wiring entry point (BL-1186): read the ledger, classify,
 * report, queue the notification. Never touches backlog/, docs/, or any
 * conf file — the only filesystem write this function makes is the
 * pending-notification queue file itself (BL-1186 invariant 1).
 */
export function runDeprecatorIdentifyUnusedScan(root: string, nowIso: string = new Date().toISOString()): IdentifyUnusedReport {
  const { available, entries } = readUsageLedger(root);
  const candidates = buildIdentifyUnusedReport(entries);
  const report: IdentifyUnusedReport = { generatedAtIso: nowIso, ledgerAvailable: available, candidates };
  writePendingNotification(root, report);
  return report;
}

export function parseArgs(argv: string[]): { root: string } | null {
  const [root] = argv;
  if (!root) {
    return null;
  }
  return { root };
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node deprecate-identify-unused.js <project-root>\n',
  async ({ root }) => {
    printJsonToStdout(runDeprecatorIdentifyUnusedScan(root));
  }
);

if (require.main === module) {
  runCliMain(main);
}
