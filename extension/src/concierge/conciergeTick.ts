// BL-300: slice 5 (RUNTIME WIRING) of the BL-295 Concierge refinement.
// BL-296 (derive), BL-297 (route), BL-299 (complete/close) are pure,
// tested, and DARK - nothing calls them. This module is the tick body: a
// live backlog-folders snapshot -> deriveSwarmEvents -> routeEvent per
// event, with DURABLE (restart-safe) dedup. Adapter-injected and
// Telegram-agnostic in its own imports (it composes topicRouter.ts's
// RouteAdapters, which is where Telegram-specific adapters actually get
// wired, in the live wrapper - telegram-front-desk-bot.ts).
import { EventStreamSnapshot, GateSignal, SwarmEvent, SwarmEventType, TicketSummary, deriveSwarmEvents, swarmEventKey } from '../events/swarmEventStream';
import { BacklogTopicMap, RouteAdapters, TicketRouteContext, TopicAction, decideEpicTopicAction, routeEvent } from './topicRouter';
import { EpicDefinition, computeEpicProgress, epicAnnouncementKey, epicOpeningText, epicProgressText } from './epicProgress';
import { resolveEpicIcon, isKnownEpic } from './epicIcon';
import { resolveIconState, ICON_EMOJI, STANDING_TOPIC_ICON, StandingTopicTarget, ROLE_TOPIC_ICON, RoleTopicTarget } from './topicIcon';
import { TopicIconAdapters, syncTopicIcon } from './topicIconSync';
import { StalenessBucket } from './topicTitleAge';
import { TopicTitleAdapters, syncTopicTitle } from './topicTitleSync';
import { PipelineBoardTicketMeta, computePipelineBoard } from './pipelineBoard';
import { PipelineBoardAdapters, PipelineBoardState, PipelineBoardSyncResult, syncPipelineBoard } from './pipelineBoardSync';
import { PipelineBoardPinAdapters, syncPipelineBoardPin } from './pipelineBoardPinSync';
import { ApprovalsRosterAdapters, ApprovalsRosterState, syncApprovalsRoster } from './approvalsRosterSync';
import { RecertPostingAdapters, RecertPostingState, syncRecertPosting } from './recertPostingSync';
import { RecertifiableScenario } from '../docs/recertification';

