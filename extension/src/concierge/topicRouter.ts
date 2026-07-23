// BL-297: slice 2 of the BL-295 Concierge refinement - routes each of
// BL-296's Telegram-agnostic SwarmEvents into its backlog item's OWN
// Telegram topic, creating the topic on first sight. This is the
// Telegram-FACING half (BL-296 stays Telegram-agnostic); this module is
// the one place event -> Telegram formatting/topic-routing happens.
//
// Lives in src/concierge/, not src/events/ - the no-notify-from-events
// dependency-cruiser rule (added alongside BL-296) forbids src/events/ from
// importing src/notify/ (createForumTopic/sendTelegramMessage); this module
// needs both SwarmEvent (events/) and the Telegram client (notify/), so it
// is its own layer, never folded into either.
import { SwarmEvent } from '../events/swarmEventStream';
import { InlineKeyboardButton } from '../notify/telegramClient';
import { keyForId } from '../util/inverseLookup';
import { EditInPlaceMessageAdapters, EditInPlaceMessageState, syncEditInPlaceMessage } from './editInPlaceMessageSync';
import { TopicIconState } from './topicIcon';
import { buildTicketStatusText, resolveTicketStatusTarget } from './ticketStatusMessage';

// backlogId -> Telegram forum topic id (message_thread_id) - the reverse
// key direction of the Front Desk Bot's own {topicId: subjectId} map
// (telegramFrontDeskBotCore.ts), a separate, NET-NEW machine-local map, not
// a repurposing of that file.
export type BacklogTopicMap = Record<string, number>;

export function topicNameForItem(backlogId: string, title: string): string {
  return `${backlogId} - ${title}`;
}

// BL-298: the inverse of the forward backlogId->topicId map - given a
// topic id (from an inbound reply's message_thread_id), which backlog item
// (if any) owns that topic. Mirrors telegramFrontDeskBotCore.ts's own
// topicForSubject reverse-lookup shape. Delegates to the shared keyForId
// (util/inverseLookup.ts) rather than carrying its own copy of the same
// 4-line body - jscpd flagged this and roleTopicMapStore.ts's roleForTopic
// as an exact clone (BL-425 cleaner pass).
export function backlogForTopic(topicMap: BacklogTopicMap, topicId: number | undefined): string | undefined {
  return keyForId(topicMap, topicId);
}

// BL-322: a topic opener is a HEADER, not a spec dump - each derived field
// is capped well before Telegram's own 4096-char message limit, and the
// whole composed message gets a second, final cap as a backstop (a ticket
// whose title alone is enormous is not this ticket's problem to solve
// perfectly, just never to send something Telegram would reject).
const TASK_STARTED_FIELD_MAX_LENGTH = 300;
const TASK_STARTED_MESSAGE_MAX_LENGTH = 1000;

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

// An event payload field, when it is a string - the shared shape guard
// every optional payload field (title, notes, firstAcceptanceStep,
// snippet) already needed independently below; extracted rather than
// repeated per field (cleaner review: the repeated inline ternaries also
// pushed taskStartedText's own CRAP over threshold at real coverage).
function stringPayloadField(event: SwarmEvent, field: string): string | undefined {
  const value = event.payload[field];
  return typeof value === 'string' ? value : undefined;
}

// The topic-opening summary's own "what it solves" line: just the FIRST
// paragraph of notes (split on the first blank line), then capped - never
// the whole notes: block, which can run to dozens of lines on a real
// ticket (BL-316's is ~40).
function firstParagraph(text: string): string {
  return text.split(/\n\s*\n/)[0].trim();
}

