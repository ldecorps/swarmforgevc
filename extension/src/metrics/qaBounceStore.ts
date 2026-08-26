// BL-454: the impure read/write layer for the QA-bounce durable log -
// .swarmforge/qa_bounces/<YYYY-MM>.jsonl, one line per recorded bounce,
// bucketed by the MONTH THE BOUNCE ITSELF OCCURRED (record.at), the same
// machine-local runtime posture as recertificationStore.ts's
// recert_proposals/<yyyy-MM>.jsonl and handoffd.bb's chaser-<yyyy-MM>.jsonl -
// gitignored, never committed, host-side only (local-engineering rule 5:
// this is live/machine-local data, never the static backlog PWA).
//
// Architect bounce: lives under metrics/, not quality/, alongside the same
// pure/impure split reworkObservatory.ts + reworkObservatoryStore.ts already
// establish there - .dependency-cruiser.cjs's own no-io-from-policy rule
// forbids ANY fs/child_process/network import from src/quality/ (that
// directory is the one genuine pure-policy zone in this repo today), and
// this file's real fs reads/writes are exactly what the rule exists to keep
// out of it. The pure policy module it depends on (qaBounce.ts: the closed-
// set vocabulary, record shape, and tally aggregator) stays in quality/.
//
// BL-635 cleanup: the GENERALISED (by-role) store that reads/writes
// .swarmforge/bounces/ moved out to bounceStore.ts (BL-485 mutation-site
// budget - this file plus the new store together were pushing one module
// past a tractable size) - it imports the shared JSONL-walking helpers and
// shape-check building blocks exported below and reads this file's legacy
// log read-only, same "additive over the QA-only log" relationship the code
// always had, just across two files now instead of one.
import * as fs from 'fs';
import * as path from 'path';
import { atomicAppend } from '../util/atomicWrite';
import { hasQaBounceRecord, isKnownFailureClass, isKnownProducingRole, isKnownTicketType, QaBounceRecord } from '../quality/qaBounce';

export function qaBouncesDir(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'qa_bounces');
}

export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7); // yyyy-MM
}

function qaBounceFilePath(targetPath: string, isoDate: string): string {
  return path.join(qaBouncesDir(targetPath), `${monthOf(isoDate)}.jsonl`);
}

// Split out of isQaBounceRecord below for the same CRAP-budget reason the
// qaBounceEvidenceParser helpers document - a flat 9-clause boolean chain
// pushed the type guard's own branch count well over the project's CRAP
// threshold. Reordering to "all shape checks, then all closed-set checks"
// (rather than interleaved per-field) is behavior-preserving: every predicate
// here is a pure, side-effect-free check over independent fields, so `&&`
// commutativity guarantees the same final boolean for every input.
// Exported: bounceStore.ts's own type guard extends this shape check rather
// than duplicating it (BL-635).
export function hasQaBounceRecordShape(candidate: Partial<QaBounceRecord>): boolean {
  return (
    typeof candidate.ticket === 'string' &&
    typeof candidate.producingRole === 'string' &&
    typeof candidate.ticketType === 'string' &&
    typeof candidate.failureClass === 'string' &&
    typeof candidate.commit === 'string' &&
    typeof candidate.at === 'string'
  );
}

// Only called once hasQaBounceRecordShape has confirmed every field below is
// a string, so the casts are safe. Exported for the same reason as
// hasQaBounceRecordShape above.
export function hasKnownQaBounceValues(candidate: Partial<QaBounceRecord>): boolean {
  return (
    isKnownProducingRole(candidate.producingRole as string) &&
    isKnownTicketType(candidate.ticketType as string) &&
    isKnownFailureClass(candidate.failureClass as string)
  );
}

function isQaBounceRecord(value: unknown): value is QaBounceRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<QaBounceRecord>;
  return hasQaBounceRecordShape(candidate) && hasKnownQaBounceValues(candidate);
}

// A malformed or unrecognized line is skipped, never a crash - same
// forgiving-reader posture as swarmMetrics.ts's chaser telemetry reader.
// Generic over the record shape so both this file's QA-only log and
// bounceStore.ts's generalised log share one JSONL-walking implementation -
// each supplies its own type-guard rather than its own copy of this
// traversal.
function parseJsonlLine<T>(line: string, isRecord: (value: unknown) => value is T): T | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readJsonlRecordsFromFile<T>(dir: string, file: string, isRecord: (value: unknown) => value is T): T[] {
  let content: string;
  try {
    content = fs.readFileSync(path.join(dir, file), 'utf8');
  } catch {
    return [];
  }
  const records: T[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const record = parseJsonlLine(line, isRecord);
    if (record) {
      records.push(record);
    }
  }
  return records;
}

// Exported: bounceStore.ts reuses this directory-walking traversal for the
// generalised log rather than re-implementing it (BL-635).
export function readJsonlRecordsFromDir<T>(dir: string, isRecord: (value: unknown) => value is T): T[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  return files.flatMap((file) => readJsonlRecordsFromFile(dir, file, isRecord));
}

export function readQaBounceRecords(targetPath: string): QaBounceRecord[] {
  return readJsonlRecordsFromDir(qaBouncesDir(targetPath), isQaBounceRecord);
}

// Idempotent append: dedupes against every record ALREADY in the log (across
// every month file, not just the target month) on the natural key (ticket +
// date + failure class) before appending - a live write racing a backfill,
// or a re-run of either, never double-counts (BL-454's own idempotency
// constraint). Returns whether a new record was actually appended.
export function appendQaBounceRecordIfNew(targetPath: string, record: QaBounceRecord): boolean {
  const existing = readQaBounceRecords(targetPath);
  if (hasQaBounceRecord(existing, record)) {
    return false;
  }
  atomicAppend(qaBounceFilePath(targetPath, record.at), JSON.stringify(record) + '\n');
  return true;
}