export interface BacklogFolderItem {
  id: string;
  title: string;
  // BL-322: the topic-opening summary's own two derived sources (readFolders'
  // real wrapper - telegram-front-desk-bot.ts's toFoldersSnapshot - reads
  // these straight off panel/backlogReader.ts's own BacklogItem, never a
  // second reader).
  notes?: string;
  firstAcceptanceStep?: string;
  // BL-480: read straight off the SAME BacklogItem.approvalContext field
  // backlogReader.ts parses from `approval_context` (BL-479) - never a
  // second parse.
  approvalContext?: string;
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
  // BL-465: the backlog yaml's own basename - read straight off the SAME
  // BacklogItem.filename field backlogReader.ts populates, never a second
  // filename derivation (which could 404-link a ticket whose title-derived
  // guess drifts from its real on-disk slug).
  filename?: string;
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
  // BL-418: every standing-topic id (a support subject, or the Operator's
  // own sentinel id) this tick has EVER seen before, across every past
  // tick/restart - the standing-topic sibling of the ticket-icon sync's
  // own topicIdsBeforeTick check above. A standing topic is never created
  // BY this tick (a human creates a support topic by messaging into it;
  // the Operator topic is created once, before this loop starts), so there
  // is no in-tick "just created it" signal to lean on the way ticket
  // topics have via routeEvent's own createTopic step - this durable seen-
  // set is what tells apart a GENUINELY NEW appearance (free to set its
  // initial icon) from a topic that predates this feature and may already
  // carry a human-customised icon (never touch it - scenario 02). Absent
  // on an old/fresh TickState file, treated as empty (every currently-known
  // standing topic looks "newly entered" on the very first tick after this
  // ships) - the backfill script exists to seed this ahead of that first
  // tick for anything that already exists, mirroring BL-342's own backfill
  // precedent for pre-existing ticket topics.
  standingIconSeenIds?: string[];
  // BL-469: the per-agent steering-topic sibling of standingIconSeenIds
  // above - every role token this tick has EVER seen before, across every
  // past tick/restart. Same rationale: a per-agent topic is never created
  // BY this tick (BL-425's roleTopicMapStore seeds it once, out of band),
  // so there is no in-tick "just created it" signal, and this durable
  // seen-set is what tells apart a genuinely new appearance (free to set
  // its initial icon) from a role topic that predates this feature.
  // Absent on an old/fresh TickState file, treated as empty.
  roleIconSeenIds?: string[];
  // BL-414: each ticket's durably last-announced title-age bucket - the
  // change-gate the title-age suffix needs, mirroring standingIconSeenIds'
  // own "durable across restarts" posture. Absent/missing entry means "no
  // bucket announced yet for this ticket", so its very first tick always
  // counts as a transition and edits once.
  titleAgeBuckets?: Record<string, StalenessBucket>;
  // BL-452: the pipeline board's own durable "last rendered/posted" marker -
  // same posture as standingIconSeenIds/titleAgeBuckets above. Absent on an
  // old/fresh TickState file, treated as "no board posted yet" (the first
  // tick after this ships creates the standing topic and posts the first
  // message).
  pipelineBoard?: PipelineBoardState;
  // BL-434: the Approvals topic's own durable "last rendered/posted" roster
  // marker - same posture as pipelineBoard above. Absent on an old/fresh
  // TickState file, treated as "no roster posted yet" (the first tick after
  // this ships creates the standing topic and posts the first roster).
  approvalsRoster?: ApprovalsRosterState;
  // BL-450: the Recert topic's own durable "last rendered/posted" marker -
  // same posture as approvalsRoster above. Absent on an old/fresh TickState
  // file, treated as "no scenario posted yet".
  recertPosted?: RecertPostingState;
  // BL-465 bounce: durable per-ticket "closed at" tick-observed timestamp -
  // recorded the FIRST tick a ticket is seen in folders.done (mirrors
  // standingIconSeenIds/roleIconSeenIds' own "newly entering" durability),
  // so the pipeline board's recently-closed section can sort by ACTUAL
  // closure recency instead of folders.done's arbitrary directory-listing
  // order (readdir gives no ordering guarantee, and is not closure time
  // regardless). A ticket already done before this field existed has no
  // entry here - it sorts after every timestamped ticket (unknown
  // recency), the same eventual-consistency gap BL-418's own
  // standingIconSeenIds backfill precedent already accepts for a one-time
  // pre-existing set.
  doneClosedAtMs?: Record<string, number>;
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
  // BL-418: every standing (non-ticket) topic the icon sync should consider
  // this tick - the Operator's one topic plus every currently-open support
  // subject's topic, already classified by iconKey. Live-wired to read the
  // front-desk bot's OWN {topicId: subjectId} map (never backlogTopicMap,
  // which is ticket topics only) - conciergeTick.ts itself stays unaware of
  // that map's Telegram-specific sentinel keys (DEFAULT_SUBJECT_KEY,
  // OPERATOR_SUBJECT_ID); the live wrapper does that classification.
  // Optional (defaults to no standing topics) so every existing adapters
  // fixture across this codebase's acceptance step handlers - built before
  // this field existed - keeps working unchanged rather than needing an
  // update just to satisfy a capability its own ticket never touches.
  readStandingTopics?: () => StandingTopicTarget[];
  // BL-469: every per-agent steering topic (BL-425, one per swarm role)
  // the icon sync should consider this tick - live-wired to read BL-425's
  // own role->topicId map (roleTopicMapStore.readRoleTopicMap), filtered to
  // the roles ROLE_TOPIC_ICON actually maps. Optional for the same reason
  // readStandingTopics is optional above - every existing adapters fixture
  // built before this field existed keeps working unchanged.
  readRoleTopics?: () => RoleTopicTarget[];
  // BL-414: optional (defaults to no title-age sync) for the same reason
  // readStandingTopics above is optional - every existing adapters fixture
  // across this codebase's own acceptance step handlers was built before
  // this field existed, and must keep working unchanged rather than
  // needing an update just to satisfy a capability its own ticket never
  // touches.
  titleAdapters?: TopicTitleAdapters;
  // BL-452: each role's CURRENTLY held ticket id(s) - live-wired from the
  // enriched PipelineStage.heldTicketIds (swarmState.ts), never from
  // readRoleTicket above (that one derives "current holder" from
  // completed+in_process holding WINDOWS, the hop-log-shaped mechanism this
  // ticket's own human decision explicitly rejected as its data source).
  // Optional (defaults to no board sync), same posture as
  // readStandingTopics/titleAdapters above. BL-487: may return a Promise -
  // the production adapter now recomputes live each tick rather than
  // reading a coordinator-written cache (see syncBoardIfWired).
  readRoleHeldTickets?: () => Record<string, string[]> | Promise<Record<string, string[]>>;
  // BL-452: optional (defaults to no board sync) for the same reason
  // titleAdapters above is optional - every existing adapters fixture
  // across this codebase's own acceptance step handlers was built before
  // this field existed.
  boardAdapters?: PipelineBoardAdapters;
  // BL-465: raw backlog/ root asks (e.g. "INTAKE-...md" files) - a live
  // fs read, never limited to the git-SHA static PWA projection (this is
  // the LIVE Telegram surface). Optional (defaults to no root-intake
  // section), same posture as boardAdapters above.
  readRootIntakeFiles?: () => { id: string; title?: string; filename: string }[];
  // BL-465: the repo's GitHub base URL (e.g.
  // "https://github.com/ldecorps/swarmforgevc"), derived from the origin
  // remote - undefined when unresolvable (e.g. no git remote), in which
  // case the board's link list is simply omitted this tick. Optional, same
  // posture as boardAdapters above.
  readRepoBaseUrl?: () => string | undefined;
  // BL-434: the standing Approvals topic's own roster-sync adapters -
  // optional (defaults to no roster sync), same posture as boardAdapters
  // above, for the identical reason: every existing adapters fixture across
  // this codebase's own acceptance step handlers was built before this
  // field existed.
  rosterAdapters?: ApprovalsRosterAdapters;
  // BL-450: the current oldest-unreviewed recert scenario (or undefined
  // when none needs recertification) - live-wired from
  // recertificationStore.ts's computeRecertBatch(targetPath, 1), never a
  // second selection computed here. Optional (defaults to no recert
  // posting), same posture as readRoleHeldTickets/rosterAdapters above.
  readRecertScenario?: () => RecertifiableScenario | undefined;
  // BL-450: the standing Recert topic's own posting-sync adapters -
  // optional (defaults to no recert posting), same posture as
  // rosterAdapters above.
  recertPostingAdapters?: RecertPostingAdapters;
  // BL-467: enforces the pipeline board as the ONLY pinned message in the
  // group - optional (defaults to no pin enforcement), same posture as
  // boardAdapters above. Runs AFTER the board sync so it always sees this
  // tick's freshly-posted board messageId, never a stale one.
  pinAdapters?: PipelineBoardPinAdapters;
}

export interface TickResult {
  routed: number;
}