// The shared shape behind both taskStartedText and approvalRequestedText
// below: a leading line, then zero or more "<label>: <value>" lines for
// whichever optional payload fields are present, each field-capped, the
// whole body then message-capped as a backstop. notes is special-cased to
// its firstParagraph (never the whole notes: block); every other field
// renders its raw value. Extracted (cleaner review, BL-480) once
// approvalRequestedText grew the identical title/notes/firstAcceptanceStep
// shape taskStartedText already had, plus one more optional field -
// carrying that as two near-duplicate function bodies would have DRY'd
// worse with every future field either one grows.
function buildSummaryBody(event: SwarmEvent, leadingLine: string, fields: Array<{ label: string; field: string }>): string {
  const lines = [leadingLine];
  for (const { label, field } of fields) {
    const value = stringPayloadField(event, field);
    if (value) {
      const text = field === 'notes' ? firstParagraph(value) : value;
      lines.push(`${label}: ${truncate(text, TASK_STARTED_FIELD_MAX_LENGTH)}`);
    }
  }
  return truncate(lines.join('\n'), TASK_STARTED_MESSAGE_MAX_LENGTH);
}

// BL-322: a TaskStarted event's payload (diffTaskStarted's own
// taskStartedPayload) carries {title, notes?, firstAcceptanceStep?} when a
// ticket summary was resolved, {} when it degraded (should not happen
// within one tick, but never a crash) - the {} case falls back to the
// pre-BL-322 bare "TaskStarted: BL-XXX" line, the ONE shape this function
// can compose with no real data at all.
function taskStartedText(event: SwarmEvent): string {
  const title = stringPayloadField(event, 'title');
  if (!title) {
    return `${event.type}: ${event.backlogId}`;
  }
  return buildSummaryBody(event, `What it is: ${title}`, [
    { label: 'What it solves', field: 'notes' },
    { label: 'How it works', field: 'firstAcceptanceStep' },
  ]);
}

// Human-readable, but always contains the event's own type verbatim - the
// posted message must "name the event" (topic-routing-03), and never a
// silently-drifting label that could stop matching a real SwarmEventType.
//
// BL-322: TaskStarted gets its own richer render (taskStartedText above) -
// a what-it-is/what-it-solves/how-it-works summary instead of a bare
// "TaskStarted: BL-XXX" line, derived from the ticket YAML already on
// disk. TaskCompleted/NeedsApproval are UNCHANGED (regression, topic-
// opening-summary-04) - only TaskStarted's own rendering branch is new.
//
// BL-325: a NeedsApproval event's payload.snippet (when present - the
// gated role's own question text) is appended, so the message states WHAT
// is being asked rather than just the ticket id (the ticket's own
// human-in-the-loop-closed-01 scenario). Every other event type carries no
// snippet and keeps the exact prior text.
//
// BL-358: an untagged NeedsApproval (backlogId null) names its role instead
// of a ticket id - "NeedsApproval: coder - <question>" - the ONE formatter
// every event still goes through, tagged or not.
// BL-357: an ApprovalRequested's own text is the ask itself, not a bare
// "ApprovalRequested: BL-XXX" label like the other event types - the human
// is reading this directly and needs to know what to reply. "approve" is
// the exact keyword pendingApprovalReply.ts's isApprovalReplyText matches,
// stated here so the instruction and the recognizer never drift apart.
//
// BL-434: now NAMES the ticket id ("approve BL-123", not bare "approve") -
// the ask posts into the ONE standing Approvals topic (routeEvent below),
// which carries every ticket's ask at once, so a reply must name which
// ticket it targets; pendingApprovalReply.ts's classifyApprovalsTopicReply
// is the exact recognizer for this id-qualified grammar (the Approvals
// topic's own sibling of isApprovalReplyText above, which still governs the
// per-ticket-topic reply grammar unchanged elsewhere).
//
// BL-480: this sentence is now the FROZEN tail of a richer ask, not the
// whole text - reply-grammar clause and "needs your approval" substring both
// preserved byte-for-byte (the reply grammar per BL-357/434's own frozen
// contract; the "needs your approval" phrase because five sibling step
// files - bl408/409/410/434, pendingApprovalAsksInTopicSteps.js - locate the
// posted ask by that exact substring). Kept as its own function so the
// frozen string has one definition, read both when composing the enriched
// text below and when a summary-less ticket falls back to it verbatim.
function frozenApprovalAskLine(id: string): string {
  return `${id} needs your approval before it can proceed. Reply here with "approve ${id}" (or "reject ${id} <reason>") to act.`;
}

