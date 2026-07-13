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

// BL-322: derived straight from the ticket YAML already on disk (title,
// notes: block scalar, first acceptance.steps entry) - never a new schema
// field. diffTaskStarted below reads this to populate a TaskStarted
// event's payload; messageTextForEvent (topicRouter.ts) is the one place
// that actually composes/truncates the rendered summary text.
export interface TicketSummary {
  title: string;
  notes?: string;
  firstAcceptanceStep?: string;
}

export interface EventStreamSnapshot {
  backlog: BacklogFolderSnapshot;
  gates: GateSignal[];
  // The BL-### each role is currently holding (the parcel/handoff task ->
  // BL-### mapping, e.g. derived from computeCurrentHolders). A role absent
  // here has no resolvable ticket, so its gate signal is dropped rather
  // than emitted untagged.
  roleTicket: Record<string, string>;
  // BL-322: every ACTIVE ticket's derived summary (TaskStarted only ever
  // fires for an id entering backlog.active, so only active tickets need
  // an entry). An id absent here (should not happen within one tick, but
  // never a crash over a degraded topic opener) falls back to just the id
  // in diffTaskStarted below.
  ticketSummaries: Record<string, TicketSummary>;
}

export type SwarmEventType = 'TaskStarted' | 'NeedsApproval' | 'TaskCompleted';

export interface SwarmEvent {
  type: SwarmEventType;
  // BL-358: null for a NeedsApproval whose gated role holds no ticket right
  // now (an "untagged gate") - TaskStarted/TaskCompleted and a tagged
  // NeedsApproval always carry a real ticket id. Never guessed at a ticket;
  // routing an untagged event to a real destination (the standing Operator
  // topic) is topicRouter.ts's job, not this module's.
  backlogId: string | null;
  // Present only alongside backlogId: null - identifies WHICH role's
  // question this is, since backlogId (the stream's usual identity) can't.
  // Omitted entirely (not even as undefined) for every tagged event, so it
  // never appears as a stray key on the common case (typed-events-02's own
  // "names only its type and backlog item" contract).
  role?: string;
  payload: Record<string, unknown>;
}

function emptySnapshot(): EventStreamSnapshot {
  return { backlog: { active: [], paused: [], done: [] }, gates: [], roleTicket: {}, ticketSummaries: {} };
}

// BL-322: {} degrades to messageTextForEvent's own title-only fallback -
// an id somehow missing from ticketSummaries (should not happen within
// one tick) is never a crash, just a plainer topic opener.
function taskStartedPayload(summary: TicketSummary | undefined): Record<string, unknown> {
  return summary ? { ...summary } : {};
}

function diffTaskStarted(prev: EventStreamSnapshot, curr: EventStreamSnapshot): SwarmEvent[] {
  const prevActive = new Set(prev.backlog.active);
  return curr.backlog.active
    .filter((id) => !prevActive.has(id))
    .map((id): SwarmEvent => ({ type: 'TaskStarted', backlogId: id, payload: taskStartedPayload(curr.ticketSummaries[id]) }));
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

// BL-358: a gate for a role holding no ticket used to be dropped entirely
// here (there was nowhere untagged to send it). It now still emits -
// backlogId: null, role identifying WHO is asking - so the question reaches
// the human via the standing Operator topic (topicRouter.ts) instead of
// vanishing into a tmux pane nobody is watching.
function needsApprovalEvent(role: string, backlogId: string | undefined, snippet: string | undefined): SwarmEvent {
  const payload = needsApprovalPayload(snippet);
  return backlogId ? { type: 'NeedsApproval', backlogId, payload } : { type: 'NeedsApproval', backlogId: null, role, payload };
}

function diffNeedsApproval(prev: EventStreamSnapshot, curr: EventStreamSnapshot): SwarmEvent[] {
  const wasGatedByRole = new Map(prev.gates.map((g) => [g.role, g.gated]));
  const events: SwarmEvent[] = [];
  for (const gate of curr.gates) {
    const wasGated = wasGatedByRole.get(gate.role) ?? false;
    if (gate.gated && !wasGated) {
      events.push(needsApprovalEvent(gate.role, curr.roleTicket[gate.role], gate.snippet));
    }
  }
  return events;
}

// A stable identity for dedup - two derivations that both notice the same
// (type, backlogId) transition must agree this is "the same event." An
// untagged event (backlogId: null) keys by role instead (BL-358) - still
// stable, still unique per (type, role), so an untagged gate that stays
// captured across ticks dedupes exactly like a tagged one does.
export function swarmEventKey(event: SwarmEvent): string {
  return `${event.type}:${event.backlogId ?? `role:${event.role}`}`;
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
