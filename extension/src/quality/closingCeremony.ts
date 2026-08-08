// BL-820: pure core for the closing-ceremony lean pass. At shift close the
// coordinator folds BL-819's lifecycle ledger (leanLedger.ts) into a
// shift-scoped packet - never raw logs - and hands it to the specifier,
// who must end the pass in a recorded outcome. "A silent ceremony is a
// failed ceremony" (human decision 4): a ceremony run's own state machine
// (pending -> complete | failed) exists precisely so silence is detectable
// rather than indistinguishable from "never ran" - see the ticket's own
// declared invariant. Mirrors leanLedger.ts's shape: closed-vocabulary
// types, pure folds, no fs (extension/src/metrics/closingCeremonyStore.ts
// owns every read/write).
import { LeanLedgerEvent } from './leanLedger';

export const KNOWN_CEREMONY_OUTCOME_TYPES = ['process_ticket', 'spec_gate_tweak', 'no_change'] as const;
export type CeremonyOutcomeType = (typeof KNOWN_CEREMONY_OUTCOME_TYPES)[number];

export const KNOWN_CEREMONY_ADJUSTMENT_KINDS = ['promotion_order', 'throttle_posture'] as const;
export type CeremonyAdjustmentKind = (typeof KNOWN_CEREMONY_ADJUSTMENT_KINDS)[number];

// Human decision 7: "tentative" ceremony adjustments must be reversible
// FROM THE RECORD ALONE - either a ticket id (grep it, revert its
// promotion) or a note pointer (find it, act on it) - never a silent edit.
export const KNOWN_CEREMONY_RECORD_FORMS = ['ticket', 'note'] as const;
export type CeremonyRecordForm = (typeof KNOWN_CEREMONY_RECORD_FORMS)[number];

export interface CeremonyReversibleRecord {
  form: CeremonyRecordForm;
  ref: string;
}

export interface CeremonyOutcome {
  type: CeremonyOutcomeType;
  ref: string | null;
  recordedAt: string;
}

export interface CeremonyAdjustment {
  kind: CeremonyAdjustmentKind;
  detail: string;
  record: CeremonyReversibleRecord;
  recordedAt: string;
}

export interface CeremonyDwellHotspot {
  role: string;
  totalMs: number;
}

export interface CeremonyBounceClass {
  failureClass: string;
  count: number;
}

export interface CeremonyStallSummary {
  role: string;
  eventType: string;
  count: number;
}

export interface CeremonyPacket {
  shiftKey: string;
  pathTaken: string[];
  dwellHotspots: CeremonyDwellHotspot[];
  bounceClasses: CeremonyBounceClass[];
  skipReasons: string[];
  stalls: CeremonyStallSummary[];
  hypotheses: string[];
}

export interface CeremonyRun {
  shiftKey: string;
  packet: CeremonyPacket;
  deliveredAt: string;
  outcome: CeremonyOutcome | null;
  adjustments: CeremonyAdjustment[];
  failedAt: string | null;
}

// ── packet: a pure fold over one shift's worth of ledger events ───────────

// "Shift" is calendar-day bucketing, the same granularity
// leanLedgerStore.ts's own events are already bucketed at (see that file's
// header comment for why - no real shift boundary exists yet).
export function eventsForShiftKey(events: LeanLedgerEvent[], shiftKey: string): LeanLedgerEvent[] {
  return events.filter((e) => e.at.slice(0, 10) === shiftKey);
}

function firstSeenOrder(values: string[]): string[] {
  const seen: string[] = [];
  for (const v of values) {
    if (!seen.includes(v)) {
      seen.push(v);
    }
  }
  return seen;
}

function buildHypotheses(parts: Pick<CeremonyPacket, 'pathTaken' | 'dwellHotspots' | 'bounceClasses' | 'skipReasons' | 'stalls'>): string[] {
  const hyps: string[] = [];
  if (parts.dwellHotspots.length > 0) {
    const top = parts.dwellHotspots[0];
    hyps.push(`Longest dwell this shift: ${top.role} (${top.totalMs}ms) — investigate that stage's throughput.`);
  }
  if (parts.bounceClasses.length > 0) {
    const top = parts.bounceClasses[0];
    hyps.push(`${top.count} bounce(s) classed '${top.failureClass}' this shift — recurring failure class.`);
  }
  if (parts.stalls.length > 0) {
    const top = [...parts.stalls].sort((a, b) => b.count - a.count)[0];
    hyps.push(`${top.count} ${top.eventType}(s) in ${top.role} this shift — chase pattern.`);
  }
  // Fallbacks so ANY non-empty shift still carries at least one hypothesis
  // (scenario "between one and three concrete process hypotheses") even
  // when the only signal is skips or plain stage traversal.
  if (hyps.length === 0 && parts.skipReasons.length > 0) {
    hyps.push(`${parts.skipReasons.length} distinct stage-skip reason(s) recorded this shift.`);
  }
  if (hyps.length === 0 && parts.pathTaken.length > 0) {
    hyps.push(`${parts.pathTaken.length} stage(s) traversed this shift with no bounces or stalls recorded.`);
  }
  return hyps.slice(0, 3);
}

