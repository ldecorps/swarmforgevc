// BL-300: slice 5 (RUNTIME WIRING) of the BL-295 Concierge refinement.
// BL-296 (derive), BL-297 (route), BL-299 (complete/close) are pure,
// tested, and DARK - nothing calls them. This module is the tick body: a
// live backlog-folders snapshot -> deriveSwarmEvents -> routeEvent per
// event, with DURABLE (restart-safe) dedup. Adapter-injected and
// Telegram-agnostic in its own imports (it composes topicRouter.ts's
// RouteAdapters, which is where Telegram-specific adapters actually get
// wired, in the live wrapper - telegram-front-desk-bot.ts).
import { EventStreamSnapshot, GateSignal, SwarmEvent, SwarmEventType, TicketSummary, deriveSwarmEvents, swarmEventKey } from '../events/swarmEventStream';
import { RouteAdapters, TopicAction, decideEpicTopicAction, routeEvent } from './topicRouter';
import { EpicDefinition, computeEpicProgress, epicAnnouncementKey, epicOpeningText, epicProgressText } from './epicProgress';
import { resolveIconState, ICON_EMOJI } from './topicIcon';
import { TopicIconAdapters, syncTopicIcon } from './topicIconSync';

export interface BacklogFolderItem {
  id: string;
  title: string;
  // BL-322: the topic-opening summary's own two derived sources (readFolders'
  // real wrapper - telegram-front-desk-bot.ts's toFoldersSnapshot - reads
  // these straight off panel/backlogReader.ts's own BacklogItem, never a
  // second reader).
  notes?: string;
  firstAcceptanceStep?: string;
  // BL-357: read straight off the SAME BacklogItem.humanApproval field
  // backfill-human-approval.ts seeded and backlogReader.ts already parses -
  // never a second approval-state derivation.
  humanApproval?: 'pending' | 'approved';
  // BL-341: which epic this slice belongs to, as DATA - read straight off
  // BacklogItem.epic (backlogReader.ts), never inferred from notes: prose.
  epic?: string;
  // BL-341: an ALREADY-LIVE convention this ticket discovered in use
  // (BL-384's `type: epic`), not one it introduces. The one ticket per
  // epic id carrying `type: 'epic'` IS that epic's own definition (its
  // title + remainingSlices below), distinct from an ordinary slice that
  // merely declares the same `epic:` id.
  type?: string;
  // BL-341: free-text descriptions of work known to belong to this epic
  // but not yet ticketed - only meaningful on the epic-defining ticket
  // (type: 'epic'). Nothing in the backlog can derive an unticketed
  // slice's existence on its own; a human/specifier authors this list.
  remainingSlices?: string[];
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
  // BL-342: a topic's icon tracks its ticket's state - rides the SAME
  // TaskStarted/TaskCompleted transitions above (no new trigger), plus one
  // additional folder-membership diff for the paused transition, which has
  // no SwarmEvent of its own (an icon update posts no chat message, so it
  // needs none of that machinery).
  iconAdapters: TopicIconAdapters;
}

export interface TickResult {
  routed: number;
}

// BL-322: only ACTIVE tickets need an entry - TaskStarted only ever fires
// for an id entering backlog.active (diffTaskStarted), so a paused/done
// ticket's summary is never read.
function ticketSummariesFor(active: BacklogFolderItem[]): Record<string, TicketSummary> {
  const summaries: Record<string, TicketSummary> = {};
  for (const item of active) {
    summaries[item.id] = { title: item.title, notes: item.notes, firstAcceptanceStep: item.firstAcceptanceStep };
  }
  return summaries;
}

