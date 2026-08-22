// BL-819: pure core for the coordinator-owned ticket lifecycle ledger - the
// event shape, its idempotency natural key, and the per-ticket snapshot
// fold. Every event is COMPOSED from an instrument that already ships
// (extension/src/metrics/leanLedgerCompose.ts); this module never touches
// fs (dependency-cruiser's no-io-from-policy rule for src/quality/) and
// never invents a field - `source` names which existing instrument
// produced the event, and `data`'s keys are restricted to that instrument's
// own closed field list (KNOWN_LEAN_LEDGER_DATA_KEYS), so an event can
// never smuggle in a computed/narrated field under an innocuous-looking key.
// Mirrors qaBounce.ts's closed-set-vocabulary + natural-key + pure-fold
// shape, one level up (composing across five instruments, not one JSONL log).

export const KNOWN_LEAN_LEDGER_SOURCES = ['stage-dwell', 'bounce-store', 'routing-skip-log', 'chaser-telemetry', 'backlog-close'] as const;
export type LeanLedgerSource = (typeof KNOWN_LEAN_LEDGER_SOURCES)[number];

export const KNOWN_LEAN_LEDGER_EVENT_TYPES = ['stage_transition', 'bounce', 'stage_skip', 'stall', 'close'] as const;
export type LeanLedgerEventType = (typeof KNOWN_LEAN_LEDGER_EVENT_TYPES)[number];

function isKnownValue<T extends string>(known: readonly T[], value: string): value is T {
  return (known as readonly string[]).includes(value);
}

export function isKnownLeanLedgerSource(value: string): value is LeanLedgerSource {
  return isKnownValue(KNOWN_LEAN_LEDGER_SOURCES, value);
}

export function isKnownLeanLedgerEventType(value: string): value is LeanLedgerEventType {
  return isKnownValue(KNOWN_LEAN_LEDGER_EVENT_TYPES, value);
}

export type LeanLedgerDataValue = string | number | null;

export interface LeanLedgerEvent {
  ticket: string;
  type: LeanLedgerEventType;
  source: LeanLedgerSource;
  at: string; // ISO 8601 - copied verbatim from the source instrument, never generated at compose time
  role?: string; // the pipeline role this event concerns, when the instrument names one
  data: Record<string, LeanLedgerDataValue>;
}

// Invariant 2's enforceable half: a closed data-key allow-list PER SOURCE.
// An event whose `data` carries a key outside its own source's list fails
// shape validation - the same "never a passthrough" discipline qaBounce.ts's
// KNOWN_* closed sets already establish elsewhere in this file family. The
// "never narrated by an LLM" clause is not independently machine-checkable;
// it is enforced by leanLedgerCompose.ts's own discipline (every value is a
// direct field read off an already-persisted record, never template/model
// text) and by this allow-list rejecting anything that isn't.
export const KNOWN_LEAN_LEDGER_DATA_KEYS: Record<LeanLedgerSource, readonly string[]> = {
  'stage-dwell': ['queueWaitMs', 'processingMs'],
  'bounce-store': ['by', 'blamedRole', 'failureClass', 'commit', 'evidence'],
  'routing-skip-log': ['reason'],
  'chaser-telemetry': ['eventType', 'count'],
  'backlog-close': ['folder', 'commit'],
};

function hasLeanLedgerEventBaseShape(event: Partial<LeanLedgerEvent>): boolean {
  return (
    typeof event.ticket === 'string' &&
    typeof event.type === 'string' &&
    typeof event.source === 'string' &&
    typeof event.at === 'string' &&
    typeof event.data === 'object' &&
    event.data !== null
  );
}

export function hasLeanLedgerEventShape(event: Partial<LeanLedgerEvent>): event is LeanLedgerEvent {
  if (!hasLeanLedgerEventBaseShape(event)) {
    return false;
  }
  const { type, source, data } = event as LeanLedgerEvent;
  if (!isKnownLeanLedgerEventType(type) || !isKnownLeanLedgerSource(source)) {
    return false;
  }
  const allowedKeys = KNOWN_LEAN_LEDGER_DATA_KEYS[source];
  return Object.keys(data).every((key) => allowedKeys.includes(key));
}

// Idempotency natural key (invariant 1): every field of a composed event is
// itself a verbatim copy of an already-fixed instrument fact (a handoff's
// own completed_at, a bounce record's own at/commit, ...) - never "now" -
// so two composition runs over the same underlying state produce a
// byte-identical event. The FULL event (data keys sorted for stable
// ordering) is therefore the correct natural key: nothing about a
// legitimate re-run can produce a "same real-world fact, different key" pair.
export function leanLedgerEventNaturalKey(event: LeanLedgerEvent): string {
  const dataKeys = Object.keys(event.data).sort();
  const dataPart = dataKeys.map((k) => `${k}=${event.data[k]}`).join(',');
  return `${event.ticket}|${event.type}|${event.source}|${event.role ?? ''}|${event.at}|${dataPart}`;
}

export function hasLeanLedgerEvent(existing: LeanLedgerEvent[], candidate: LeanLedgerEvent): boolean {
  const key = leanLedgerEventNaturalKey(candidate);
  return existing.some((e) => leanLedgerEventNaturalKey(e) === key);
}

// ── per-ticket snapshot: a PURE fold over that ticket's own events ────────

export interface LeanLedgerStageDwell {
  role: string;
  queueWaitMs: number | null;
  processingMs: number;
  at: string;
}

export interface LeanLedgerBounce {
  at: string;
  by?: string;
  blamedRole?: string;
  failureClass?: string;
  commit?: string;
  evidence?: string;
}

export interface LeanLedgerStageSkip {
  role: string;
  reason: string;
  at: string;
}

