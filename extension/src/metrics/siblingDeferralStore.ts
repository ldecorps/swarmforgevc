// BL-532: the impure append/read layer over
// .swarmforge/qa_deferrals/<yyyy-MM>.jsonl, mirroring qaBounceStore.ts's own
// posture - gitignored, machine-local, atomic append, month-bucketed on the
// record's own `at`, unparseable lines skipped. A DELIBERATELY separate
// directory from .swarmforge/qa_bounces/ (not a differently-named file
// inside it) so no future reader of the bounce corpus can pick deferrals up
// by accident - keeping that tally clean is half this ticket's value.
//
// Lives under metrics/, not quality/, for the same reason qaBounceStore.ts
// does: `.dependency-cruiser.cjs`'s no-io-from-policy rule forbids any
// fs/child_process/network import from src/quality/. The pure policy module
// this file depends on (siblingDeferral.ts: the record shape, natural key,
// and latest-record-wins reduction) stays in quality/.
import * as fs from 'fs';
import * as path from 'path';
import { atomicAppend } from '../util/atomicWrite';
import { isKnownFailureClass, isRedundantSiblingDeferralWrite, SiblingDeferralRecord } from '../quality/siblingDeferral';

export function siblingDeferralsDir(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'qa_deferrals');
}

function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7); // yyyy-MM
}

function siblingDeferralFilePath(targetPath: string, isoDate: string): string {
  return path.join(siblingDeferralsDir(targetPath), `${monthOf(isoDate)}.jsonl`);
}

// Split the shape check from the closed-set check for the same CRAP-budget
// reason qaBounceStore.ts's own hasQaBounceRecordShape/hasKnownQaBounceValues
// split documents - every predicate here is pure and side-effect-free, so
// `&&` commutativity guarantees the same final boolean for every input.
function hasSiblingDeferralRecordShape(candidate: Partial<SiblingDeferralRecord>): boolean {
  return (
    typeof candidate.ticket === 'string' &&
    typeof candidate.blockedBy === 'string' &&
    typeof candidate.commit === 'string' &&
    typeof candidate.at === 'string' &&
    (candidate.action === 'defer' || candidate.action === 'clear')
  );
}

// A 'defer' record must carry a known failure class and a non-empty check
// command (the CLEAR command it hands back to QA on repeat arrival); a
// 'clear' record carries neither.
//
// hardener note: a mutant forcing `typeof candidate.failureClass === 'string'`
// to `true` is an accepted-equivalent - isKnownFailureClass is a closed-set
// membership check over string literals, so a non-string value can never pass
// it regardless of this guard (no coercion, SameValueZero comparison). No
// input distinguishes the mutant from the original (BL-234 precedent).
function hasKnownSiblingDeferralValues(candidate: Partial<SiblingDeferralRecord>): boolean {
  if (candidate.action === 'clear') {
    return candidate.failureClass === undefined && candidate.check === undefined;
  }
  return typeof candidate.failureClass === 'string' && isKnownFailureClass(candidate.failureClass) && typeof candidate.check === 'string' && candidate.check.length > 0;
}

// hardener note: this guard's mutants (forcing the condition false, swapping
// `||` for `&&`, or emptying the block) are accepted-equivalent given this
// function's ONE call site below. A non-object primitive (number/string/
// boolean) falls through harmlessly to hasSiblingDeferralRecordShape, whose
// property reads on a primitive just yield `undefined` and fail the shape
// check the same way. A `null` value would throw on that same property read,
// but parseSiblingDeferralLine's own try/catch (the sole caller) absorbs it
// and returns null anyway - identical to this guard doing so directly. No
// input reaches an externally observable difference (BL-234 precedent).
function isSiblingDeferralRecord(value: unknown): value is SiblingDeferralRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<SiblingDeferralRecord>;
  return hasSiblingDeferralRecordShape(candidate) && hasKnownSiblingDeferralValues(candidate);
}

// A malformed or unrecognized line is skipped, never a crash - same
// forgiving-reader posture as qaBounceStore.ts.
//
// hardener note: a mutant emptying the `catch` block (dropping `return null`
// for an implicit `return undefined`) is an accepted-equivalent - the only
// caller (readSiblingDeferralFile below) tests the result with `if (record)`,
// which treats `null` and `undefined` identically. No test can observe the
// difference (BL-234 precedent).
function parseSiblingDeferralLine(line: string): SiblingDeferralRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isSiblingDeferralRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readSiblingDeferralFile(dir: string, file: string): SiblingDeferralRecord[] {
  let content: string;
  try {
    content = fs.readFileSync(path.join(dir, file), 'utf8');
  } catch {
    return [];
  }
  const records: SiblingDeferralRecord[] = [];
  for (const line of content.split('\n')) {
    // hardener note: mutants weakening or removing this blank-line
    // short-circuit (`.trim()` -> plain truthiness, or dropping the
    // `continue` entirely) are accepted-equivalent. A whitespace-only line
    // that reaches parseSiblingDeferralLine fails JSON.parse (whitespace
    // alone isn't valid JSON) and is caught by that function's own try/catch,
    // producing the identical "skipped" outcome either way. This check is a
    // pure fast-path, not a correctness boundary (BL-234 precedent).
    if (!line.trim()) {
      continue;
    }
    const record = parseSiblingDeferralLine(line);
    if (record) {
      records.push(record);
    }
  }
  return records;
}

// A missing store directory reads as no deferrals, never a crash - the
// common case for any target that has never had a sibling deferral.
export function readSiblingDeferralRecords(targetPath: string): SiblingDeferralRecord[] {
  const dir = siblingDeferralsDir(targetPath);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  return files.flatMap((file) => readSiblingDeferralFile(dir, file));
}

// Idempotent append: a write that repeats the CURRENT state of its
// (ticket, blockedBy) pair (see isRedundantSiblingDeferralWrite) is not
// appended - a live write racing a re-run never double-counts, while a
// genuine state transition (defer -> clear -> defer) always appends, even
// when the third record's natural key happens to match the first's.
// Returns whether a new record was actually appended.
export function appendSiblingDeferralRecordIfNew(targetPath: string, record: SiblingDeferralRecord): boolean {
  const existing = readSiblingDeferralRecords(targetPath);
  if (isRedundantSiblingDeferralWrite(existing, record)) {
    return false;
  }
  atomicAppend(siblingDeferralFilePath(targetPath, record.at), JSON.stringify(record) + '\n');
  return true;
}
