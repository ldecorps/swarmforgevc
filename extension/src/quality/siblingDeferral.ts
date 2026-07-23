// BL-532 (BL-512 audit BL-FIX-005): a batch role legitimately produces one
// commit that satisfies several tickets (Article 2.6). When that commit
// carries one ticket's failing check, every OTHER ticket riding the same
// tree used to be re-queued for rework it did not need - the same bounce
// paid twice, and a producing role charged in the BL-454 tally for a defect
// it never introduced. This module is the pure decision surface: the record
// shape, `failureSignature`, the latest-record-wins reduction from a record
// list to a ticket's open blockers, and `decideDisposition`. No I/O - the
// impure store (siblingDeferralStore.ts) depends on this module, not the
// other way around, and `.dependency-cruiser.cjs`'s no-io-from-policy rule
// forbids fs imports here, exactly as it already does for qaBounce.ts, this
// module's sibling and vocabulary source.
import { isKnownFailureClass, QaBounceFailureClass } from './qaBounce';

// hardener note: the compiled re-export of `isKnownFailureClass` below emits
// `Object.defineProperty(exports, ..., { enumerable: true, ... })`. A Stryker
// mutant flips `enumerable` to false; it's an accepted-equivalent, not a real
// survivor - nothing in this codebase enumerates the module's own exports
// object (every caller destructures the named export directly), so the flag
// is unobservable through any test (BL-234 precedent).
export { isKnownFailureClass, QaBounceFailureClass };

export type SiblingDeferralAction = 'defer' | 'clear';

export interface SiblingDeferralRecord {
  ticket: string;
  blockedBy: string;
  action: SiblingDeferralAction;
  // Present for 'defer' records; absent for 'clear' (clearing names only
  // the pair being cleared, not a fresh failure signature).
  failureClass?: QaBounceFailureClass;
  check?: string;
  commit: string;
  at: string; // ISO 8601 timestamp
}

// Two failures are the same failure when their signature matches. Trim plus
// collapse internal whitespace runs to one space - fixed-string equality, no
// regex, no fuzzy matching (specifier decision 3: prose/error-excerpt
// matching varies between runs and fails open silently; a command is what QA
// already records verbatim in evidence field 1).
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

export function failureSignature(failureClass: string, command: string): string {
  return `${failureClass}::${normalizeCommand(command)}`;
}

// Idempotency key: ticket + blockedBy + action + the DATE portion of `at` +
// failure class - the same posture as qaBounceNaturalKey (BL-454), extended
// with `blockedBy` (this module tracks a PAIR, not a single ticket) and
// `action` (a 'defer' and a 'clear' on the same pair/day are distinct events
// and must never collapse into each other).
export function siblingDeferralNaturalKey(
  record: Pick<SiblingDeferralRecord, 'ticket' | 'blockedBy' | 'action' | 'at'> & { failureClass?: string }
): string {
  const dateOnly = record.at.slice(0, 10);
  return `${record.ticket}|${record.blockedBy}|${record.action}|${dateOnly}|${record.failureClass ?? ''}`;
}

function pairKey(ticket: string, blockedBy: string): string {
  return `${ticket}|${blockedBy}`;
}

// Latest-record-wins reduction, shared by openBlockersForTicket and the
// store's idempotency check below: sort by `at` (stable - Array#sort is a
// stable sort per spec), then keep only the most recent record per
// (ticket, blockedBy) pair.
function latestRecordsByPair(records: SiblingDeferralRecord[]): Map<string, SiblingDeferralRecord> {
  const sorted = [...records].sort((a, b) => a.at.localeCompare(b.at));
  const latest = new Map<string, SiblingDeferralRecord>();
  for (const record of sorted) {
    latest.set(pairKey(record.ticket, record.blockedBy), record);
  }
  return latest;
}

export interface OpenBlocker {
  blockedBy: string;
  failureClass: QaBounceFailureClass;
  check: string;
  commit: string;
  at: string;
}

// A ticket may have several blockers (specifier decision 4): openness is
// keyed on the (ticket, blockedBy) PAIR, not the ticket, so clearing one
// blocker never silently releases a ticket still pending another. Returned
// in a stable order (by blocker ticket id) so a CLI's multi-line output is
// deterministic.
export function openBlockersForTicket(records: SiblingDeferralRecord[], ticket: string): OpenBlocker[] {
  const open: OpenBlocker[] = [];
  for (const record of latestRecordsByPair(records).values()) {
    if (record.ticket !== ticket) {
      continue;
    }
    if (record.action === 'defer' && record.failureClass && record.check) {
      open.push({ blockedBy: record.blockedBy, failureClass: record.failureClass, check: record.check, commit: record.commit, at: record.at });
    }
  }
  return open.sort((a, b) => a.blockedBy.localeCompare(b.blockedBy));
}

// A write is redundant - and must not be appended - only when it repeats the
// CURRENT state of its (ticket, blockedBy) pair (the latest record for that
// pair already has the same natural key). This is deliberately narrower than
// "matches any record ever written for the pair": a 'defer' -> 'clear' ->
// 'defer' sequence must leave the pair OPEN even when the first and third
// 'defer' share the same day and failure class, because the pair's state
// changed in between (the CLEAR is the latest record at that point, not the
// first defer).
export function isRedundantSiblingDeferralWrite(records: SiblingDeferralRecord[], candidate: SiblingDeferralRecord): boolean {
  const latest = latestRecordsByPair(records).get(pairKey(candidate.ticket, candidate.blockedBy));
  return !!latest && siblingDeferralNaturalKey(latest) === siblingDeferralNaturalKey(candidate);
}

export interface ObservedFailure {
  failureClass: string;
  check: string;
}

export type Disposition = { kind: 'verify' } | { kind: 'defer'; blockers: OpenBlocker[] } | { kind: 'bounce' };

// The core decision: no open blockers -> verify normally. Open blockers and
// no failing check of its own on this pass -> defer, naming every open
// blocker (repeat-arrival status report). Open blockers AND a failing check
// of its own -> the failure signature decides: a signature that matches an
// open blocker's own signature is still that blocker's failure (defer); any
// other signature is this ticket's OWN defect and bounces normally
// (specifier decision: an open deferral suppresses only the blocker's own
// failure signature, never any other).
export function decideDisposition(openBlockers: OpenBlocker[], observedFailure?: ObservedFailure | null): Disposition {
  if (openBlockers.length === 0) {
    return { kind: 'verify' };
  }
  if (!observedFailure) {
    return { kind: 'defer', blockers: openBlockers };
  }
  const signature = failureSignature(observedFailure.failureClass, observedFailure.check);
  const matching = openBlockers.filter((b) => failureSignature(b.failureClass, b.check) === signature);
  return matching.length > 0 ? { kind: 'defer', blockers: matching } : { kind: 'bounce' };
}
