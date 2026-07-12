// BL-296: the swarm<->Concierge CONTRACT. Derives a typed, BL-###-tagged,
// Telegram-AGNOSTIC event stream from swarm state snapshots - the swarm
// never knows Telegram exists; a later slice (BL-297) is solely responsible
// for turning these into Telegram messages. Mirrors notify/telegramNarrator's
// own diffNarrationEvents prev/curr snapshot-diff shape (one diff* function
// per event kind, each pure and independently testable), generalized to be
// per-BL-### instead of per-role and stripped of all Telegram formatting.
//
// This module must never import notify/telegram* code - see
// extension/test/swarmEventStream.test.js's own "stays Telegram-agnostic"
// check and the no-notify-from-events dependency-cruiser rule.

export interface BacklogFolderSnapshot {
  active: string[];
  paused: string[];
  done: string[];
}

export interface GateSignal {
  role: string;
  gated: boolean;
  // BL-325: the gated role's own question text (RoleGateState.snippet,
  // carried through readGates unnarrowed) - lets diffNeedsApproval below
  // put the actual question, not just a ticket id, into a NeedsApproval
  // event's payload.
  snippet?: string;
}

export interface EventStreamSnapshot {
  backlog: BacklogFolderSnapshot;
  gates: GateSignal[];
  // The BL-### each role is currently holding (the parcel/handoff task ->
  // BL-### mapping, e.g. derived from computeCurrentHolders). A role absent
  // here has no resolvable ticket, so its gate signal is dropped rather
  // than emitted untagged.
  roleTicket: Record<string, string>;
}

export type SwarmEventType = 'TaskStarted' | 'NeedsApproval' | 'TaskCompleted';

export interface SwarmEvent {
  type: SwarmEventType;
  backlogId: string;
  payload: Record<string, unknown>;
}

function emptySnapshot(): EventStreamSnapshot {
  return { backlog: { active: [], paused: [], done: [] }, gates: [], roleTicket: {} };
}

function diffTaskStarted(prev: EventStreamSnapshot, curr: EventStreamSnapshot): SwarmEvent[] {
  const prevActive = new Set(prev.backlog.active);
  return curr.backlog.active
    .filter((id) => !prevActive.has(id))
    .map((id): SwarmEvent => ({ type: 'TaskStarted', backlogId: id, payload: {} }));
}

function diffTaskCompleted(prev: EventStreamSnapshot, curr: EventStreamSnapshot): SwarmEvent[] {
  const prevDone = new Set(prev.backlog.done);
  return curr.backlog.done
    .filter((id) => !prevDone.has(id))
    .map((id): SwarmEvent => ({ type: 'TaskCompleted', backlogId: id, payload: {} }));
}

// BL-325: split out of diffNeedsApproval below so its own branch count
// stays at the pre-BL-325 level (cleaner review: this one ternary pushed
// diffNeedsApproval's CRAP over threshold even at 100% coverage - complexity
// alone, not a coverage gap).
function needsApprovalPayload(snippet: string | undefined): Record<string, unknown> {
  return snippet ? { snippet } : {};
}

function diffNeedsApproval(prev: EventStreamSnapshot, curr: EventStreamSnapshot): SwarmEvent[] {
  const wasGatedByRole = new Map(prev.gates.map((g) => [g.role, g.gated]));
  const events: SwarmEvent[] = [];
  for (const gate of curr.gates) {
    const wasGated = wasGatedByRole.get(gate.role) ?? false;
    if (gate.gated && !wasGated) {
      const backlogId = curr.roleTicket[gate.role];
      if (backlogId) {
        events.push({ type: 'NeedsApproval', backlogId, payload: needsApprovalPayload(gate.snippet) });
      }
    }
  }
  return events;
}

// A stable identity for dedup - two derivations that both notice the same
// (type, backlogId) transition must agree this is "the same event."
export function swarmEventKey(event: SwarmEvent): string {
  return `${event.type}:${event.backlogId}`;
}

// Pure: given the previously-seen snapshot (or null for a stream never
// derived before - treated as an empty baseline, same posture as
// diffNarrationEvents' own `prev?.field ?? []`) and the current snapshot,
// compute the NEW candidate events, then drop any whose stable identity is
// already in alreadyEmitted (the DURABLE dedup guard - prev/curr diffing
// alone is not restart-safe, since an in-memory prev snapshot is lost on
// restart while alreadyEmitted is expected to be persisted).
export function deriveSwarmEvents(
  prev: EventStreamSnapshot | null,
  curr: EventStreamSnapshot,
  alreadyEmitted: ReadonlySet<string> = new Set()
): SwarmEvent[] {
  const baseline = prev ?? emptySnapshot();
  const candidates = [...diffTaskStarted(baseline, curr), ...diffNeedsApproval(baseline, curr), ...diffTaskCompleted(baseline, curr)];
  return candidates.filter((event) => !alreadyEmitted.has(swarmEventKey(event)));
}