// BL-480: the Approvals-topic ask used to carry ONLY the frozen line above -
// enough to reply to, nothing to decide from. Mirrors taskStartedText's own
// title/what-it-solves/how-it-works shape via the same buildSummaryBody
// helper, plus a fourth field for approvalContext (BL-479's field, parsed
// end-to-end through backlogReader.ts -> conciergeTick.ts's
// ticketSummariesFor -> diffApprovalRequested's payload). The frozen line
// is appended AFTER buildSummaryBody's own message-cap truncate, never
// inside it, so a truly oversized notes: block can only ever eat into the
// enrichment body - the reply-grammar clause and the "needs your approval"
// locator substring always survive intact, satisfying
// approval-ask-content-04's truncation case without also breaking -02's
// byte-identical requirement.
function approvalRequestedText(event: SwarmEvent): string {
  const id = event.backlogId ?? 'unknown';
  const frozen = frozenApprovalAskLine(id);
  const title = stringPayloadField(event, 'title');
  if (!title) {
    return frozen;
  }
  const body = buildSummaryBody(event, `${id} — ${title}`, [
    { label: 'What it solves', field: 'notes' },
    { label: 'First acceptance signal', field: 'firstAcceptanceStep' },
    { label: 'Approval context', field: 'approvalContext' },
  ]);
  return `${body}\n${frozen}`;
}

export function messageTextForEvent(event: SwarmEvent): string {
  if (event.type === 'TaskStarted') {
    return taskStartedText(event);
  }
  if (event.type === 'ApprovalRequested') {
    return approvalRequestedText(event);
  }
  const identity = event.backlogId ?? event.role ?? 'unknown';
  const base = `${event.type}: ${identity}`;
  const snippet = stringPayloadField(event, 'snippet');
  return snippet ? `${base} - ${snippet}` : base;
}

// BL-410: an ApprovalRequested message's one-tap alternative to typing a
// reply - Approve/Amend/Reject, callback_data-tagged with the SAME verb
// telegramFrontDeskBotCore.ts's decideCallbackQueryAction parses, so the tap
// routes to the identical recordApprovalReply/recordRejectionReply/pending-
// amend effects a typed reply already triggers, never a second effect path.
// Every other event type gets no buttons (undefined) - decideTopicAction
// below only attaches this field to its TopicAction when non-undefined, so
// every existing TaskStarted/NeedsApproval/TaskCompleted shape is unaffected.
// BL-490: a fourth verb, Expedite - approve + force-promote paused->active +
// dispatch to build now, bypassing the coordinator's sequencing triage.
// Routed through the SAME callback_data namespace/round-trip as the other
// three (decideCallbackQueryAction's CALLBACK_DATA_PATTERN in
// telegramFrontDeskBotCore.ts), never a second callback path.
function approvalRequestedButtons(backlogId: string): InlineKeyboardButton[][] {
  return [
    [
      { text: 'Approve', callbackData: `approve:${backlogId}` },
      { text: 'Amend', callbackData: `amend:${backlogId}` },
      { text: 'Reject', callbackData: `reject:${backlogId}` },
      { text: 'Expedite', callbackData: `expedite:${backlogId}` },
    ],
    // More: full spec + Gherkin in an in-topic follow-up (Telegram alert
    // text is ~200 chars — too small for APS prose). Second row keeps the
    // four decision verbs on one thumb-reachable line.
    [{ text: 'More', callbackData: `more:${backlogId}` }],
  ];
}

