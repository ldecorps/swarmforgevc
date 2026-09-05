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

// BL-1119: per-role quality dial recommendations (slice 1 — recommend only;
// never rewrite pack conf). raise = next shift should run hotter effort;
// lower = role worked well, cheaper/faster is fine; hold = no clear signal.
export const KNOWN_QUALITY_DIALS = ['raise', 'lower', 'hold'] as const;
export type QualityDial = (typeof KNOWN_QUALITY_DIALS)[number];

export const KNOWN_QUALITY_DISPOSITIONS = ['recommended', 'refused', 'held'] as const;
export type QualityDisposition = (typeof KNOWN_QUALITY_DISPOSITIONS)[number];

// Human decision 7: "tentative" ceremony adjustments must be reversible
// FROM THE RECORD ALONE - either a ticket id (grep it, revert its
// promotion) or a note pointer (find it, act on it) - never a silent edit.
export const KNOWN_CEREMONY_RECORD_FORMS = ['ticket', 'note'] as const;
export type CeremonyRecordForm = (typeof KNOWN_CEREMONY_RECORD_FORMS)[number];

// Shared by closingCeremonyAdjustmentArgs.ts and closingCeremonyOutcomeArgs.ts
// (both validate a `--shift yyyy-MM-dd` flag) so the pattern and its check
// live in exactly one place.
const SHIFT_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidShiftKey(value: string | undefined): value is string {
  return !!value && SHIFT_KEY_PATTERN.test(value);
}

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

export interface CeremonyQualityRecommendation {
  role: string;
  dial: QualityDial;
  /** Lean ledger field names that drove the dial (BL-819/820 only). */
  citedFields: string[];
  disposition: QualityDisposition;
}

/**
 * BL-1365: one hand-made ritual the ledger offers for the specifier to judge.
 * Evidence for a ticket, never a ticket — invariant 3 keeps the minting
 * judgement where it already lives.
 */
export interface CeremonyDeterminismCandidate {
  ritualClass: string;
  label: string;
  commits: number;
  distinctSubjects: number;
  dominance: number;
  topSubject: string;
  topSubjectCount: number;
}

