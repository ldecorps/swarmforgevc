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
// topicForSubject reverse-lookup shape.
export function backlogForTopic(topicMap: BacklogTopicMap, topicId: number | undefined): string | undefined {
  if (topicId === undefined) {
    return undefined;
  }
  const found = Object.entries(topicMap).find(([, tid]) => tid === topicId);
  return found ? found[0] : undefined;
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
  const notes = stringPayloadField(event, 'notes');
  const firstAcceptanceStep = stringPayloadField(event, 'firstAcceptanceStep');
  const lines = [`What it is: ${title}`];
  if (notes) {
    lines.push(`What it solves: ${truncate(firstParagraph(notes), TASK_STARTED_FIELD_MAX_LENGTH)}`);
  }
  if (firstAcceptanceStep) {
    lines.push(`How it works: ${truncate(firstAcceptanceStep, TASK_STARTED_FIELD_MAX_LENGTH)}`);
  }
  return truncate(lines.join('\n'), TASK_STARTED_MESSAGE_MAX_LENGTH);
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
export function messageTextForEvent(event: SwarmEvent): string {
  if (event.type === 'TaskStarted') {
    return taskStartedText(event);
  }
  const base = `${event.type}: ${event.backlogId}`;
  const snippet = stringPayloadField(event, 'snippet');
  return snippet ? `${base} - ${snippet}` : base;
}

// BL-299: distinct from messageTextForEvent's generic progress line - the
// final message posted into a topic before it closes, naming the item.
// Kept lean/swarm-agnostic (event + title only) - richer content (PR link,
// metrics) needs a richer SwarmEvent payload, out of this ticket's scope
// (BL-296 shipped payload {}).
export function completionSummaryText(event: SwarmEvent, title: string): string {
  return `${topicNameForItem(event.backlogId, title)} is complete.`;
}

export type TopicAction =
  | { kind: 'reuse'; topicId: number; text: string }
  | { kind: 'create'; topicName: string; text: string };

// Pure: given the event, the CURRENT backlog_id->topic map, and the item's
// title, decides whether to reuse an already-mapped topic or create a new
// one - no I/O, directly testable with a plain fixture map.
export function decideTopicAction(event: SwarmEvent, topicMap: BacklogTopicMap, title: string): TopicAction {
  const text = messageTextForEvent(event);
  const existingTopicId = topicMap[event.backlogId];
  if (existingTopicId !== undefined) {
    return { kind: 'reuse', topicId: existingTopicId, text };
  }
  return { kind: 'create', topicName: topicNameForItem(event.backlogId, title), text };
}

export interface RouteAdapters {
  getTopicMap: () => BacklogTopicMap;
  createTopic: (name: string) => Promise<{ success: boolean; topicId?: number }>;
  recordTopicId: (backlogId: string, topicId: number) => void;
  sendMessage: (topicId: number, text: string) => Promise<boolean>;
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
}

export interface RouteResult {
  posted: boolean;
  skipped: boolean;
}

// BL-299: TaskCompleted gets its OWN routing path, never decideTopicAction's
// reuse-or-CREATE logic - an item that completed with no topic ever mapped
// has nothing to summarize and gets no topic created just to immediately
// close it (a no-op, mirroring routeEvent's own create-failure skip shape).
// ORDER MATTERS: the summary is posted into the topic BEFORE it closes (a
// closed topic can no longer be posted into) - close only follows a
// successful post, never an attempted one.
async function routeCompletionEvent(event: SwarmEvent, title: string, adapters: RouteAdapters): Promise<RouteResult> {
  const topicId = adapters.getTopicMap()[event.backlogId];
  if (topicId === undefined) {
    return { posted: false, skipped: true };
  }
  const text = completionSummaryText(event, title);
  const ok = await adapters.sendMessage(topicId, text);
  if (ok) {
    adapters.recordMessage(event.backlogId, text);
    await adapters.closeTopic(topicId);
  }
  return { posted: ok, skipped: false };
}

// Adapter-injected: routes one event end to end. NEVER-MAIN-CHAT is a
// structural guarantee, not a runtime check - sendMessage's own signature
// requires a concrete topicId, so there is no code path in this function
// that can call it without one. When topic creation fails (no supergroup,
// rate-limited, etc.) the event is skipped - never a fallback post to a
// main chat that does not exist in this function's adapter surface at all.
export async function routeEvent(event: SwarmEvent, title: string, adapters: RouteAdapters): Promise<RouteResult> {
  if (event.type === 'TaskCompleted') {
    return routeCompletionEvent(event, title, adapters);
  }
  const action = decideTopicAction(event, adapters.getTopicMap(), title);
  if (action.kind === 'reuse') {
    const ok = await adapters.sendMessage(action.topicId, action.text);
    if (ok) {
      adapters.recordMessage(event.backlogId, action.text);
    }
    return { posted: ok, skipped: false };
  }
  const created = await adapters.createTopic(action.topicName);
  if (!created.success || created.topicId === undefined) {
    return { posted: false, skipped: true };
  }
  adapters.recordTopicId(event.backlogId, created.topicId);
  const ok = await adapters.sendMessage(created.topicId, action.text);
  if (ok) {
    adapters.recordMessage(event.backlogId, action.text);
  }
  return { posted: ok, skipped: false };
}