function messageButtonsForEvent(event: SwarmEvent): InlineKeyboardButton[][] | undefined {
  return event.type === 'ApprovalRequested' && event.backlogId !== null ? approvalRequestedButtons(event.backlogId) : undefined;
}

// BL-299: distinct from messageTextForEvent's generic progress line - the
// final message posted into a topic before it closes, naming the item.
// Kept lean/swarm-agnostic (event + title only) - richer content (PR link,
// metrics) needs a richer SwarmEvent payload, out of this ticket's scope
// (BL-296 shipped payload {}).
export function completionSummaryText(event: SwarmEvent, title: string): string {
  // TaskCompleted is always tagged (diffTaskCompleted only ever fires for a
  // real backlog id) - the fallback never actually triggers, same posture
  // as routeCompletionEvent's own guard above.
  const backlogId = event.backlogId ?? 'unknown';
  return `${topicNameForItem(backlogId, title)} is complete.`;
}

export type TopicAction =
  | { kind: 'reuse'; topicId: number; text: string; buttons?: InlineKeyboardButton[][] }
  | { kind: 'create'; topicName: string; text: string; buttons?: InlineKeyboardButton[][] };

// Pure: given the event, the CURRENT backlog_id->topic map, and the item's
// title, decides whether to reuse an already-mapped topic or create a new
// one - no I/O, directly testable with a plain fixture map. Only ever
// called for a TAGGED event (backlogId non-null) - routeEvent below routes
// an untagged NeedsApproval through routeUntaggedGateEvent instead, before
// this function is ever reached; the throw here guards that invariant
// rather than silently indexing the map with "null".
export function decideTopicAction(event: SwarmEvent, topicMap: BacklogTopicMap, title: string): TopicAction {
  const { backlogId } = event;
  if (backlogId === null) {
    throw new Error('decideTopicAction requires a tagged event - route an untagged NeedsApproval via routeUntaggedGateEvent instead');
  }
  const text = messageTextForEvent(event);
  const buttons = messageButtonsForEvent(event);
  const existingTopicId = topicMap[backlogId];
  if (existingTopicId !== undefined) {
    return { kind: 'reuse', topicId: existingTopicId, text, ...(buttons ? { buttons } : {}) };
  }
  return { kind: 'create', topicName: topicNameForItem(backlogId, title), text, ...(buttons ? { buttons } : {}) };
}

// BL-341: an epic's topic is looked up through the SAME BacklogTopicMap a
// ticket topic uses - never a second parallel map (the ticket's own
// explicit instruction; mirrors decideTopicAction's own reuse-or-create
// shape, keyed by the epic's own id instead of a BL-### id, the same
// posture BL-358's standing Operator topic already established for a
// non-ticket key sharing this map). "EPIC — " prefixes the created topic's
// name so it reads distinctly from a per-ticket topic in Telegram's own
// topic list.
export function epicTopicName(epicTitle: string): string {
  return `EPIC — ${epicTitle}`;
}

export function decideEpicTopicAction(epicId: string, epicTitle: string, topicMap: BacklogTopicMap, text: string): TopicAction {
  const existingTopicId = topicMap[epicId];
  if (existingTopicId !== undefined) {
    return { kind: 'reuse', topicId: existingTopicId, text };
  }
  return { kind: 'create', topicName: epicTopicName(epicTitle), text };
}