// BL-357: active-ticket-only, same scope restriction as ticketSummariesFor
// above and for the same reason - a paused ticket has no topic open yet
// (one only opens on TaskStarted, i.e. entering active) and most paused
// tickets default to `pending` pre-promotion regardless of whether anyone
// is actually waiting to be asked (backfill-human-approval.ts seeds the
// field "regardless of value"). Asking about those would flood a topic
// open for every paused ticket before its own work even starts, and the
// ticket's own notes frame the gap as the 3 ACTIVE pending tickets,
// explicitly distinct from "9 paused ones".
function pendingApprovalFor(active: BacklogFolderItem[]): string[] {
  return active.filter((item) => item.humanApproval === 'pending').map((item) => item.id);
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
    ticketSummaries: ticketSummariesFor(folders.active),
    pendingApproval: pendingApprovalFor(folders.active),
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

// BL-342: which folder (active/paused/done) currently holds a ticket -
// resolveIconState's own required input, alongside the ticket's type. An
// id absent from all three folders (should not happen within one tick, the
// same invariant titleForBacklogId above relies on) resolves to undefined,
// never a guessed folder.
function folderForBacklogId(folders: BacklogFoldersSnapshot, backlogId: string): 'active' | 'paused' | 'done' | undefined {
  if (folders.active.some((item) => item.id === backlogId)) return 'active';
  if (folders.paused.some((item) => item.id === backlogId)) return 'paused';
  if (folders.done.some((item) => item.id === backlogId)) return 'done';
  return undefined;
}

function typeForBacklogId(folders: BacklogFoldersSnapshot, backlogId: string): string | undefined {
  const all = [...folders.active, ...folders.paused, ...folders.done];
  return all.find((item) => item.id === backlogId)?.type;
}

// BL-342: the one call site every icon-state transition (TaskStarted,
// TaskCompleted, and the paused-diff below) funnels through - resolves the
// ticket's CURRENT folder+type into a desired icon and hands it to
// syncTopicIcon, which owns the "never touch an icon the swarm did not
// set" rule. An epic-defining ticket (type: 'epic') is never a target here
// at all - epic icons (trophy/lightning/folder) are hand-assigned and
// entirely out of this ticket's scope. A ticket with no topic yet
// (topicId undefined - most commonly the paused-diff firing for a ticket
// that has never been promoted) is a no-op: there is no topic to update.
async function syncIconForBacklogId(
  backlogId: string,
  folders: BacklogFoldersSnapshot,
  topicId: number | undefined,
  isNewTopic: boolean,
  iconAdapters: TopicIconAdapters
): Promise<void> {
  const folder = folderForBacklogId(folders, backlogId);
  const type = typeForBacklogId(folders, backlogId);
  if (folder === undefined || type === 'epic' || topicId === undefined) {
    return;
  }
  const state = resolveIconState(folder, type);
  await syncTopicIcon(backlogId, topicId, ICON_EMOJI[state], isNewTopic, iconAdapters);
}

// BL-342: icon sync deliberately does NOT ride deriveSwarmEvents' own
// TaskStarted/TaskCompleted stream - it rides the SAME prev/curr
// folder-membership snapshot this tick already computes, but through its
// OWN, independent diff, never gated by emittedKeys. The two need
// DIFFERENT dedup semantics: a ticket's chat-message opener must post only
// ONCE EVER (emittedKeys' whole job, swarmEventStream.ts), but its icon is
// a silent, idempotent signal that must track EVERY re-entry into a
// folder - including a ticket re-promoted after being paused, which
// reuses an EXISTING topic and would otherwise never get its icon flipped
// back, since diffTaskStarted's own (TaskStarted, backlogId) key was
// already durably marked emitted the FIRST time this ticket went active
// and never fires again (confirmed: this is exactly the bug a first draft
// of this wiring shipped with, piggybacking on the event stream directly -
// caught by a re-promotion test). Mirrors diffTaskStarted/diffTaskCompleted's
// own "newly appearing in this folder" shape (swarmEventStream.ts) exactly,
// generalized to all three folders since all three need it here.
function newlyEnteredIds(prevIds: string[] | undefined, currIds: string[]): string[] {
  const prevSet = new Set(prevIds ?? []);
  return currIds.filter((id) => !prevSet.has(id));
}

// BL-341: which epic (if any) the triggering ticket declares - the SAME
// all-folders lookup titleForBacklogId above already needs, for the same
// reason (a TaskCompleted event's ticket has just moved into folders.done).
function epicForBacklogId(folders: BacklogFoldersSnapshot, backlogId: string): string | undefined {
  const all = [...folders.active, ...folders.paused, ...folders.done];
  return all.find((item) => item.id === backlogId)?.epic;
}

// Every SLICE (across all three folders) declaring this epic - never the
// epic-defining ticket itself, which also carries the SAME `epic: <id>`
// self-referentially (mirrors BL-384's own real convention: its own notes
// count only its CHILDREN as slices, e.g. "the role-benchmarking epic
// already shipped two slices - BL-340 ... and BL-347", never itself).
// done means the slice sits in folders.done right now, the same live-state
// read diffTaskCompleted itself fires from, so a just-completed slice
// already counts as done here in the SAME tick its TaskCompleted event
// derives.
function epicSlicesFor(folders: BacklogFoldersSnapshot, epicId: string) {
  const isSlice = (item: BacklogFolderItem) => item.epic === epicId && item.type !== 'epic';
  const notDone = [...folders.active, ...folders.paused].filter(isSlice).map(() => ({ done: false }));
  const done = folders.done.filter(isSlice).map(() => ({ done: true }));
  return [...notDone, ...done];
}

// BL-341: every epic's own definition, derived DIRECTLY from the already-
// read folders snapshot - no separate adapter/reader needed. Reuses the
// EXISTING, already-live ticket convention this ticket discovered rather
// than inventing a second data source: the one ticket per epic id carrying
// `type: 'epic'` IS that epic's definition (its own title + remainingSlices
// fields), found across all three folders (an epic's own umbrella ticket
// can itself be active, paused, or done).
function epicDefinitionsFor(folders: BacklogFoldersSnapshot): Record<string, EpicDefinition> {
  const all = [...folders.active, ...folders.paused, ...folders.done];
  const definitions: Record<string, EpicDefinition> = {};
  for (const item of all) {
    if (item.type === 'epic' && item.epic) {
      definitions[item.epic] = { id: item.epic, title: item.title, remainingSlices: item.remainingSlices ?? [] };
    }
  }
  return definitions;
}

// BL-341: the opening line on a slice's FIRST appearance (TaskStarted) vs
// the progress line on a slice completing (TaskCompleted) - extracted from
// postEpicUpdateIfApplicable below purely to keep that function's own CRAP
// under threshold (cleaner review).
function epicUpdateText(event: SwarmEvent, folders: BacklogFoldersSnapshot, epicId: string, definition: EpicDefinition): string {
  return event.type === 'TaskStarted'
    ? epicOpeningText(definition.title)
    : epicProgressText(computeEpicProgress(definition, epicSlicesFor(folders, epicId)));
}

// The reuse-or-create posting half of postEpicUpdateIfApplicable below,
// extracted for the same CRAP reason as epicUpdateText above - mirrors
// topicRouter.ts's own reuse-or-create shape (routeEvent/sendAndRecord),
// keyed by epic id rather than backlogId since an epic topic has no
// recordMessage (blTopicStore is per-ticket only, see RouteAdapters).
// BL-394: now reports whether the send actually succeeded, so the caller
// can gate its durable "already announced" key on a SUCCESSFUL post only -
// mirrors sendAndRecord's/routeEvent's own "only record what genuinely
// posted" contract (topicRouter.ts).
async function postEpicAction(action: TopicAction, epicId: string, routeAdapters: RouteAdapters): Promise<boolean> {
  if (action.kind === 'reuse') {
    return routeAdapters.sendMessage(action.topicId, action.text);
  }
  const created = await routeAdapters.createTopic(action.topicName);
  if (!created.success || created.topicId === undefined) {
    return false;
  }
  routeAdapters.recordTopicId(epicId, created.topicId);
  return routeAdapters.sendMessage(created.topicId, action.text);
}

// BL-341: rides the SAME TaskStarted/TaskCompleted transitions that already
// drive per-ticket topic routing - no new trigger, no second mechanism, per
// the ticket's own explicit instruction. Posts the epic's opening line on a
// slice's FIRST appearance (TaskStarted) and its progress line on a slice
// completing (TaskCompleted), through the SAME create/reuse topic map a
// ticket's own topic uses (decideEpicTopicAction). A ticket declaring no
// epic is a no-op here - epics-07's own "behaves exactly as today"
// regression guard.
//
// Deliberately NOT part of the transition-held-back retry mechanism
// withRetryableTransitionsHeldBack owns: this is a side effect layered on
// an ALREADY-successfully-routed ticket event, not a new SwarmEventType of
// its own to diff/dedupe. A failed epic post is not specially retried here.
//
// BL-394: that independence cuts both ways - the SAME ticket event can be
// RE-DERIVED (e.g. a held-back retry after the ticket's own post failed)
// with the epic's own aggregate completely unchanged, and this side effect
// used to have no memory of its own, reposting the identical text every
// such retry (the live incident: an unrelated per-ticket post stuck
// retrying flooded its epic's topic with an unchanging progress line on
// every tick). So it now carries its OWN durable, content-based dedup
// (epicAnnouncementKey), recorded in the SAME alreadyEmitted set/tick
// state the ticket-level events use - checked before posting and added
// only after a SUCCESSFUL post, exactly mirroring routeEvent's contract.
async function postEpicUpdateIfApplicable(
  event: SwarmEvent,
  folders: BacklogFoldersSnapshot,
  epicDefinitions: Record<string, EpicDefinition>,
  routeAdapters: RouteAdapters,
  alreadyEmitted: Set<string>
): Promise<void> {
  if ((event.type !== 'TaskStarted' && event.type !== 'TaskCompleted') || event.backlogId === null) {
    return;
  }
  const epicId = epicForBacklogId(folders, event.backlogId);
  if (!epicId) {
    return;
  }
  const definition = epicDefinitions[epicId] ?? { id: epicId, title: epicId, remainingSlices: [] };
  const text = epicUpdateText(event, folders, epicId, definition);
  const key = epicAnnouncementKey(epicId, text);
  if (alreadyEmitted.has(key)) {
    return;
  }
  const action = decideEpicTopicAction(epicId, definition.title, routeAdapters.getTopicMap(), text);
  const posted = await postEpicAction(action, epicId, routeAdapters);
  if (posted) {
    alreadyEmitted.add(key);
  }
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
// BL-358: an untagged gate's NeedsApproval is keyed by role (backlogId
// null), not a ticket - retry symmetry now reverts a gated role whether its
// event was tagged or not, resolved by the SAME curr.roleTicket lookup as
// before; ?? null carries the "holds no ticket" case through unchanged
// rather than passing undefined into a key swarmEventKey never expects.
function withRetryableTransitionsHeldBack(curr: EventStreamSnapshot, unrouted: ReadonlySet<string>): EventStreamSnapshot {
  if (unrouted.size === 0) {
    return curr;
  }
  const isUnrouted = (type: SwarmEventType, backlogId: string | null, role?: string) =>
    unrouted.has(swarmEventKey({ type, backlogId, role, payload: {} }));
  const gates = curr.gates.map((gate) => {
    const backlogId = curr.roleTicket[gate.role] ?? null;
    return gate.gated && isUnrouted('NeedsApproval', backlogId, gate.role) ? { ...gate, gated: false } : gate;
  });
  return {
    ...curr,
    backlog: {
      ...curr.backlog,
      active: curr.backlog.active.filter((id) => !isUnrouted('TaskStarted', id)),
      done: curr.backlog.done.filter((id) => !isUnrouted('TaskCompleted', id)),
    },
    gates,
    // BL-357: same array-filter retry pattern as TaskStarted/TaskCompleted
    // above - a failed ApprovalRequested post holds its id back out of the
    // persisted pendingApproval set so the next tick's diff sees it as a
    // fresh not-pending -> pending transition and retries it.
    pendingApproval: curr.pendingApproval.filter((id) => !isUnrouted('ApprovalRequested', id)),
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
  const epicDefinitions = epicDefinitionsFor(folders);
  const state = adapters.readTickState();
  const alreadyEmitted = new Set(state.emittedKeys);
  const events = deriveSwarmEvents(state.snapshot, curr, alreadyEmitted);

  // BL-342: snapshot which tickets already had a topic BEFORE this tick's
  // own event loop runs (which may CREATE fresh ones below) - the ONLY
  // reliable way to tell "this transition's topic is brand new" (always
  // free to set its initial icon) apart from "this topic already existed"
  // (only update if the swarm's own marker shows it owns the icon) for the
  // icon sync pass further down.
  const topicIdsBeforeTick = new Set(Object.keys(adapters.routeAdapters.getTopicMap()));

  let routed = 0;
  const unrouted = new Set<string>();
  for (const event of events) {
    // BL-358: an untagged event has no ticket to look a title up for -
    // routeEvent never uses `title` on that branch (routeUntaggedGateEvent
    // takes no title at all), so the role name is passed through purely for
    // a harmless, honest value rather than a lookup that could never match.
    const title = event.backlogId ? titleForBacklogId(folders, event.backlogId) : (event.role ?? 'unknown');
    const result = await routeEvent(event, title, adapters.routeAdapters);
    if (result.posted) {
      alreadyEmitted.add(swarmEventKey(event));
      routed += 1;
    } else {
      unrouted.add(swarmEventKey(event));
    }
    await postEpicUpdateIfApplicable(event, folders, epicDefinitions, adapters.routeAdapters, alreadyEmitted);
  }

  // BL-342: icon sync rides the SAME prev/curr folder-membership diff this
  // tick already computes, but through its own independent pass over ALL
  // THREE folders - never gated by emittedKeys (see newlyEnteredIds' own
  // comment for why). Runs AFTER the event loop above so a brand-new
  // topic created this same tick is already in the topic map. A failed
  // icon call is not specially retried (the same best-effort posture
  // postEpicUpdateIfApplicable already documents for its own side effect);
  // the next genuine re-entry into that folder tries again.
  const folderTransitions: Array<{ folder: 'active' | 'paused' | 'done'; ids: string[] }> = [
    { folder: 'active', ids: newlyEnteredIds(state.snapshot?.backlog.active, curr.backlog.active) },
    { folder: 'paused', ids: newlyEnteredIds(state.snapshot?.backlog.paused, curr.backlog.paused) },
    { folder: 'done', ids: newlyEnteredIds(state.snapshot?.backlog.done, curr.backlog.done) },
  ];
  for (const { ids } of folderTransitions) {
    for (const backlogId of ids) {
      const topicId = adapters.routeAdapters.getTopicMap()[backlogId];
      const isNewTopic = !topicIdsBeforeTick.has(backlogId);
      await syncIconForBacklogId(backlogId, folders, topicId, isNewTopic, adapters.iconAdapters);
    }
  }

  const persistedSnapshot = withRetryableTransitionsHeldBack(curr, unrouted);
  adapters.writeTickState({ snapshot: persistedSnapshot, emittedKeys: [...alreadyEmitted] });
  return { routed };
}