export interface LeanLedgerStall {
  role: string;
  eventType: string;
  count: number | null;
  at: string;
}

export interface LeanLedgerSnapshot {
  ticket: string;
  stagesEntered: string[]; // roles, in first-seen order, deduped
  dwell: LeanLedgerStageDwell[];
  bounceCount: number;
  bounces: LeanLedgerBounce[];
  skips: LeanLedgerStageSkip[];
  stalls: LeanLedgerStall[];
  closed: boolean;
  closedAt: string | null;
}

function emptySnapshot(ticket: string): LeanLedgerSnapshot {
  return { ticket, stagesEntered: [], dwell: [], bounceCount: 0, bounces: [], skips: [], stalls: [], closed: false, closedAt: null };
}

function num(value: LeanLedgerDataValue | undefined): number | null {
  return typeof value === 'number' ? value : null;
}

function str(value: LeanLedgerDataValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// A stage pass is composed as two raw events (entry marker, exit marker -
// see composeStageTransitionEvents) but folds into ONE dwell record, kept
// on the exit event alone (the only one carrying processingMs) so the
// snapshot's `dwell` array stays one-entry-per-pass. An entry marker still
// registers its role in `stagesEntered` but contributes no dwell record on
// its own - the pass isn't "dwelt" until it has exited.
function foldStageTransition(snapshot: LeanLedgerSnapshot, event: LeanLedgerEvent): LeanLedgerSnapshot {
  const role = event.role ?? 'unknown';
  const stagesEntered = snapshot.stagesEntered.includes(role) ? snapshot.stagesEntered : [...snapshot.stagesEntered, role];
  if (!('processingMs' in event.data)) {
    return { ...snapshot, stagesEntered };
  }
  const dwell: LeanLedgerStageDwell[] = [...snapshot.dwell, { role, queueWaitMs: num(event.data.queueWaitMs), processingMs: num(event.data.processingMs) ?? 0, at: event.at }];
  return { ...snapshot, stagesEntered, dwell };
}

function foldBounce(snapshot: LeanLedgerSnapshot, event: LeanLedgerEvent): LeanLedgerSnapshot {
  const bounces: LeanLedgerBounce[] = [
    ...snapshot.bounces,
    { at: event.at, by: str(event.data.by), blamedRole: str(event.data.blamedRole), failureClass: str(event.data.failureClass), commit: str(event.data.commit), evidence: str(event.data.evidence) },
  ];
  return { ...snapshot, bounces, bounceCount: bounces.length };
}

function foldStageSkip(snapshot: LeanLedgerSnapshot, event: LeanLedgerEvent): LeanLedgerSnapshot {
  const skips: LeanLedgerStageSkip[] = [...snapshot.skips, { role: event.role ?? 'unknown', reason: str(event.data.reason) ?? '', at: event.at }];
  return { ...snapshot, skips };
}

function foldStall(snapshot: LeanLedgerSnapshot, event: LeanLedgerEvent): LeanLedgerSnapshot {
  const stalls: LeanLedgerStall[] = [...snapshot.stalls, { role: event.role ?? 'unknown', eventType: str(event.data.eventType) ?? '', count: num(event.data.count), at: event.at }];
  return { ...snapshot, stalls };
}

// Split per event type so each branch, and the dispatcher itself, stays
// under the project's CRAP<=6 gate (mirrors deriveOneDwellRecord's own
// split rationale in stageDwell.ts).
function foldOneEvent(snapshot: LeanLedgerSnapshot, event: LeanLedgerEvent): LeanLedgerSnapshot {
  switch (event.type) {
    case 'stage_transition':
      return foldStageTransition(snapshot, event);
    case 'bounce':
      return foldBounce(snapshot, event);
    case 'stage_skip':
      return foldStageSkip(snapshot, event);
    case 'stall':
      return foldStall(snapshot, event);
    case 'close':
      return { ...snapshot, closed: true, closedAt: event.at };
    default:
      return snapshot;
  }
}

// Backfills a stage-entry event's queueWaitMs onto its matching stage-exit
// event (same role, next such pair in chronological order), so
// foldStageTransition can still build ONE combined dwell record per pass -
// mirrors the single value composeStageTransitionEvents derived before
// splitting it across the entry/exit pair. Pure list transform; no event is
// added, removed, or reordered, only the exit event's `data` gains a key
// its own source's allow-list already permits.
function backfillQueueWaitOntoExit(events: LeanLedgerEvent[]): LeanLedgerEvent[] {
  const pendingQueueWaitByRole: Record<string, LeanLedgerDataValue> = {};
  return events.map((event) => {
    if (event.type !== 'stage_transition') {
      return event;
    }
    const role = event.role ?? 'unknown';
    if (!('processingMs' in event.data)) {
      pendingQueueWaitByRole[role] = event.data.queueWaitMs ?? null;
      return event;
    }
    if (!(role in pendingQueueWaitByRole)) {
      return event;
    }
    const queueWaitMs = pendingQueueWaitByRole[role];
    delete pendingQueueWaitByRole[role];
    return { ...event, data: { ...event.data, queueWaitMs } };
  });
}

// Invariant 1's other half: the per-ticket snapshot is ALWAYS a pure fold
// of the ticket's own events, sorted by `at` (a re-run over the same event
// set, in any order, produces the same snapshot) - never an independently
// written second source of truth.
export function foldLeanLedgerSnapshot(ticket: string, events: LeanLedgerEvent[]): LeanLedgerSnapshot {
  const ticketEvents = events.filter((e) => e.ticket === ticket).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return backfillQueueWaitOntoExit(ticketEvents).reduce(foldOneEvent, emptySnapshot(ticket));
}