export interface CeremonyPacket {
  shiftKey: string;
  pathTaken: string[];
  dwellHotspots: CeremonyDwellHotspot[];
  bounceClasses: CeremonyBounceClass[];
  skipReasons: string[];
  stalls: CeremonyStallSummary[];
  hypotheses: string[];
  qualityRecommendations: CeremonyQualityRecommendation[];
  /**
   * BL-1365: computed OUTSIDE the ceremony on the ledger's own cadence and
   * merely read here (invariant 1), so a ceremony that never runs delays
   * adjudication and loses no measurement.
   */
  determinismCandidates: CeremonyDeterminismCandidate[];
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

type HypothesisParts = Pick<CeremonyPacket, 'pathTaken' | 'dwellHotspots' | 'bounceClasses' | 'skipReasons' | 'stalls'>;

function primaryHypotheses(parts: HypothesisParts): string[] {
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
  return hyps;
}

// Fallback so ANY non-empty shift still carries at least one hypothesis
// (scenario "between one and three concrete process hypotheses") even
// when the only signal is skips or plain stage traversal.
function fallbackHypotheses(parts: HypothesisParts): string[] {
  if (parts.skipReasons.length > 0) {
    return [`${parts.skipReasons.length} distinct stage-skip reason(s) recorded this shift.`];
  }
  if (parts.pathTaken.length > 0) {
    return [`${parts.pathTaken.length} stage(s) traversed this shift with no bounces or stalls recorded.`];
  }
  return [];
}

function buildHypotheses(parts: HypothesisParts): string[] {
  const primary = primaryHypotheses(parts);
  const hyps = primary.length > 0 ? primary : fallbackHypotheses(parts);
  return hyps.slice(0, 3);
}

function computePathTaken(events: LeanLedgerEvent[]): string[] {
  return firstSeenOrder(events.filter((e) => e.type === 'stage_transition' && e.role).map((e) => e.role as string));
}

interface OccupancyInterval {
  startMs: number;
  endMs: number;
}

// BL-923: a stage-transition exit event's own window is [at - processingMs,
// at] - correct per parcel (invariant 2: the event itself is never touched).
// null when `at` doesn't parse, which the aggregation below treats as "no
// occupancy contribution" rather than crashing.
function eventOccupancyInterval(e: LeanLedgerEvent): OccupancyInterval | null {
  if (e.type !== 'stage_transition' || !e.role || typeof e.data.processingMs !== 'number') {
    return null;
  }
  const endMs = Date.parse(e.at);
  if (Number.isNaN(endMs)) {
    return null;
  }
  return { startMs: endMs - e.data.processingMs, endMs };
}

// The fold that actually fixes the defect: a role's dwell is the UNION of
// its occupancy intervals, not their sum. Two batch parcels sharing (or
// overlapping) a window contribute that window once; disjoint windows still
// add normally. No knowledge of which roles are "batch roles" is needed -
// this is what invariant 1's "any role that later becomes a batch role"
// clause asks for.
function sumOccupiedMs(intervals: OccupancyInterval[]): number {
  const ordered = [...intervals].sort((a, b) => a.startMs - b.startMs);
  let totalMs = 0;
  let mergedStart: number | null = null;
  let mergedEnd: number | null = null;
  for (const { startMs, endMs } of ordered) {
    if (mergedEnd === null) {
      mergedStart = startMs;
      mergedEnd = endMs;
    } else if (startMs <= mergedEnd) {
      mergedEnd = Math.max(mergedEnd, endMs);
    } else {
      totalMs += mergedEnd - (mergedStart as number);
      mergedStart = startMs;
      mergedEnd = endMs;
    }
  }
  if (mergedEnd !== null) {
    totalMs += mergedEnd - (mergedStart as number);
  }
  return totalMs;
}

function computeDwellHotspots(events: LeanLedgerEvent[]): CeremonyDwellHotspot[] {
  const intervalsByRole = new Map<string, OccupancyInterval[]>();
  for (const e of events) {
    const interval = eventOccupancyInterval(e);
    if (!interval) {
      continue;
    }
    const role = e.role as string;
    const intervals = intervalsByRole.get(role);
    if (intervals) {
      intervals.push(interval);
    } else {
      intervalsByRole.set(role, [interval]);
    }
  }
  return [...intervalsByRole.entries()]
    .map(([role, intervals]) => ({ role, totalMs: sumOccupiedMs(intervals) }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

function computeBounceClasses(events: LeanLedgerEvent[]): CeremonyBounceClass[] {
  const bounceCounts = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'bounce' && typeof e.data.failureClass === 'string') {
      bounceCounts.set(e.data.failureClass, (bounceCounts.get(e.data.failureClass) ?? 0) + 1);
    }
  }
  return [...bounceCounts.entries()].map(([failureClass, count]) => ({ failureClass, count })).sort((a, b) => b.count - a.count);
}

function computeSkipReasons(events: LeanLedgerEvent[]): string[] {
  return firstSeenOrder(events.filter((e) => e.type === 'stage_skip' && typeof e.data.reason === 'string').map((e) => e.data.reason as string));
}

function computeStalls(events: LeanLedgerEvent[]): CeremonyStallSummary[] {
  const stallCounts = new Map<string, CeremonyStallSummary>();
  for (const e of events) {
    if (e.type === 'stall' && e.role && typeof e.data.eventType === 'string') {
      const key = `${e.role}|${e.data.eventType}`;
      const existing = stallCounts.get(key);
      stallCounts.set(key, { role: e.role, eventType: e.data.eventType, count: (existing?.count ?? 0) + 1 });
    }
  }
  return [...stallCounts.values()];
}

function addCited(map: Map<string, Set<string>>, role: string, field: string): void {
  const set = map.get(role);
  if (set) {
    set.add(field);
  } else {
    map.set(role, new Set([field]));
  }
}

function bounceBlamedRole(e: LeanLedgerEvent): string | null {
  if (e.type !== 'bounce') {
    return null;
  }
  if (typeof e.data.blamedRole === 'string' && e.data.blamedRole.length > 0) {
    return e.data.blamedRole;
  }
  return e.role ?? null;
}

// BL-1119: well → lower; rework → raise; auto window models → hold only.

/** True for provider-auto window models (auto, cursor/auto, copilot/auto, …). */
export function isAutoWindowModel(model: string | undefined | null): boolean {
  if (!model) {
    return false;
  }
  const m = model.trim().toLowerCase();
  return m === 'auto' || m.endsWith('/auto');
}

/** Lean ledger field names the dial may cite (BL-819/820 only — invariant 2). */
export const KNOWN_QUALITY_CITED_FIELDS = ['stalls', 'bounce.blamedRole', 'stage_transition'] as const;

/**
 * Parse pack conf `window <role> … --model <id>` lines into role → model.
 * Lines without `--model` are omitted (caller treats missing as non-auto).
 */
export function parseWindowModelsFromConf(confContent: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of confContent.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('window ')) {
      continue;
    }
    const role = line.split(/\s+/)[1];
    const modelMatch = line.match(/--model(?:=|\s+)(\S+)/);
    if (role && modelMatch) {
      out[role] = modelMatch[1];
    }
  }
  return out;
}