export interface RouteAdapters {
  getTopicMap: () => BacklogTopicMap;
  createTopic: (name: string) => Promise<{ success: boolean; topicId?: number }>;
  recordTopicId: (backlogId: string, topicId: number) => void;
  sendMessage: (topicId: number, text: string, buttons?: InlineKeyboardButton[][]) => Promise<boolean>;
  // BL-299: closes a topic (read-only, history preserved - never delete,
  // which would destroy the summary just posted). Only ever called with a
  // concrete topicId (NEVER-MAIN-CHAT holds here too - there is no
  // "close the main chat" notion).
  closeTopic: (topicId: number) => Promise<boolean>;
  // BL-329: serialises this outbound send into the ticket's own durable
  // record (blTopicStore.ts) - called ONLY after a successful sendMessage,
  // mirroring emittedKeys' own "only record what genuinely posted"
  // convention (BL-322). backlogId is always available here directly, no
  // topic-id reverse lookup needed.
  recordMessage: (backlogId: string, text: string) => void;
  // BL-358: resolves (creating on first use) the ONE standing Operator
  // topic's id - the destination for a NeedsApproval whose gated role
  // holds no ticket. Mirrors telegramFrontDeskBotCore.ts's own
  // decideEnsureOperatorTopicAction reuse-or-create shape; wired live to
  // the SAME {topicId: subjectId}/OPERATOR_SUBJECT_ID binding the
  // front-desk bot's own ensureOperatorTopic already maintains - never a
  // second Operator-topic notion. undefined only when creation itself
  // failed (degrades to a skipped route, same as a failed createTopic
  // above - never a fallback post anywhere else).
  ensureOperatorTopic: () => Promise<number | undefined>;
  // BL-434: resolves (creating on first use) the ONE standing Approvals
  // topic's id - the destination for EVERY ApprovalRequested ask, replacing
  // the old per-ticket-topic post (a single topic now carries every
  // ticket's ask, plus the live pending-approval roster). Mirrors
  // ensureOperatorTopic's own reuse-or-create shape immediately above;
  // undefined only when creation itself failed (degrades to a skipped
  // route, same posture as a failed createTopic/ensureOperatorTopic).
  ensureApprovalsTopic: () => Promise<number | undefined>;
  // BL-484: posts the approval ask and reports its Telegram message_id -
  // the ordinary sendMessage above only ever reports success/failure. The
  // decision-recording path (telegramFrontDeskBotCore.ts's
  // processCallbackQuery/deliverOperatorContext/deliverApprovalsTopicReply
  // - a SEPARATE poll-loop subsystem from this tick) needs this id later,
  // to edit the exact posted message in place (strip its buttons, append
  // the verdict) once a decision is recorded. Optional and additive:
  // absent, routeApprovalRequestedEvent below falls back to the ordinary
  // sendMessage/recordMessage path with no id ever captured, so no closing
  // edit fires for that ask - the same "new capability is an optional
  // adapter, absent degrades to the prior behavior" posture every other
  // adapter in this interface already has (ensureApprovalsTopic et al.).
  sendApprovalAsk?: (topicId: number, text: string, buttons: InlineKeyboardButton[][]) => Promise<{ success: boolean; messageId?: number }>;
  // Persists the id sendApprovalAsk reported (plus the exact ask TEXT, so
  // the closing routine can compose "original text + decision line"
  // without a second lookup), keyed by backlogId, for the poll loop to
  // read back later. Called only after a successful sendApprovalAsk that
  // reported a concrete messageId - a success with no messageId (should
  // not happen in practice, but degrades safely) simply never gets a
  // closing edit, same as sendApprovalAsk being absent.
  recordApprovalAskMessageId?: (backlogId: string, topicId: number, messageId: number, text: string) => void;
  // BL-493: resolves (creating on first use) the ONE standing Backlog
  // topic's id (BL-492's ensureBacklogTopic) - the destination for an
  // epic-LESS ticket's edit-in-place status message. Mirrors
  // ensureOperatorTopic/ensureApprovalsTopic's own reuse-or-create shape;
  // undefined only when creation itself failed, same degrade-to-skipped
  // posture as every other ensure* adapter above.
  ensureBacklogTopic: () => Promise<number | undefined>;
  // BL-493: posts a NEW message and reports its Telegram message_id - the
  // edit-in-place sibling of sendMessage above (which only ever reports
  // success/failure, never an id to edit later). Generic over topicId
  // (never bound to one fixed topic), the same shape
  // EditInPlaceMessageAdapters.postMessage already requires.
  postMessage: (topicId: number, text: string) => Promise<number | undefined>;
  // BL-493: edits an already-posted message in place - the other half of
  // the edit-in-place pair above.
  editMessage: (topicId: number, messageId: number, text: string) => Promise<boolean>;
  // BL-493: reads/writes the per-ticket edit-in-place message identity
  // (ticketMessageMapStore.ts's ticket-message-map.json) - so a later
  // lifecycle transition edits the SAME status message rather than posting
  // a new one. Mirrors getTopicMap/recordTopicId's own read/write pairing
  // above, one level more specific (per-ticket message identity, not just
  // per-ticket topic identity).
  getTicketMessageState: (backlogId: string) => EditInPlaceMessageState | undefined;
  setTicketMessageState: (backlogId: string, state: EditInPlaceMessageState) => void;
}