export function buildClosingCeremonyPacket(shiftKey: string, allEvents: LeanLedgerEvent[]): CeremonyPacket {
  const events = eventsForShiftKey(allEvents, shiftKey);

  const pathTaken = firstSeenOrder(events.filter((e) => e.type === 'stage_transition' && e.role).map((e) => e.role as string));

  const dwellByRole = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'stage_transition' && e.role && typeof e.data.processingMs === 'number') {
      dwellByRole.set(e.role, (dwellByRole.get(e.role) ?? 0) + e.data.processingMs);
    }
  }
  const dwellHotspots = [...dwellByRole.entries()].map(([role, totalMs]) => ({ role, totalMs })).sort((a, b) => b.totalMs - a.totalMs);

  const bounceCounts = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'bounce' && typeof e.data.failureClass === 'string') {
      bounceCounts.set(e.data.failureClass, (bounceCounts.get(e.data.failureClass) ?? 0) + 1);
    }
  }
  const bounceClasses = [...bounceCounts.entries()].map(([failureClass, count]) => ({ failureClass, count })).sort((a, b) => b.count - a.count);

  const skipReasons = firstSeenOrder(events.filter((e) => e.type === 'stage_skip' && typeof e.data.reason === 'string').map((e) => e.data.reason as string));

  const stallCounts = new Map<string, CeremonyStallSummary>();
  for (const e of events) {
    if (e.type === 'stall' && e.role && typeof e.data.eventType === 'string') {
      const key = `${e.role}|${e.data.eventType}`;
      const existing = stallCounts.get(key);
      stallCounts.set(key, { role: e.role, eventType: e.data.eventType, count: (existing?.count ?? 0) + 1 });
    }
  }
  const stalls = [...stallCounts.values()];

  const hypotheses = buildHypotheses({ pathTaken, dwellHotspots, bounceClasses, skipReasons, stalls });

  return { shiftKey, pathTaken, dwellHotspots, bounceClasses, skipReasons, stalls, hypotheses };
}

export function isEmptyCeremonyPacket(packet: CeremonyPacket): boolean {
  return (
    packet.pathTaken.length === 0 &&
    packet.dwellHotspots.length === 0 &&
    packet.bounceClasses.length === 0 &&
    packet.skipReasons.length === 0 &&
    packet.stalls.length === 0
  );
}

// ── outcome / adjustment validation (closed vocabulary + reversibility) ───

function isKnownValue<T extends string>(known: readonly T[], value: string): value is T {
  return (known as readonly string[]).includes(value);
}

export function isKnownCeremonyOutcomeType(value: string): value is CeremonyOutcomeType {
  return isKnownValue(KNOWN_CEREMONY_OUTCOME_TYPES, value);
}

export function isKnownCeremonyAdjustmentKind(value: string): value is CeremonyAdjustmentKind {
  return isKnownValue(KNOWN_CEREMONY_ADJUSTMENT_KINDS, value);
}

export function isKnownCeremonyRecordForm(value: string): value is CeremonyRecordForm {
  return isKnownValue(KNOWN_CEREMONY_RECORD_FORMS, value);
}

// A recorded outcome is reversible-from-the-record-alone (human decision 7)
// whenever it names a concrete change: process_ticket/spec_gate_tweak must
// carry a non-empty ref; no_change carries none because there is nothing to
// reverse - "a reasoned no-change is a success" (human decision 4), not a
// change that needs undoing.
export function isValidCeremonyOutcome(candidate: Partial<CeremonyOutcome>): candidate is CeremonyOutcome {
  if (typeof candidate.type !== 'string' || !isKnownCeremonyOutcomeType(candidate.type)) {
    return false;
  }
  if (typeof candidate.recordedAt !== 'string' || !candidate.recordedAt) {
    return false;
  }
  if (candidate.type === 'no_change') {
    return candidate.ref === null || candidate.ref === undefined;
  }
  return typeof candidate.ref === 'string' && candidate.ref.length > 0;
}

export function isValidCeremonyAdjustment(candidate: Partial<CeremonyAdjustment>): candidate is CeremonyAdjustment {
  if (typeof candidate.kind !== 'string' || !isKnownCeremonyAdjustmentKind(candidate.kind)) {
    return false;
  }
  if (typeof candidate.detail !== 'string' || !candidate.detail) {
    return false;
  }
  if (typeof candidate.recordedAt !== 'string' || !candidate.recordedAt) {
    return false;
  }
  const record = candidate.record;
  if (!record || typeof record !== 'object') {
    return false;
  }
  if (typeof record.form !== 'string' || !isKnownCeremonyRecordForm(record.form)) {
    return false;
  }
  return typeof record.ref === 'string' && record.ref.length > 0;
}

// ── run state: pending until an outcome lands, or finalized as failed ─────

export type CeremonyRunState = 'pending' | 'complete' | 'failed';

export function ceremonyRunState(run: CeremonyRun): CeremonyRunState {
  if (run.outcome) {
    return 'complete';
  }
  if (run.failedAt) {
    return 'failed';
  }
  return 'pending';
}

// ── delivery: pure note-draft builders (the I/O send is the store/CLI's) ──
// A `note`'s message is capped at 80 chars (HANDOFF-PROTOCOL.md) - the full
// packet lives in the durable run file; the note is only a pointer to it,
// the same "point at the evidence file, never copy its text" discipline
// leanLedgerCompose's bounce events already follow.

export function buildClosingCeremonyNoteDraft(to: string, packetRelativePath: string): string {
  return `type: note\nto: ${to}\npriority: 00\nmessage: Closing ceremony packet ready: ${packetRelativePath}\n`;
}

export function buildCeremonyFailureNoteDraft(to: string, shiftKey: string): string {
  return `type: note\nto: ${to}\npriority: 00\nmessage: Closing ceremony ${shiftKey} ended with NO outcome — FAILED\n`;
}
