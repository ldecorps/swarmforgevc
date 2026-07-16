// BL-454: the impure read/write layer for the QA-bounce durable log -
// .swarmforge/qa_bounces/<YYYY-MM>.jsonl, one line per recorded bounce,
// bucketed by the MONTH THE BOUNCE ITSELF OCCURRED (record.at), the same
// machine-local runtime posture as recertificationStore.ts's
// recert_proposals/<yyyy-MM>.jsonl and handoffd.bb's chaser-<yyyy-MM>.jsonl -
// gitignored, never committed, host-side only (local-engineering rule 5:
// this is live/machine-local data, never the static backlog PWA).
import * as fs from 'fs';
import * as path from 'path';
import { atomicAppend } from '../util/atomicWrite';
import { hasQaBounceRecord, isKnownFailureClass, isKnownProducingRole, isKnownTicketType, QaBounceRecord } from './qaBounce';

export function qaBouncesDir(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'qa_bounces');
}

function monthOf(isoDate: string): string {
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
function hasQaBounceRecordShape(candidate: Partial<QaBounceRecord>): boolean {
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
// a string, so the casts are safe.
function hasKnownQaBounceValues(candidate: Partial<QaBounceRecord>): boolean {
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
function parseQaBounceLine(line: string): QaBounceRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isQaBounceRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readQaBounceFile(dir: string, file: string): QaBounceRecord[] {
  let content: string;
  try {
    content = fs.readFileSync(path.join(dir, file), 'utf8');
  } catch {
    return [];
  }
  const records: QaBounceRecord[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const record = parseQaBounceLine(line);
    if (record) {
      records.push(record);
    }
  }
  return records;
}

export function readQaBounceRecords(targetPath: string): QaBounceRecord[] {
  const dir = qaBouncesDir(targetPath);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  return files.flatMap((file) => readQaBounceFile(dir, file));
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