export interface RouteResult {
  posted: boolean;
  skipped: boolean;
}

// BL-358/BL-493: NeedsApproval's own routing path, tagged or not - a role
// blocked mid-task is asking its OWN question (e.g. "which design should I
// pick?"), never a ticket lifecycle transition, so it never collapses into
// the ticket's terse edit-in-place status line (which carries no room for
// free-text content) - it goes to the ONE standing Operator topic instead,
// the same destination an untagged gate (holds no ticket) always used.
// BL-493 (human decision, 2026-07-17): previously a TAGGED NeedsApproval
// posted into the ticket's own per-ticket topic (decideTopicAction) - now
// that no per-ticket topic exists, routing it into the generic ticket-
// status line would silently lose the role's actual question with no
// human-reachable trace at all (BL-358's own existing contract: the human
// must be asked the role's question). The standing Operator topic already
// carries every untagged question; a tagged one differs only in that its
// text also names the ticket id (messageTextForEvent's own existing
// backlogId-first identity), keeping the ticket association legible
// without a second topic. A tagged event's message IS still serialised
// into that ticket's own durable record (recordMessage) - unlike a
// genuinely untagged one, which belongs to no ticket to record into.
async function routeGateEvent(event: SwarmEvent, adapters: RouteAdapters): Promise<RouteResult> {
  const topicId = await adapters.ensureOperatorTopic();
  if (topicId === undefined) {
    return { posted: false, skipped: true };
  }
  const text = messageTextForEvent(event);
  const ok = await adapters.sendMessage(topicId, text);
  if (ok && event.backlogId !== null) {
    adapters.recordMessage(event.backlogId, text);
  }
  return { posted: ok, skipped: false };
}

// BL-329: routeEvent's own two branches (reuse an existing topic, or send
// into a freshly created one) both end with the identical "send, then
// record only on success" sequence - extracted rather than repeated
// (cleaner review: the duplication was also what pushed routeEvent's own
// CRAP over threshold at full coverage).
async function sendAndRecord(
  topicId: number,
  text: string,
  backlogId: string,
  adapters: RouteAdapters,
  buttons?: InlineKeyboardButton[][]
): Promise<boolean> {
  const ok = await adapters.sendMessage(topicId, text, buttons);
  if (ok) {
    adapters.recordMessage(backlogId, text);
  }
  return ok;
}