function dialForRole(
  role: string,
  reworkFields: Set<string> | undefined,
  windowModels: Record<string, string>
): CeremonyQualityRecommendation {
  const citedFromRework = reworkFields ? [...reworkFields].sort() : [];
  if (isAutoWindowModel(windowModels[role])) {
    return { role, dial: 'hold', citedFields: citedFromRework, disposition: 'held' };
  }
  if (reworkFields) {
    return { role, dial: 'raise', citedFields: citedFromRework, disposition: 'recommended' };
  }
  return { role, dial: 'lower', citedFields: ['stage_transition'], disposition: 'recommended' };
}

/** Accumulate rework cites + active roles from lean events (keeps dial CC low). */
function collectReworkAndActive(events: LeanLedgerEvent[]): {
  rework: Map<string, Set<string>>;
  activeRoles: Set<string>;
} {
  const rework = new Map<string, Set<string>>();
  const activeRoles = new Set<string>();
  for (const e of events) {
    noteReworkEvent(rework, activeRoles, e);
  }
  return { rework, activeRoles };
}

function noteStallCite(rework: Map<string, Set<string>>, e: LeanLedgerEvent): void {
  if (e.type === 'stall' && e.role) {
    addCited(rework, e.role, 'stalls');
  }
}

function noteBounceCite(rework: Map<string, Set<string>>, e: LeanLedgerEvent): void {
  const blamed = bounceBlamedRole(e);
  if (blamed) {
    addCited(rework, blamed, 'bounce.blamedRole');
  }
}

function noteActiveRole(activeRoles: Set<string>, e: LeanLedgerEvent): void {
  if (!e.role) {
    return;
  }
  if (e.type === 'stage_transition' || e.type === 'close') {
    activeRoles.add(e.role);
  }
}

function noteReworkEvent(
  rework: Map<string, Set<string>>,
  activeRoles: Set<string>,
  e: LeanLedgerEvent
): void {
  noteStallCite(rework, e);
  noteBounceCite(rework, e);
  noteActiveRole(activeRoles, e);
}

function computeQualityRecommendations(
  events: LeanLedgerEvent[],
  windowModels: Record<string, string> = {}
): CeremonyQualityRecommendation[] {
  const { rework, activeRoles } = collectReworkAndActive(events);
  const roles = new Set<string>([...rework.keys(), ...activeRoles]);
  // Auto seats with only lean signal still get a hold row when they appear in rework/active.
  const out: CeremonyQualityRecommendation[] = [];
  for (const role of roles) {
    out.push(dialForRole(role, rework.get(role), windowModels));
  }
  return out.sort((a, b) => a.role.localeCompare(b.role));
}