// BL-322: TaskStarted only ever fires for an id entering backlog.active
// (diffTaskStarted), so it only ever needs an active ticket's summary.
// BL-480: ApprovalRequested can ALSO fire for a ticket still in paused/ -
// pendingApprovalFor below scans active AND paused (BL-408: a ticket awaits
// human review in paused/ until promotion) - so this must build summaries
// for BOTH folders too, or a paused ticket's ask silently degrades to the
// bare id-only line despite its YAML carrying real title/notes/
// firstAcceptanceStep/approvalContext. Previously active-only (comment said
// "only ACTIVE tickets need an entry", true only while TaskStarted was the
// sole consumer of this map).
function ticketSummariesFor(active: BacklogFolderItem[], paused: BacklogFolderItem[]): Record<string, TicketSummary> {
  const summaries: Record<string, TicketSummary> = {};
  for (const item of [...active, ...paused]) {
    summaries[item.id] = {
      title: item.title,
      notes: item.notes,
      firstAcceptanceStep: item.firstAcceptanceStep,
      approvalContext: item.approvalContext,
    };
  }
  return summaries;
}

// BL-408: scan active AND paused for pending-approval tickets. Tickets awaiting
// human review sit in paused/ until promotion, per constitution Article 3. The
// approval request must fire for BOTH, not just active ones.
// BL-394: change-gate via emittedKeys prevents re-posting when a ticket stays
// pending - diffApprovalRequested fires only on not-pending->pending transitions
// (the same shape diffTaskStarted uses), so a ticket asked once is not re-asked
// on each tick, regardless of folder.
function pendingApprovalFor(active: BacklogFolderItem[], paused: BacklogFolderItem[]): string[] {
  const all = [...active, ...paused];
  return all.filter((item) => item.humanApproval === 'pending').map((item) => item.id);
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
    ticketSummaries: ticketSummariesFor(folders.active, folders.paused),
    pendingApproval: pendingApprovalFor(folders.active, folders.paused),
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

// BL-424: resolveIconState's new third input - read straight off the SAME
// BacklogFolderItem.humanApproval field pendingApprovalFor above already
// reads, never a second approval-state derivation.
function humanApprovalForBacklogId(folders: BacklogFoldersSnapshot, backlogId: string): 'pending' | 'approved' | undefined {
  const all = [...folders.active, ...folders.paused, ...folders.done];
  return all.find((item) => item.id === backlogId)?.humanApproval;
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
  // BL-424: humanApproval feeds resolveIconState's new paused-scoped
  // awaiting-approval state; the fallback only ever applies to that one
  // state, since it is the only glyph not already long-established in the
  // live set (see topicIconSync.ts's own comment on syncTopicIcon).
  const humanApproval = humanApprovalForBacklogId(folders, backlogId);
  const state = resolveIconState(folder, type, humanApproval);
  const fallbackEmoji = state === 'awaiting-approval' ? ICON_EMOJI.paused : undefined;
  await syncTopicIcon(backlogId, topicId, ICON_EMOJI[state], isNewTopic, iconAdapters, fallbackEmoji);
}

// BL-414: the title-age sibling of syncIconForBacklogId above - but unlike
// icon sync (which fires only on a folder-membership TRANSITION), this
// runs for every ticket with a topic on EVERY tick, because elapsed time
// keeps moving regardless of folder membership; the change-gate lives
// inside syncTopicTitle/decideTitleAge instead (bucket-equality, not
// entry-into-a-folder). An epic-defining ticket is never a target, same
// exclusion as the icon sync. Returns the bucket to persist (unchanged
// from prevBucket on any skip/no-op case).
async function syncTitleAgeForBacklogId(
  backlogId: string,
  folders: BacklogFoldersSnapshot,
  topicId: number | undefined,
  nowMs: number,
  prevBucket: StalenessBucket | undefined,
  titleAdapters: TopicTitleAdapters
): Promise<StalenessBucket | undefined> {
  const type = typeForBacklogId(folders, backlogId);
  if (topicId === undefined || type === 'epic') {
    return prevBucket;
  }
  const rawTitle = titleForBacklogId(folders, backlogId);
  const result = await syncTopicTitle(backlogId, topicId, rawTitle, nowMs, prevBucket, titleAdapters);
  return result.bucket;
}

// BL-414: loops syncTitleAgeForBacklogId above over every ticket across all
// three folders - extracted out of runConciergeTick so THAT function's own
// branch count stays at or below the CRAP threshold, the same "extract so
// branch count stays at or below the CRAP threshold" reasoning as
// deliveryOutcome/syncStandingTopicIcons elsewhere in this codebase.
// Returns undefined (skip entirely) when no titleAdapters were injected -
// the caller then leaves the prior tick's bucket map untouched.
async function syncAllTitleAgeBuckets(
  folders: BacklogFoldersSnapshot,
  topicMap: BacklogTopicMap,
  nowMs: number,
  prevBuckets: Record<string, StalenessBucket> | undefined,
  titleAdapters: TopicTitleAdapters | undefined
): Promise<Record<string, StalenessBucket>> {
  const titleAgeBuckets: Record<string, StalenessBucket> = { ...(prevBuckets ?? {}) };
  if (!titleAdapters) {
    return titleAgeBuckets;
  }
  const allTicketIds = [...folders.active, ...folders.paused, ...folders.done].map((item) => item.id);
  for (const backlogId of allTicketIds) {
    const bucket = await syncTitleAgeForBacklogId(backlogId, folders, topicMap[backlogId], nowMs, prevBuckets?.[backlogId], titleAdapters);
    if (bucket !== undefined) {
      titleAgeBuckets[backlogId] = bucket;
    }
  }
  return titleAgeBuckets;
}

// BL-455: joins role-held/paused ticket ids to their backlog item's
// epic/title, read straight off the folders this tick already loaded - no
// git-history walk. Both active and paused items are indexed: a role-held
// id is always an active ticket, a parked/awaiting-approval id is always a
// paused one, so this single lookup covers computePipelineBoard's own two
// inputs (roleHeldTickets, paused) without a second read.
// BL-513: a ticket id can transiently exist in more than one folder at once
// (a stale duplicate left behind during promotion/close) - the
// AUTHORITATIVE folder wins: active over paused over done, never a stale
// copy. Populated LOWEST-priority first so each later pass's assignment
// overwrites any earlier one for the same id, leaving the highest-priority
// folder's entry as the final value in the map.
function buildTicketMetaLookup(folders: BacklogFoldersSnapshot): Record<string, PipelineBoardTicketMeta> {
  const lookup: Record<string, PipelineBoardTicketMeta> = {};
  for (const item of folders.done) {
    lookup[item.id] = { epic: item.epic, title: item.title, filename: item.filename, location: 'done' };
  }
  for (const item of folders.paused) {
    lookup[item.id] = { epic: item.epic, title: item.title, filename: item.filename, location: 'paused' };
  }
  for (const item of folders.active) {
    lookup[item.id] = { epic: item.epic, title: item.title, filename: item.filename, location: 'active' };
  }
  return lookup;
}

// BL-452/BL-455: the pipeline board's own sync - runs on EVERY tick (never
// gated on a folder-membership transition, same posture as the title-age
// sync above), because the change-gate that matters is the rendered TEXT,
// not any one ticket's transition; syncPipelineBoard owns that gate.
// Extracted out of runConciergeTick so THAT function's own branch count
// stays at or below the CRAP threshold, the same reasoning as
// syncAllTitleAgeBuckets above. Absent adapters (boardAdapters/
// readRoleHeldTickets both optional, same posture as titleAdapters) leaves
// the prior tick's board state untouched.
// BL-465: folders.done is ALREADY loaded every tick (BacklogFoldersSnapshot)
// - recently-closed needs no second read, just a projection into the shape
// computePipelineBoard's rootIntake/recentlyClosed extras expect. Items
// with no filename (should not happen post-BL-465, but degrades safely)
// are skipped rather than emitting a link-less/broken entry.
// BL-465 bounce: sorted MOST-RECENTLY-closed first via the durable
// doneClosedAtMs map (see TickState's own docstring for why folder order
// alone is not recency) - pipelineBoard.ts's own computePipelineBoard
// deliberately does no sorting of its own ("the caller decides WHICH items
// count as 'recent'"), so this is the one place that ordering must happen;
// without it, PIPELINE_BOARD_RECENTLY_CLOSED_MAX's slice(0, N) truncates
// an arbitrary N items rather than the N most recently closed. An id with
// no recorded timestamp (predates this feature) sorts after every
// timestamped id, never crowding out a genuinely recent one.
function recentlyClosedItems(
  folders: BacklogFoldersSnapshot,
  doneClosedAtMs: Record<string, number>
): { id: string; title?: string; filename: string }[] {
  return folders.done
    .filter((item): item is BacklogFolderItem & { filename: string } => item.filename !== undefined)
    .sort((a, b) => (doneClosedAtMs[b.id] ?? -Infinity) - (doneClosedAtMs[a.id] ?? -Infinity));
}

// BL-465 bounce: stamps this tick's OWN observed instant onto every ticket
// in doneIds that has never been recorded before - the durable, monotonic
// record recentlyClosedItems sorts against (see TickState.doneClosedAtMs'
// own docstring). Deliberately NOT derived from the icon sync's
// newlyEnteredIds diff (scoped to state.snapshot - the event-ROUTING retry
// view, which a stuck completion message deliberately holds a ticket back
// out of to retry next tick). Coupling this timestamp to that retry state
// would re-stamp - and so silently rejuvenate - a ticket every tick its
// completion message keeps failing to route. A ticket's OWN closure time
// has nothing to do with whether the swarm managed to post about it, so
// this checks the durable map's OWN membership directly: once an id is
// stamped, it is never restamped. Extracted out of runConciergeTick so
// THAT function's own branch count stays at or below the CRAP threshold,
// the same reasoning as syncAllTitleAgeBuckets/syncBoardIfWired above.
function stampNewlyDoneClosedAtMs(prev: Record<string, number> | undefined, doneIds: string[], nowMs: number): Record<string, number> {
  const doneClosedAtMs = { ...(prev ?? {}) };
  for (const id of doneIds) {
    if (doneClosedAtMs[id] === undefined) {
      doneClosedAtMs[id] = nowMs;
    }
  }
  return doneClosedAtMs;
}

// BL-473 bounce: row membership is EXACTLY folders.active (physical
// backlog/active/ membership, ground truth for the human's "at least as
// good as the PWA" contract) - never unioned with roleHeldTickets. A
// role-held id absent from folders.active must get no row at all
// (acceptance board-active-membership-03: "no active row exists for a
// ticket absent from backlog/active/"); a defensive union would violate
// that "and only those" property the instant the two sources disagree - a
// role still holding a ticket the coordinator has already moved out of
// backlog/active/ (closed, or bounced back off-pipeline) would keep
// rendering an active row for a ticket that is no longer active. The
// role-held map stays exactly what buildGridRows already documents it as:
// decoration for a member's stage, never a second membership source.
function activeMembershipIds(folders: BacklogFoldersSnapshot): string[] {
  return folders.active.map((item) => item.id);
}

// BL-497: the live-outage root cause was exactly this - a failed outcome
// silently discarded, so nothing ever logged or reacted to it. One line is
// enough to see the real Telegram rejection reason on the next tick. Gated
// on a real `error` string: a fixture/harness whose board adapters are
// never genuinely wired (no error ever set) is a harmless no-op, not a
// failure worth logging - every REAL Telegram rejection always carries one
// (callTelegramApi's own `.error`), so this never hides a real gap. Split
// out purely to keep syncBoardIfWired's own CRAP under threshold (mirrors
// pipelineBoardSync.ts's own resolveBoardTopicId/postBoardMessage splits).
function logBoardSyncFailure(result: PipelineBoardSyncResult): void {
  if ((result.outcome === 'failed-no-topic' || result.outcome === 'failed-post') && result.error) {
    process.stderr.write(`syncBoardIfWired: ${result.outcome} (${result.failureClass ?? 'unknown'}): ${result.error}\n`);
  }
}

async function syncBoardIfWired(
  folders: BacklogFoldersSnapshot,
  prevBoard: PipelineBoardState | undefined,
  boardAdapters: PipelineBoardAdapters | undefined,
  readRoleHeldTickets: (() => Record<string, string[]> | Promise<Record<string, string[]>>) | undefined,
  readRootIntakeFiles: (() => { id: string; title?: string; filename: string }[]) | undefined,
  readRepoBaseUrl: (() => string | undefined) | undefined,
  nowMs: number,
  doneClosedAtMs: Record<string, number>
): Promise<PipelineBoardState | undefined> {
  if (!boardAdapters || !readRoleHeldTickets) {
    return prevBoard;
  }
  const repoBaseUrl = readRepoBaseUrl?.();
  // BL-487: readRoleHeldTickets may now be async (the production adapter
  // shells to pipeline_stage_cli.bb's side-effect-free `report` each tick,
  // recomputing live from in_process mailboxes rather than trusting the
  // coordinator-written ticket-stage-map.json cache - see
  // buildConciergeTickAdapters in telegram-front-desk-bot.ts). Awaiting a
  // plain (non-Promise) return value is a no-op passthrough, so every
  // existing synchronous test fixture keeps working unchanged.
  const roleHeldTickets = await readRoleHeldTickets();
  const data = computePipelineBoard(roleHeldTickets, folders.paused, buildTicketMetaLookup(folders), {
    rootIntake: readRootIntakeFiles?.() ?? [],
    recentlyClosed: recentlyClosedItems(folders, doneClosedAtMs),
    repoBaseUrl,
    activeIds: activeMembershipIds(folders),
  });
  const result = await syncPipelineBoard(data, prevBoard, boardAdapters, nowMs, repoBaseUrl);
  logBoardSyncFailure(result);
  return result.state;
}

// BL-467: runs AFTER syncBoardIfWired so boardMessageId is this tick's
// freshly-posted (or reposted) board message id, never the prior tick's
// stale one. Absent pinAdapters (not wired) is a no-op, same posture as
// syncBoardIfWired/syncApprovalsRosterIfWired above - the result is not
// otherwise persisted (getTopPinnedMessageId is re-read live every tick, so
// there is no durable state to carry across restarts, unlike the board/
// roster/recert syncs).
async function syncPinIfWired(boardMessageId: number | undefined, pinAdapters: PipelineBoardPinAdapters | undefined): Promise<void> {
  if (!pinAdapters) {
    return;
  }
  await syncPipelineBoardPin(boardMessageId, pinAdapters);
}

// BL-434: the Approvals topic's own roster sync - runs on EVERY tick (never
// gated on a pending-set transition, same posture as the pipeline-board sync
// above), because the change-gate that matters is the rendered TEXT, not any
// one ticket's transition; syncApprovalsRoster owns that gate. Fed straight
// off the SAME pendingApproval set toEventStreamSnapshot already computed
// this tick (pendingApprovalFor) - never a second derivation - joined to
// each ticket's title via the folders snapshot. Absent rosterAdapters leaves
// the prior tick's roster state untouched, same posture as boardAdapters.
async function syncApprovalsRosterIfWired(
  folders: BacklogFoldersSnapshot,
  pendingApproval: string[],
  prevRoster: ApprovalsRosterState | undefined,
  rosterAdapters: ApprovalsRosterAdapters | undefined
): Promise<ApprovalsRosterState | undefined> {
  if (!rosterAdapters) {
    return prevRoster;
  }
  const tickets = pendingApproval.map((id) => ({ id, title: titleForBacklogId(folders, id) }));
  const result = await syncApprovalsRoster(tickets, prevRoster, rosterAdapters);
  return result.state;
}

// BL-450: the standing Recert topic's own posting sync - unlike the
// pipeline-board/roster syncs above (which run on EVERY tick and always
// render SOMETHING), this is guarded on recertPostingAdapters being wired
// AND a scenario actually being current - syncRecertPosting itself already
// short-circuits on an undefined scenario (never posting a placeholder for
// an empty queue, recert-telegram-08), so this wrapper only adds the
// "not wired at all" guard, the same posture as syncBoardIfWired/
// syncApprovalsRosterIfWired above.
async function syncRecertPostingIfWired(
  scenario: RecertifiableScenario | undefined,
  prevState: RecertPostingState | undefined,
  recertPostingAdapters: RecertPostingAdapters | undefined
): Promise<RecertPostingState | undefined> {
  if (!recertPostingAdapters) {
    return prevState;
  }
  const result = await syncRecertPosting(scenario, prevState, recertPostingAdapters);
  return result.state;
}

// BL-418: the standing-topic sibling of syncIconForBacklogId above. Only
// EVER calls syncTopicIcon for a target that is NEWLY entering
// standingIconSeenIds (newlyEnteredIds, the SAME "first time this id is
// seen" diff the ticket-folder transitions above already use) - a target
// already in the seen-set is left completely untouched, whether or not it
// is swarm-owned, which is what makes this "change-gated" (BL-418's own
// wording): unlike the ownership check syncTopicIcon runs internally (which
// only ever protects an EXISTING, not-owned topic from being overwritten),
// this outer gate is what stops an ALREADY-owned standing topic from being
// re-set on every subsequent tick, since syncTopicIcon itself has no
// "already at the desired value" short-circuit of its own. Returns the
// updated seen-set (a strict superset) to persist. isNewTopic is always
// true for a newly-entered target - correct precisely because "newly
// entering the durable seen-set" IS this ticket's own definition of
// "genuinely new", by construction (see standingIconSeenIds' own docstring
// for why that must be tracked independently rather than inferred from the
// ownership marker itself).
async function syncStandingTopicIcons(
  targets: StandingTopicTarget[],
  prevSeenIds: string[] | undefined,
  iconAdapters: TopicIconAdapters
): Promise<string[]> {
  const currIds = targets.map((t) => t.id);
  const newlyEntered = new Set(newlyEnteredIds(prevSeenIds, currIds));
  for (const target of targets) {
    if (!newlyEntered.has(target.id)) {
      continue;
    }
    await syncTopicIcon(target.id, target.topicId, STANDING_TOPIC_ICON[target.iconKey], true, iconAdapters);
  }
  return [...new Set([...(prevSeenIds ?? []), ...currIds])];
}

// BL-469: the per-agent steering-topic sibling of syncStandingTopicIcons
// above - the SAME newly-entering-only change-gate posture (mirrors it
// exactly), generalized to per-agent role topics rather than standing
// ones. The sole difference is the icon lookup: a role topic's own `role`
// token IS the ROLE_TOPIC_ICON key directly, so there is no separate
// iconKey field to carry the way StandingTopicTarget needs one (see
// RoleTopicTarget's own docstring in topicIcon.ts for why).
// `targets` defaults an absent call to no-op here (rather than at the call
// site) so runConciergeTick's own call can pass the bare optional adapter
// result straight through - keeps runConciergeTick's own CRAP budget
// unaffected by adding this sync (cleaner split, BL-469 follow-up).
async function syncPerAgentTopicIcons(
  targets: RoleTopicTarget[] | undefined,
  prevSeenIds: string[] | undefined,
  iconAdapters: TopicIconAdapters
): Promise<string[]> {
  const resolvedTargets = targets ?? [];
  const currIds = resolvedTargets.map((t) => t.role);
  const newlyEntered = new Set(newlyEnteredIds(prevSeenIds, currIds));
  for (const target of resolvedTargets) {
    if (!newlyEntered.has(target.role)) {
      continue;
    }
    await syncTopicIcon(target.role, target.topicId, ROLE_TOPIC_ICON[target.role], true, iconAdapters);
  }
  return [...new Set([...(prevSeenIds ?? []), ...currIds])];
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

// BL-449: every distinct epic id currently declared by ANY item across all
// three folders (a defining ticket via `type: 'epic'`, or a plain slice via
// its own `epic:` field) - epicDefinitionsFor above only ever covers the
// FORMER, but epics-08's own regression (an epic with no defining ticket yet
// still gets a topic) means the icon pool must consider the latter too, or
// two undocumented epics created in the same tick could collide. Order is
// stable within one tick (folder traversal: active, paused, done) so
// resolveAllEpicIcons below assigns pool icons deterministically.
function allEpicIdsFor(folders: BacklogFoldersSnapshot): string[] {
  const all = [...folders.active, ...folders.paused, ...folders.done];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of all) {
    if (item.epic && !seen.has(item.epic)) {
      seen.add(item.epic);
      ids.push(item.epic);
    }
  }
  return ids;
}

// BL-449: resolves every known epic's icon ONCE per tick, threading each
// resolution's own icon into the next call's alreadyAssignedIcons so two
// epics created in the same tick never collide (resolveEpicIcon itself is
// pure and knows nothing of "this tick's other epics" - that sequencing is
// this function's own job). Pool exhaustion (distinctness is best-effort
// beyond pool size, per resolveEpicIcon's own contract) is logged here,
// never inside the pure resolver, which has no I/O of its own.
//
// BL-457: known epics (fixed pinned glyphs) are resolved FIRST so their
// glyphs are reserved into `used` before any unknown epic draws from the
// pool. Without this ordering an unknown epic earlier in folder order grabs
// a pool icon that is a known epic's pinned glyph, and the known epic then
// "collides" with it - firing a spurious "pool exhausted" warning every
// tick (the pool is NOT full) and, worse, handing a NEW unknown-epic topic a
// duplicate icon. Reserving the pinned glyphs up front makes the warning
// fire only on genuine exhaustion (more distinct epics than pool slots).
function resolveAllEpicIcons(epicIds: string[]): Record<string, string> {
  const assigned: Record<string, string> = {};
  const used: string[] = [];
  const knownFirst = [...epicIds.filter(isKnownEpic), ...epicIds.filter((id) => !isKnownEpic(id))];
  for (const id of knownFirst) {
    const icon = resolveEpicIcon(id, used);
    if (used.includes(icon)) {
      process.stderr.write(`runConciergeTick: epic icon pool exhausted - reusing "${icon}" for epic "${id}"\n`);
    }
    assigned[id] = icon;
    used.push(icon);
  }
  return assigned;
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
export function epicDefinitionsFor(folders: BacklogFoldersSnapshot): Record<string, EpicDefinition> {
  const all = [...folders.active, ...folders.paused, ...folders.done];
  const definitions: Record<string, EpicDefinition> = {};
  for (const item of all) {
    if (item.type === 'epic' && item.epic) {
      definitions[item.epic] = { id: item.epic, title: item.title, remainingSlices: item.remainingSlices ?? [] };
    }
  }
  return definitions;
}

// BL-493 architect bounce (2026-07-17): the epic's human TITLE, resolved
// through epicDefinitions - never the raw epic id used as a stand-in. An
// epic with no defining ticket yet (epicDefinitions has no entry) falls
// back to its own id, the SAME degrade postEpicUpdateIfApplicable already
// uses for an undocumented epic. epic-less (undefined) stays undefined.
// The single definition both ticketRouteContextFor below AND
// topicReconciliation.ts's reconcileTopicLifecycle resolve a ticket's
// epicTitle through - reconciliation used to stand the raw id in for the
// title directly, which (once ensureEpicTopicId had to CREATE rather than
// reuse the epic's topic) named the live Telegram topic "EPIC — <id>"
// instead of its real title.
export function epicTitleFor(epic: string | undefined, epicDefinitions: Record<string, EpicDefinition>): string | undefined {
  return epic ? (epicDefinitions[epic]?.title ?? epic) : undefined;
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
// BL-449: a REUSED epic topic never touches its icon - only a genuinely
// NEW topic (the 'create' branch) is free to set its initial icon, the
// SAME "isNewTopic" posture syncIconForBacklogId already applies to ticket
// topics. A failed icon call is best-effort here too (syncTopicIcon's own
// outcome is intentionally ignored) - never blocks the epic's opening
// message from posting, mirroring this module's existing "a failed icon
// call is not specially retried" convention.
async function postEpicAction(
  action: TopicAction,
  epicId: string,
  routeAdapters: RouteAdapters,
  iconAdapters: TopicIconAdapters,
  desiredIcon: string
): Promise<boolean> {
  if (action.kind === 'reuse') {
    return routeAdapters.sendMessage(action.topicId, action.text);
  }
  const created = await routeAdapters.createTopic(action.topicName);
  if (!created.success || created.topicId === undefined) {
    return false;
  }
  routeAdapters.recordTopicId(epicId, created.topicId);
  await syncTopicIcon(epicId, created.topicId, desiredIcon, true, iconAdapters);
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
// A ticket declaring no epic, or an event type this side effect doesn't
// apply to, resolves to undefined - split out of postEpicUpdateIfApplicable
// so that function's own branch count reflects only the BL-394 dedup logic,
// not this unrelated applicability guard.
function applicableEpicId(event: SwarmEvent, folders: BacklogFoldersSnapshot): string | undefined {
  if ((event.type !== 'TaskStarted' && event.type !== 'TaskCompleted') || event.backlogId === null) {
    return undefined;
  }
  return epicForBacklogId(folders, event.backlogId);
}

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
  iconAdapters: TopicIconAdapters,
  epicIcons: Record<string, string>,
  alreadyEmitted: Set<string>
): Promise<void> {
  const epicId = applicableEpicId(event, folders);
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
  const posted = await postEpicAction(action, epicId, routeAdapters, iconAdapters, epicIcons[epicId]);
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
// Split out of runConciergeTick's event loop (BL-394 hardening: CRAP was 7 on
// the unsplit function, all pre-existing complexity this ticket's one-line
// alreadyEmitted-threading change happened to surface) so the per-event
// title lookup and post/epic-update decision points are counted separately
// from the tick's two outer loops. Mutates `alreadyEmitted` in place -
// mirrors postEpicUpdateIfApplicable's own contract on the same set -
// and returns whether the event's OWN post succeeded, for the caller's
// routed/unrouted bookkeeping.
// BL-493: the per-ticket context ONLY conciergeTick.ts's folder snapshot can
// resolve - the ticket's epic membership (epicForBacklogId, same lookup
// postEpicUpdateIfApplicable's own applicableEpicId uses) and its CURRENT
// folder/type/humanApproval-derived lifecycle icon state (the SAME
// resolveIconState call syncIconForBacklogId already makes, reused rather
// than re-derived). undefined for ApprovalRequested/untagged events (routeEvent
// never consults it on those branches) or the "should not happen within one
// tick" case of a ticket absent from every folder (mirrors
// syncIconForBacklogId's own folder-undefined guard).
function ticketRouteContextFor(event: SwarmEvent, folders: BacklogFoldersSnapshot, epicDefinitions: Record<string, EpicDefinition>): TicketRouteContext | undefined {
  // BL-493/BL-358: only a ticket lifecycle transition (TaskStarted/
  // TaskCompleted) ever collapses into the ticket's status line -
  // ApprovalRequested keeps its own Approvals-topic routing, and
  // NeedsApproval (tagged or not) always goes to the standing Operator
  // topic instead (routeGateEvent, topicRouter.ts) since it carries a
  // free-text question, not a lifecycle state.
  if ((event.type !== 'TaskStarted' && event.type !== 'TaskCompleted') || event.backlogId === null) {
    return undefined;
  }
  const folder = folderForBacklogId(folders, event.backlogId);
  if (folder === undefined) {
    return undefined;
  }
  const type = typeForBacklogId(folders, event.backlogId);
  const humanApproval = humanApprovalForBacklogId(folders, event.backlogId);
  const epic = epicForBacklogId(folders, event.backlogId);
  return { epic, epicTitle: epicTitleFor(epic, epicDefinitions), iconState: resolveIconState(folder, type, humanApproval) };
}

async function processConciergeEvent(
  event: SwarmEvent,
  folders: BacklogFoldersSnapshot,
  epicDefinitions: Record<string, EpicDefinition>,
  routeAdapters: RouteAdapters,
  iconAdapters: TopicIconAdapters,
  epicIcons: Record<string, string>,
  alreadyEmitted: Set<string>
): Promise<boolean> {
  // BL-493: runs BEFORE the ticket's own status routing below so that, for
  // an epic-bound ticket, the epic topic's FIRST creation always goes
  // through postEpicAction (which sets its icon on create) rather than
  // through routeTicketStatusEvent's own ensureEpicTopicId (which
  // deliberately never touches the icon) - see ensureEpicTopicId's own
  // comment in topicRouter.ts for why this ordering is what makes the two
  // mechanisms safe to share one topic without a competing icon-setter.
  await postEpicUpdateIfApplicable(event, folders, epicDefinitions, routeAdapters, iconAdapters, epicIcons, alreadyEmitted);
  // BL-358: an untagged event has no ticket to look a title up for -
  // routeEvent never uses `title` on that branch (routeUntaggedGateEvent
  // takes no title at all), so the role name is passed through purely for
  // a harmless, honest value rather than a lookup that could never match.
  const title = event.backlogId ? titleForBacklogId(folders, event.backlogId) : (event.role ?? 'unknown');
  const ticketContext = ticketRouteContextFor(event, folders, epicDefinitions);
  const result = await routeEvent(event, title, routeAdapters, ticketContext);
  if (result.posted) {
    alreadyEmitted.add(swarmEventKey(event));
  }
  return result.posted;
}

// BL-414: nowMs defaults to the real clock in production (mirrors
// runOneConciergeTick's own nowMs default in telegram-front-desk-bot.ts);
// tests always pass it explicitly for a deterministic result, per the
// no-real-timers convention. Unused whenever adapters.titleAdapters is
// absent, so existing callers/tests that never touch title-age sync are
// completely unaffected by this default.
export async function runConciergeTick(adapters: ConciergeTickAdapters, nowMs: number = Date.now()): Promise<TickResult> {
  const folders = adapters.readFolders();
  const curr = toEventStreamSnapshot(folders, adapters.readGates(), adapters.readRoleTicket());
  const epicDefinitions = epicDefinitionsFor(folders);
  // BL-449: resolved ONCE per tick (never per-event) so two epics newly
  // created within the SAME tick still see each other in
  // alreadyAssignedIcons and get distinct pool icons.
  const epicIcons = resolveAllEpicIcons(allEpicIdsFor(folders));
  const state = adapters.readTickState();
  const alreadyEmitted = new Set(state.emittedKeys);
  const events = deriveSwarmEvents(state.snapshot, curr, alreadyEmitted);

  // BL-465 bounce: durable per-ticket closure timestamps, stamped once per
  // ticket the first time it's observed done (see stampNewlyDoneClosedAtMs'
  // own docstring for why this is independent of the event-routing retry
  // snapshot below).
  const doneClosedAtMs = stampNewlyDoneClosedAtMs(state.doneClosedAtMs, curr.backlog.done, nowMs);

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
    const posted = await processConciergeEvent(event, folders, epicDefinitions, adapters.routeAdapters, adapters.iconAdapters, epicIcons, alreadyEmitted);
    if (posted) {
      routed += 1;
    } else {
      unrouted.add(swarmEventKey(event));
    }
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

  // BL-418: the standing (non-ticket) topics' own icon sync - see
  // syncStandingTopicIcons' own docstring for why this needs its own
  // durable seen-set rather than reusing topicIdsBeforeTick's approach.
  const standingIconSeenIds = await syncStandingTopicIcons(
    adapters.readStandingTopics?.() ?? [],
    state.standingIconSeenIds,
    adapters.iconAdapters
  );

  // BL-469: the per-agent steering topics' own icon sync - see
  // syncPerAgentTopicIcons' own docstring for why this mirrors the
  // standing-topic sync above exactly, with its own independent seen-set.
  const roleIconSeenIds = await syncPerAgentTopicIcons(adapters.readRoleTopics?.(), state.roleIconSeenIds, adapters.iconAdapters);

  // BL-414: runs over every ticket across all three folders on every tick
  // (never gated on newlyEnteredIds - see syncTitleAgeForBacklogId's own
  // comment for why), starting from the prior tick's durable bucket map so
  // a skip/failure leaves an untouched entry rather than dropping it.
  const titleAgeBuckets = await syncAllTitleAgeBuckets(folders, adapters.routeAdapters.getTopicMap(), nowMs, state.titleAgeBuckets, adapters.titleAdapters);

  // BL-452: the pipeline board's own sync - runs on EVERY tick (never
  // gated on a folder-membership transition, same posture as the title-age
  // sync above), because the change-gate that matters is the rendered TEXT,
  // not any one ticket's transition; syncPipelineBoard owns that gate.
  const pipelineBoard = await syncBoardIfWired(
    folders,
    state.pipelineBoard,
    adapters.boardAdapters,
    adapters.readRoleHeldTickets,
    adapters.readRootIntakeFiles,
    adapters.readRepoBaseUrl,
    nowMs,
    doneClosedAtMs
  );

  // BL-467: enforces the board as the group's ONLY pin - runs right after
  // the board sync above so it always sees this tick's own messageId.
  await syncPinIfWired(pipelineBoard?.messageId, adapters.pinAdapters);

  // BL-434: the Approvals topic's own live roster - fed off curr.pendingApproval
  // (the SAME set this tick already derived ApprovalRequested events from),
  // never a second pending-approval computation.
  const approvalsRoster = await syncApprovalsRosterIfWired(folders, curr.pendingApproval, state.approvalsRoster, adapters.rosterAdapters);

  // BL-450: the Recert topic's own live posting - fed off
  // adapters.readRecertScenario() (recertificationStore.ts's own
  // computeRecertBatch(1) selection), never a second derivation.
  const recertPosted = await syncRecertPostingIfWired(adapters.readRecertScenario?.(), state.recertPosted, adapters.recertPostingAdapters);

  const persistedSnapshot = withRetryableTransitionsHeldBack(curr, unrouted);
  adapters.writeTickState({
    snapshot: persistedSnapshot,
    emittedKeys: [...alreadyEmitted],
    standingIconSeenIds,
    roleIconSeenIds,
    titleAgeBuckets,
    pipelineBoard,
    approvalsRoster,
    recertPosted,
    doneClosedAtMs,
  });
  return { routed };
}