// BL-434: ApprovalRequested's own routing path - replaces the old per-
// ticket-topic reuse/create (decideTopicAction) now that ONE standing
// Approvals topic carries every ticket's ask. Still a TAGGED event
// (backlogId non-null - pendingApprovalFor, swarmEventStream.ts, only ever
// emits it for a real ticket id), so sendAndRecord still serialises the ask
// into the ticket's own durable record (blTopicStore) exactly as before -
// only the DESTINATION topic changes.
// BL-484: sendApprovalAsk's own send-then-record sequence - mirrors
// sendAndRecord's shape exactly, but additionally captures the posted
// message's id (via recordApprovalAskMessageId) on a successful send that
// reports one, so the decision-recording path can later edit this exact
// message. Split out for the same reason sendAndRecord itself was: keeps
// routeApprovalRequestedEvent's own branch count low.
async function sendApprovalAskAndRecord(
  topicId: number,
  text: string,
  backlogId: string,
  adapters: RouteAdapters,
  buttons: InlineKeyboardButton[][]
): Promise<boolean> {
  const result = await adapters.sendApprovalAsk!(topicId, text, buttons);
  if (result.success) {
    adapters.recordMessage(backlogId, text);
    if (result.messageId !== undefined) {
      adapters.recordApprovalAskMessageId?.(backlogId, topicId, result.messageId, text);
    }
  }
  return result.success;
}

// BL-493 (human decision D3): the icon-only per-ticket-topic ensure
// (formerly ensurePerTicketTopicForIcon here) is DELETED - awaiting-approval
// already renders in the standing Approvals topic below, so no throwaway
// per-ticket topic is minted just to hang an icon on, and no awaiting
// indicator is added to the ticket's epic/Backlog status line either (see
// ticketStatusMessage.ts's own comment on why 'awaiting-approval' never
// reaches that builder in practice).
async function routeApprovalRequestedEvent(event: SwarmEvent, title: string, adapters: RouteAdapters): Promise<RouteResult> {
  if (event.backlogId === null) {
    return { posted: false, skipped: true };
  }
  const topicId = await adapters.ensureApprovalsTopic();
  if (topicId === undefined) {
    return { posted: false, skipped: true };
  }
  const text = messageTextForEvent(event);
  const buttons = messageButtonsForEvent(event);
  const ok = adapters.sendApprovalAsk
    ? await sendApprovalAskAndRecord(topicId, text, event.backlogId, adapters, buttons!)
    : await sendAndRecord(topicId, text, event.backlogId, adapters, buttons);
  return { posted: ok, skipped: false };
}

// BL-493: an epic-bound ticket's status message ensures its EPIC topic
// (create-or-reuse against the SAME BacklogTopicMap decideEpicTopicAction
// already targets) - never touching its icon here. Icon-on-create for a
// genuinely NEW epic topic is owned entirely by conciergeTick.ts's own
// postEpicUpdateIfApplicable/postEpicAction, which conciergeTick.ts's
// processConciergeEvent now runs BEFORE this routing for every applicable
// event (TaskStarted/TaskCompleted always precede any other tagged event for
// the same ticket, so by the time a ticket-status message ever needs the
// epic topic, either that epic-progress path already created+iconed it, or
// this call becomes the FIRST creator and simply leaves the icon unset,
// exactly as syncIconForBacklogId already degrades for a topic with no icon
// touch yet - never a second, competing icon-setting mechanism here).
async function ensureEpicTopicId(epicId: string, epicTitle: string, adapters: RouteAdapters): Promise<number | undefined> {
  const existingTopicId = adapters.getTopicMap()[epicId];
  if (existingTopicId !== undefined) {
    return existingTopicId;
  }
  const created = await adapters.createTopic(epicTopicName(epicTitle));
  if (!created.success || created.topicId === undefined) {
    return undefined;
  }
  adapters.recordTopicId(epicId, created.topicId);
  return created.topicId;
}

// BL-493: the per-ticket context routeTicketStatusEvent needs and only
// conciergeTick.ts can resolve (the ticket's epic membership and its
// CURRENT folder/type/humanApproval-derived lifecycle icon state) - threaded
// into routeEvent the same way `title` already is, rather than this module
// reaching into a folder snapshot itself.
export interface TicketRouteContext {
  epic?: string;
  epicTitle?: string;
  iconState: TopicIconState;
}