export function markQualityRecommendationsRefused(packet: CeremonyPacket): CeremonyPacket {
  if (packet.qualityRecommendations.length === 0) {
    return packet;
  }
  return {
    ...packet,
    qualityRecommendations: packet.qualityRecommendations.map((r) => ({
      ...r,
      disposition: 'refused' as const,
    })),
  };
}

export function buildClosingCeremonyPacket(
  shiftKey: string,
  allEvents: LeanLedgerEvent[],
  windowModels: Record<string, string> = {},
  // BL-1365: passed IN, never computed here - the ceremony reads the ledger's
  // current state (invariant 1). Defaulted so every existing caller is
  // unchanged and a packet without a ledger is simply candidate-free.
  determinismCandidates: CeremonyDeterminismCandidate[] = []
): CeremonyPacket {
  const events = eventsForShiftKey(allEvents, shiftKey);

  const pathTaken = computePathTaken(events);
  const dwellHotspots = computeDwellHotspots(events);
  const bounceClasses = computeBounceClasses(events);
  const skipReasons = computeSkipReasons(events);
  const stalls = computeStalls(events);
  const hypotheses = buildHypotheses({ pathTaken, dwellHotspots, bounceClasses, skipReasons, stalls });
  const qualityRecommendations = computeQualityRecommendations(events, windowModels);

  return {
    shiftKey,
    pathTaken,
    dwellHotspots,
    bounceClasses,
    skipReasons,
    stalls,
    hypotheses,
    qualityRecommendations,
    determinismCandidates,
  };
}

export function isEmptyCeremonyPacket(packet: CeremonyPacket): boolean {
  return (
    packet.pathTaken.length === 0 &&
    packet.dwellHotspots.length === 0 &&
    packet.bounceClasses.length === 0 &&
    packet.skipReasons.length === 0 &&
    packet.stalls.length === 0 &&
    // BL-1365: a shift whose ONLY finding is a determinism candidate is not an
    // empty shift. Without this the auto-no_change path would swallow the
    // candidate and the specifier would never see it - the packet would have
    // been computed, stored, and delivered to nobody.
    packet.determinismCandidates.length === 0
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

// process_ticket/spec_gate_tweak must carry a non-empty ref; no_change
// carries none because there is nothing to reverse - "a reasoned no-change
// is a success" (human decision 4), not a change that needs undoing.
function isValidOutcomeRef(outcomeType: CeremonyOutcomeType, ref: unknown): boolean {
  if (outcomeType === 'no_change') {
    return ref === null || ref === undefined;
  }
  return typeof ref === 'string' && ref.length > 0;
}

// A recorded outcome is reversible-from-the-record-alone (human decision 7)
// whenever it names a concrete change.
export function isValidCeremonyOutcome(candidate: Partial<CeremonyOutcome>): candidate is CeremonyOutcome {
  if (typeof candidate.type !== 'string' || !isKnownCeremonyOutcomeType(candidate.type)) {
    return false;
  }
  if (typeof candidate.recordedAt !== 'string' || !candidate.recordedAt) {
    return false;
  }
  return isValidOutcomeRef(candidate.type, candidate.ref);
}

function isValidReversibleRecord(record: unknown): record is CeremonyReversibleRecord {
  if (!record || typeof record !== 'object') {
    return false;
  }
  const r = record as Partial<CeremonyReversibleRecord>;
  if (typeof r.form !== 'string' || !isKnownCeremonyRecordForm(r.form)) {
    return false;
  }
  return typeof r.ref === 'string' && r.ref.length > 0;
}

function isValidAdjustmentKind(kind: unknown): boolean {
  return typeof kind === 'string' && isKnownCeremonyAdjustmentKind(kind);
}

export function isValidCeremonyAdjustment(candidate: Partial<CeremonyAdjustment>): candidate is CeremonyAdjustment {
  if (!isValidAdjustmentKind(candidate.kind)) {
    return false;
  }
  if (typeof candidate.detail !== 'string' || !candidate.detail) {
    return false;
  }
  if (typeof candidate.recordedAt !== 'string' || !candidate.recordedAt) {
    return false;
  }
  return isValidReversibleRecord(candidate.record);
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
