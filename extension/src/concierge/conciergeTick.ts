// BL-300: slice 5 (RUNTIME WIRING) of the BL-295 Concierge refinement.
// BL-296 (derive), BL-297 (route), BL-299 (complete/close) are pure,
// tested, and DARK - nothing calls them. This module is the tick body: a
// live backlog-folders snapshot -> deriveSwarmEvents -> routeEvent per
// event, with DURABLE (restart-safe) dedup. Adapter-injected and
// Telegram-agnostic in its own imports (it composes topicRouter.ts's
// RouteAdapters, which is where Telegram-specific adapters actually get
// wired, in the live wrapper - telegram-front-desk-bot.ts).
import { EventStreamSnapshot, GateSignal, SwarmEventType, deriveSwarmEvents, swarmEventKey } from '../events/swarmEventStream';
import { RouteAdapters, routeEvent } from './topicRouter';

export interface BacklogFolderItem {
  id: string;
  title: string;
}

export interface BacklogFoldersSnapshot {
  active: BacklogFolderItem[];
  paused: BacklogFolderItem[];
  done: BacklogFolderItem[];
}

// Persisted across ticks (and restarts) - snapshot is the prev/curr diff's
// own baseline; emittedKeys is the DURABLE dedup guard deriveSwarmEvents'
// own docstring calls for (an in-memory prev alone is not restart-safe).
export interface TickState {
  snapshot: EventStreamSnapshot | null;
  emittedKeys: string[];
}

export interface ConciergeTickAdapters {
  readFolders: () => BacklogFoldersSnapshot;
  // BL-301: the live gate snapshot (computeRoleGateStatesLive, tmux-pane
  // capture) and the role->ticket inversion (computeCurrentHolders'
  // ticketId->role, inverted) - both wired live in the bot from targetPath,
  // same "core stays narrow, live wrapper adapts the real source" split as
  // readFolders.
  readGates: () => GateSignal[];
  readRoleTicket: () => Record<string, string>;
  readTickState: () => TickState;
  writeTickState: (state: TickState) => void;
  routeAdapters: RouteAdapters;
}

export interface TickResult {
  routed: number;
}

function toEventStreamSnapshot(folders: BacklogFoldersSnapshot, gates: GateSignal[], roleTicket: Record<string, string>): EventStreamSnapshot {
  return {
    backlog: {
      active: folders.active.map((item) => item.id),
      paused: folders.paused.map((item) => item.id),
      done: folders.done.map((item) => item.id),
    },
    gates,
    roleTicket,
  };
}

// A backlog item's title is looked up from the SAME folders snapshot the
// tick just read (routeEvent needs one per event; SwarmEvent itself
// carries no title, by BL-296's own Telegram-agnostic design). Falls back
// to the raw id if a ticket somehow vanished between deriving its event
// and looking up its title (should not happen within one tick, but never
// a crash over a cosmetic topic name).
function titleForBacklogId(folders: BacklogFoldersSnapshot, backlogId: string): string {
  const all = [...folders.active, ...folders.paused, ...folders.done];
  return all.find((item) => item.id === backlogId)?.title ?? backlogId;
}

// A failed-to-post event's backlogId is held back out of the PERSISTED
// snapshot's active/done list (never out of `curr` itself, which still
// reflects real backlog state) - so the next tick's prev/curr diff still
// sees that transition as pending and re-derives + retries it, instead of
// silently advancing past it forever. Only a SUCCESSFUL post may advance
// the persisted baseline past a given transition - mirrors the "only marks
// the SUCCESSFULLY posted ones as emitted" contract this module already
// keeps for emittedKeys, applied to the snapshot half of the same state.
//
// BL-301: RETRY SYMMETRY for NeedsApproval - a gate transition is keyed by
// ROLE (gates[].gated), not backlogId, so a failed NeedsApproval post
// instead reverts that role's OWN gate entry back to not-gated in the
// persisted snapshot (never in curr, which still reflects the swarm's real
// live gate state) - the next tick's diffNeedsApproval then sees the SAME
// false->true transition again. Resolved via curr.roleTicket (role's
// currently-held backlogId), the exact inversion diffNeedsApproval itself
// already used to tag the event that just failed to post.
function withRetryableTransitionsHeldBack(curr: EventStreamSnapshot, unrouted: ReadonlySet<string>): EventStreamSnapshot {
  if (unrouted.size === 0) {
    return curr;
  }
  const isUnrouted = (type: SwarmEventType, backlogId: string) => unrouted.has(swarmEventKey({ type, backlogId, payload: {} }));
  const gates = curr.gates.map((gate) => {
    const backlogId = curr.roleTicket[gate.role];
    return gate.gated && backlogId && isUnrouted('NeedsApproval', backlogId) ? { ...gate, gated: false } : gate;
  });
  return {
    ...curr,
    backlog: {
      ...curr.backlog,
      active: curr.backlog.active.filter((id) => !isUnrouted('TaskStarted', id)),
      done: curr.backlog.done.filter((id) => !isUnrouted('TaskCompleted', id)),
    },
    gates,
  };
}

// Adapter-injected: one tick. Reads the live folders snapshot + the
// durable prior state, derives new events (durably deduped), routes each
// through routeEvent (BL-297/299's single entrypoint - it already
// dispatches TaskCompleted -> summary+close internally), and persists the
// advanced snapshot + emitted-keys set REGARDLESS of whether any event
// routed this tick (the diff mechanism only fires once per transition, so
// prev must always advance to curr) - EXCEPT for a transition whose event
// failed to post, which stays out of the persisted snapshot so it is
// retried next tick (see withRetryableTransitionsHeldBack above).
export async function runConciergeTick(adapters: ConciergeTickAdapters): Promise<TickResult> {
  const folders = adapters.readFolders();
  const curr = toEventStreamSnapshot(folders, adapters.readGates(), adapters.readRoleTicket());
  const state = adapters.readTickState();
  const alreadyEmitted = new Set(state.emittedKeys);
  const events = deriveSwarmEvents(state.snapshot, curr, alreadyEmitted);

  let routed = 0;
  const unrouted = new Set<string>();
  for (const event of events) {
    const title = titleForBacklogId(folders, event.backlogId);
    const result = await routeEvent(event, title, adapters.routeAdapters);
    if (result.posted) {
      alreadyEmitted.add(swarmEventKey(event));
      routed += 1;
    } else {
      unrouted.add(swarmEventKey(event));
    }
  }

  const persistedSnapshot = withRetryableTransitionsHeldBack(curr, unrouted);
  adapters.writeTickState({ snapshot: persistedSnapshot, emittedKeys: [...alreadyEmitted] });
  return { routed };
}