// BL-493: THE new ticket-event routing path - replaces the old per-ticket
// topic create/reuse (decideTopicAction/routeTaggedOrUntaggedEvent) and the
// old TaskCompleted summary-then-close (routeCompletionEvent) with ONE
// mechanism: an edit-in-place status message ("BL-### <glyph> <state> —
// <title>"), targeting the ticket's epic topic (epic-bound) or the standing
// Backlog topic (epic-less, BL-492), reused via syncEditInPlaceMessage
// rather than reinvented. No per-ticket topic is ever created here (BL-493
// acceptance scenario 04). The persisted {topicId, messageId} is written
// back regardless of outcome, mirroring syncEditInPlaceMessage's own
// "advance only on success, otherwise retry against the same stale state"
// contract.
async function routeTicketStatusEvent(
  backlogId: string,
  title: string,
  context: TicketRouteContext,
  adapters: RouteAdapters
): Promise<RouteResult> {
  const target = resolveTicketStatusTarget(context.epic);
  const text = buildTicketStatusText(backlogId, title, context.iconState);
  const prevState = adapters.getTicketMessageState(backlogId);
  const editAdapters: EditInPlaceMessageAdapters = {
    ensureTopic: () =>
      target.kind === 'epic' ? ensureEpicTopicId(target.epicId, context.epicTitle ?? target.epicId, adapters) : adapters.ensureBacklogTopic(),
    postMessage: adapters.postMessage,
    editMessage: adapters.editMessage,
  };
  const result = await syncEditInPlaceMessage(text, prevState, editAdapters);
  adapters.setTicketMessageState(backlogId, result.state);
  if (result.outcome === 'posted' || result.outcome === 'edited') {
    adapters.recordMessage(backlogId, text);
    return { posted: true, skipped: false };
  }
  // 'skipped-unchanged' is a SUCCESS (the status line already reflects
  // reality - nothing to retry), never treated as a failed route.
  if (result.outcome === 'skipped-unchanged') {
    return { posted: true, skipped: false };
  }
  if (result.outcome === 'failed-no-topic') {
    return { posted: false, skipped: true };
  }
  return { posted: false, skipped: false };
}

// Adapter-injected: routes one event end to end. NEVER-MAIN-CHAT is a
// structural guarantee, not a runtime check - sendMessage's own signature
// requires a concrete topicId, so there is no code path in this function
// that can call it without one. When topic creation fails (no supergroup,
// rate-limited, etc.) the event is skipped - never a fallback post to a
// main chat that does not exist in this function's adapter surface at all.
// BL-493: `ticketContext` carries the epic/icon-state resolution only
// conciergeTick.ts's folder snapshot can supply - every production call for
// a TaskStarted/TaskCompleted event now provides it (see conciergeTick.ts's
// ticketRouteContextFor); its absence degrades to a skipped route rather
// than guessing, the same defensive posture a failed createTopic already
// has elsewhere in this module.
export async function routeEvent(event: SwarmEvent, title: string, adapters: RouteAdapters, ticketContext?: TicketRouteContext): Promise<RouteResult> {
  // BL-434: routed to the standing Approvals topic - checked first, though
  // ApprovalRequested is always tagged in practice; this keeps the dispatch
  // order explicit rather than relying on that invariant holding silently.
  if (event.type === 'ApprovalRequested') {
    return routeApprovalRequestedEvent(event, title, adapters);
  }
  // BL-358/BL-493: NeedsApproval never collapses into the ticket's status
  // line (see routeGateEvent's own comment for why) - tagged or untagged,
  // it always goes to the standing Operator topic.
  if (event.type === 'NeedsApproval') {
    return routeGateEvent(event, adapters);
  }
  if (event.backlogId === null) {
    // TaskStarted/TaskCompleted are always tagged in practice - never
    // actually reached, but degrades to the Operator topic rather than
    // guessing if that invariant is ever loosened upstream.
    return routeGateEvent(event, adapters);
  }
  if (!ticketContext) {
    return { posted: false, skipped: true };
  }
  return routeTicketStatusEvent(event.backlogId, title, ticketContext, adapters);
}
