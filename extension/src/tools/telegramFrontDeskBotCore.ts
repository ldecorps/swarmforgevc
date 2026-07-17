// BL-281: pure decision logic + adapter-injected orchestration for the
// Telegram Front Desk Bot (a bridge client, never coupled to the Operator
// runtime directly) - principal filtering, topic demux, and the poll-then-
// forward decision, all testable with fixture updates/fake adapters and no
// live Telegram/network. telegram-front-desk-bot.ts is the thin,
// untested-boundary process that injects the real adapters (real
// getUpdates, a real fetch POST to the bridge, the real persisted topic
// map) into pollAndForward below.
import { TelegramUpdate, TelegramCallbackQuery, TelegramPollAnswer, GetUpdatesResult, InlineKeyboardButton, EditMessageTextResult } from '../notify/telegramClient';
import { computeTelegramRetryBackoffMs } from '../notify/telegramRetry';
import { classifyApprovalReplyAction, classifyApprovalsTopicReply } from '../concierge/pendingApprovalReply';
import { ApprovalDecisionVerdict, composeDecidedAskText, alreadyDecidedToastText } from '../concierge/approvalAskClosing';
import { classifyRecertTopicReply } from '../concierge/recertTopicReply';
import { roleForTopic } from '../concierge/roleTopicMapStore';
import { ControlEvent, ControlDecision, PendingControlConfirm, PauseState, decideControlEventAction } from './telegramControlCore';

// BL-353: moved from the retired notify/telegramInboundRelay.ts (which
// also carried the legacy single-chat TelegramInboundRelay class, now
// deleted) - this is a generic getUpdates-offset utility the REAL
// front-desk bot's own poll loop needs, unrelated to the relay class that
// used to sit next to it.
export function nextUpdateOffset(updates: TelegramUpdate[], currentOffset: number): number {
  return updates.reduce((max, u) => Math.max(max, u.update_id + 1), currentOffset);
}

export function isFromPrincipal(update: TelegramUpdate, principalUserId: string): boolean {
  const fromId = update.message?.from?.id;
  return fromId !== undefined && String(fromId) === String(principalUserId);
}

// BL-379: the message's own chat, already parsed and typed
// (TelegramMessage.chat, telegramClient.ts) - the ONE field
// decideUpdateAction never consulted before this. Telegram's own
// getUpdates is scoped to the BOT, not the chat: it returns updates from
// EVERY chat the bot is in, so filtering on sender alone lets a second
// project's chat (the bot added to a stray group) silently cross-wire its
// messages into this project's own support threads via BL-294's
// auto-adopt - the same loss class as BL-369/370/371.
export function isFromMyChat(update: TelegramUpdate, chatId: string): boolean {
  const updateChatId = update.message?.chat?.id;
  return updateChatId !== undefined && String(updateChatId) === String(chatId);
}

export function topicIdOf(update: TelegramUpdate): number | undefined {
  return update.message?.message_thread_id;
}

export function messageTextOf(update: TelegramUpdate): string | undefined {
  return update.message?.text;
}

// BL-294: the reserved topic-map key a private DM (no message_thread_id,
// topicIdOf undefined) resolves through - the SAME map/lookup mechanism a
// real topic id uses, just one sentinel key wide, so a DM "degenerates to
// the single default subject" (the ticket's own wording) without a second
// map or a second code path.
export const DEFAULT_SUBJECT_KEY = '__default__';

// Pure lookups over the bot's own persisted {topicId: subjectId} map (read
// by the caller) - subjectForTopic drives inbound demux (topic-topic-01/
// -02, auto-open-01/02/03), topicForSubject drives the reply relay
// (telegram-topic-03): given a reply tagged by SUP-### subject id, which
// Telegram topic does it go back into.
export function subjectForTopic(topicMap: Record<string, string>, topicId: number | undefined): string | undefined {
  return topicMap[topicId === undefined ? DEFAULT_SUBJECT_KEY : String(topicId)];
}

// A subject opened from a DM (mapped under DEFAULT_SUBJECT_KEY, not a real
// topic id) has no Telegram topic to reply into - returns undefined rather
// than Number(DEFAULT_SUBJECT_KEY) (NaN), which relaySseReplies would
// otherwise treat as "mapped" and forward a corrupt message_thread_id.
export function topicForSubject(topicMap: Record<string, string>, subjectId: string): number | undefined {
  const found = Object.entries(topicMap).find(([key, sid]) => sid === subjectId && key !== DEFAULT_SUBJECT_KEY);
  return found ? Number(found[0]) : undefined;
}

// BL-355: true when a subject's DM/General-topic origin was ALSO recorded
// under DEFAULT_SUBJECT_KEY - i.e. General has, at some point, been a live
// place this subject was discussed from, distinct from whether it ALSO has
// a real dedicated topic (topicForSubject above).
export function hasDefaultBinding(topicMap: Record<string, string>, subjectId: string): boolean {
  return topicMap[DEFAULT_SUBJECT_KEY] === subjectId;
}

// BL-325: a reply's threadId may name either a SUP-### support subject
// (topicForSubject's own {topicId: subjectId} map) or a BL-### backlog
// item (the SEPARATE, forward backlogId->topicId map - no reversal
// needed). Tries the SUP map first so every existing SUP thread keeps its
// exact prior resolution/priority; falls back to the backlog map only when
// the SUP map has no match. The two id spaces never collide (SUP-### vs
// BL-###), so this is the "extend the egress to accept a BL-### target"
// half of the loop - the SAME reply-outbox entries operator_reply.bb,
// operator_notify.bb, and operator-decide.js's approve relay all already
// write now reach a BL topic through this one resolver, no second egress
// path.
export function resolveReplyTopicId(
  topicMap: Record<string, string>,
  backlogTopicMap: Record<string, number>,
  threadId: string
): number | undefined {
  const supTopicId = topicForSubject(topicMap, threadId);
  return supTopicId !== undefined ? supTopicId : backlogTopicMap[threadId];
}

// BL-355: the reply relay's destination decision, replacing a bare topic id
// with an explicit outcome so "no real topic bound" and "deliver, but ALSO
// tell General" are distinguishable instead of collapsing to one undefined.
//
// A subject bound to a real topic (SUP or, via the backlog map, BL-###)
// keeps its existing destination - `resolveReplyTopicId`'s own resolution
// order is unchanged. A subject whose ONLY binding is DEFAULT_SUBJECT_KEY
// (every reply to it, prior to this ticket, resolved to `undefined` and was
// silently dropped by relayOneRecord's `if (topicId !== undefined)` guard)
// now delivers the full reply with no message_thread_id, which Telegram
// routes to the chat's General topic - the human's own asking thread in
// that case. And when a subject has BOTH a real topic AND a default
// binding (the human's reported symptom: a question asked in General
// answered only in a dedicated SUP/support topic he cannot see), the full
// reply keeps going to the real topic - preserving that topic's existing
// conversation history - but `alsoPointerToDefault` tells the relay to
// additionally post a short pointer into General, so asking from General
// is never silence again even when the canonical answer lives elsewhere.
export type ReplyDelivery =
  | { kind: 'topic'; topicId: number; alsoPointerToDefault: boolean }
  | { kind: 'default' }
  | { kind: 'undeliverable' };

export function resolveReplyDelivery(topicMap: Record<string, string>, backlogTopicMap: Record<string, number>, threadId: string): ReplyDelivery {
  const backlogTopicId = backlogTopicMap[threadId];
  if (backlogTopicId !== undefined) {
    return { kind: 'topic', topicId: backlogTopicId, alsoPointerToDefault: false };
  }
  const realTopicId = topicForSubject(topicMap, threadId);
  if (realTopicId !== undefined) {
    return { kind: 'topic', topicId: realTopicId, alsoPointerToDefault: hasDefaultBinding(topicMap, threadId) };
  }
  if (hasDefaultBinding(topicMap, threadId)) {
    return { kind: 'default' };
  }
  return { kind: 'undeliverable' };
}

// A short pointer, never the full answer - the real answer stays in its
// canonical topic (preserving that history); this only ever needs to make
// silence impossible for a human looking at General.
export const REPLY_POINTER_TEXT = "This was answered — see the reply in this conversation's other topic.";

// BL-346: the reserved subject a standing "Operator" forum topic is bound
// to in the SAME {topicId: subjectId} map subjectForTopic/topicForSubject
// already trust - once bound, an inbound message in that topic resolves
// through the ORDINARY post-existing branch below like any other SUP-###
// subject (never allocating a fresh support issue), and a reply tagged
// with this subject id resolves back through topicForSubject/
// resolveReplyTopicId exactly like any other reply - no new routing/egress
// code needed, only the one-time binding itself (decideEnsureOperatorTopicAction).
// BL-453: OPERATOR_SUBJECT_ID stays UNCHANGED (the durable binding/ownership
// key - changing it would re-mint or orphan the already-bound topic); only
// the display name is rebranded, from "Operator" to "Concierge".
export const OPERATOR_SUBJECT_ID = 'OPERATOR';
export const OPERATOR_TOPIC_NAME = 'Concierge';

export type EnsureOperatorTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

// Pure: the reserved-subject twin of topicRouter.ts's decideTopicAction -
// reuse the topic id already bound to OPERATOR_SUBJECT_ID (topicForSubject,
// the SAME lookup the reply egress uses), or create if no binding exists
// yet. Never keyed by the topic's NAME (Telegram topic names are not
// unique/stable identifiers) - only by the map's own subject-id value.
export function decideEnsureOperatorTopicAction(topicMap: Record<string, string>): EnsureOperatorTopicAction {
  const existingTopicId = topicForSubject(topicMap, OPERATOR_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

// BL-453: the front-desk topic already exists and is bound (the Operator ->
// Concierge rebrand supersedes only its display name/icon, never its
// binding), so a fresh install's create-time name alone cannot reach it -
// the live topic's title must also be RENAMED. Pure decision, mirroring
// topicTitleSync.ts's own "only apply when the recorded value actually
// differs" change-gate (never re-edit an already-correct topic): undefined
// (no marker recorded yet, e.g. a pre-BL-453 install) counts as "differs",
// same as any other stale value.
export type StandingTopicTitleSyncAction = 'update' | 'unchanged';

export function decideStandingTopicTitleSync(recordedTitle: string | undefined, desiredTitle: string): StandingTopicTitleSyncAction {
  return recordedTitle === desiredTitle ? 'unchanged' : 'update';
}

// BL-434: the reserved subject a standing "Approvals" forum topic is bound
// to - the SAME {topicId: subjectId} map OPERATOR_SUBJECT_ID above shares,
// so an inbound message there resolves through subjectForTopic exactly like
// any other bound subject (decideUpdateAction below intercepts it ahead of
// the ordinary post-existing branch, since a reply here must be PARSED for
// the ticket id it names, never just forwarded as a subject post).
export const APPROVALS_SUBJECT_ID = 'APPROVALS';
export const APPROVALS_TOPIC_NAME = 'Approvals';

export type EnsureApprovalsTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

// Pure: the Approvals-topic twin of decideEnsureOperatorTopicAction above -
// identical reuse-or-create shape, keyed by its own reserved subject id.
export function decideEnsureApprovalsTopicAction(topicMap: Record<string, string>): EnsureApprovalsTopicAction {
  const existingTopicId = topicForSubject(topicMap, APPROVALS_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

// BL-450: the reserved subject a standing "Recert" forum topic is bound to -
// the SAME {topicId: subjectId} map OPERATOR_SUBJECT_ID/APPROVALS_SUBJECT_ID
// above share, so an inbound message there resolves through subjectForTopic
// exactly like any other bound subject (decideUpdateAction below intercepts
// it ahead of the ordinary post-existing branch, since a reply here must be
// PARSED for the scenario id + verb it names, never just forwarded as a
// subject post).
export const RECERT_SUBJECT_ID = 'RECERT';
export const RECERT_TOPIC_NAME = 'Recert';

export type EnsureRecertTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

// Pure: the Recert-topic twin of decideEnsureApprovalsTopicAction above -
// identical reuse-or-create shape, keyed by its own reserved subject id.
export function decideEnsureRecertTopicAction(topicMap: Record<string, string>): EnsureRecertTopicAction {
  const existingTopicId = topicForSubject(topicMap, RECERT_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

// BL-466: the reserved subject a standing "Agent Questions" forum topic is
// bound to - the SAME {topicId: subjectId} map every other reserved subject
// above shares. Unlike Operator/Approvals/Recert, an inbound reply in THIS
// topic is never routed through the ordinary subjectForTopic/post-existing
// path at all (see decideAgentQuestionsReplyAction below) - it exists purely
// so ensureAgentQuestionsTopic (telegram-front-desk-bot.ts) has the SAME
// idempotent reuse-or-create mechanism every other standing topic already
// gets, never a second one invented for this ticket.
export const AGENT_QUESTIONS_SUBJECT_ID = 'AGENT_QUESTIONS';
export const AGENT_QUESTIONS_TOPIC_NAME = 'Agent Questions';

export type EnsureAgentQuestionsTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

// Pure: identical reuse-or-create shape to decideEnsureOperatorTopicAction
// above, keyed by its own reserved subject id.
export function decideEnsureAgentQuestionsTopicAction(topicMap: Record<string, string>): EnsureAgentQuestionsTopicAction {
  const existingTopicId = topicForSubject(topicMap, AGENT_QUESTIONS_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

// BL-492: the reserved subject a standing "Backlog" catch-all forum topic is
// bound to - the SAME {topicId: subjectId} map every other reserved subject
// above shares. Foundation slice of the BL-491 topic-consolidation epic:
// the routing target epic-less tickets post into instead of a per-ticket
// topic each (BL-493 wires the actual routing; this ticket only ensures the
// topic itself exists, exactly like every other standing topic's own
// ensure* helper).
export const BACKLOG_SUBJECT_ID = 'BACKLOG';
export const BACKLOG_TOPIC_NAME = 'Backlog';

export type EnsureBacklogTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

// Pure: identical reuse-or-create shape to decideEnsureApprovalsTopicAction/
// decideEnsureRecertTopicAction/decideEnsureAgentQuestionsTopicAction above,
// keyed by its own reserved subject id.
export function decideEnsureBacklogTopicAction(topicMap: Record<string, string>): EnsureBacklogTopicAction {
  const existingTopicId = topicForSubject(topicMap, BACKLOG_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

// BL-423: the reserved subject a standing "Control" forum topic is bound
// to - the SAME {topicId: subjectId} map every other reserved subject
// above shares. All three swarm-control verbs (/stop, /restart, /pause)
// and their button taps only ever act when sent/tapped in THIS topic
// (decideControlEventAction's own guard, telegramControlCore.ts) - an
// inbound message here otherwise never falls through to the ordinary
// subjectForTopic/post-existing path, same posture as Agent Questions
// above.
export const CONTROL_SUBJECT_ID = 'CONTROL';
export const CONTROL_TOPIC_NAME = 'Control';

export type EnsureControlTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

// Pure: identical reuse-or-create shape to decideEnsureAgentQuestionsTopicAction
// above, keyed by its own reserved subject id.
export function decideEnsureControlTopicAction(topicMap: Record<string, string>): EnsureControlTopicAction {
  const existingTopicId = topicForSubject(topicMap, CONTROL_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

export type EnsureRoleTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

// BL-425 slice 1: the per-role twin of decideEnsureOperatorTopicAction
// above - no reserved-subject indirection needed, since the role->topic map
// (roleTopicMapStore.ts) is already keyed by role name directly, unlike the
// Operator's shared {topicId: subjectId} map.
export function decideEnsureRoleTopicAction(roleTopicMap: Record<string, number>, role: string): EnsureRoleTopicAction {
  const existingTopicId = roleTopicMap[role];
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

export type BotUpdateDecision =
  | { action: 'post-existing'; subjectId: string; text: string }
  | { action: 'operator-context'; backlogId: string; text: string }
  // BL-434: a reply in the standing Approvals topic naming a ticket - the
  // id is PARSED from the reply text (classifyApprovalsTopicReply), never
  // inferred from which topic it landed in (backlogForTopic's own trick,
  // which no longer identifies a single ticket once one topic carries many).
  | { action: 'approvals-topic-approve'; backlogId: string; text: string }
  | { action: 'approvals-topic-reject'; backlogId: string; reason: string; text: string }
  // A reply in the Approvals topic that names no recognizable verb+id at
  // all - never silently dropped as a subject post (front-desk-operator-
  // fabricates-backlog-state memory); the orchestration layer surfaces it.
  | { action: 'approvals-topic-unrecognized'; text: string }
  // BL-450: a reply in the standing Recert topic - the scenario id is
  // PARSED from the reply text (classifyRecertTopicReply), never inferred
  // from which topic it landed in (only one topic exists, but many
  // scenarios pass through it over time).
  | { action: 'recert-validate'; scenarioId: string; text: string }
  | { action: 'recert-amend'; scenarioId: string; newText: string; text: string }
  | { action: 'recert-delete'; scenarioId: string; text: string }
  | { action: 'recert-confirm-delete'; text: string }
  // A reply in the Recert topic that names no recognizable verb+id (and is
  // not a bare "confirm") at all - never silently dropped (same
  // front-desk-operator-fabricates-backlog-state posture as the Approvals
  // topic's own unrecognized variant above); the orchestration layer
  // surfaces it.
  | { action: 'recert-unrecognized'; text: string }
  | { action: 'open-default'; text: string }
  | { action: 'open-for-topic'; topicId: number; text: string }
  | { action: 'drop'; reason: 'not-principal' | 'no-text' | 'not-my-chat' };

type UpdateEligibility = { ok: true; text: string } | { ok: false; reason: 'not-my-chat' | 'not-principal' | 'no-text' };

// Pure: the guard ahead of decideUpdateAction's routing below - split out
// so each function's own decision complexity stays under the project's
// CRAP threshold, never a behavior change (decideUpdateAction was pulling
// double duty on eligibility AND routing).
//
// BL-379: checked FIRST - getUpdates is scoped to the BOT, not the chat, so
// a message from a foreign chat is refused regardless of who sent it (a
// stranger in a foreign chat is "not-my-chat", never "not-principal" - the
// chat guard wins). Both conditions can hold at once (an unauthorized
// sender posting in a foreign chat is an ordinary state, not a contrived
// one), so this ORDER is load-bearing, not incidental.
function checkUpdateEligibility(update: TelegramUpdate, principalUserId: string, chatId: string): UpdateEligibility {
  if (!isFromMyChat(update, chatId)) {
    return { ok: false, reason: 'not-my-chat' };
  }
  if (!isFromPrincipal(update, principalUserId)) {
    return { ok: false, reason: 'not-principal' };
  }
  const text = messageTextOf(update);
  if (!text) {
    return { ok: false, reason: 'no-text' };
  }
  return { ok: true, text };
}

// Pure: the bot's whole per-update decision - given the update, the
// principal's user id, the bot's own configured chat id, a lookup from
// topic id -> already-mapped SUP-### subject id (the bot's own persisted
// mapping), and a lookup from topic id -> a BL-### backlog item's topic
// (BL-297's own persisted mapping, inverted via topicRouter.ts's
// backlogForTopic) - decides whether to post under an existing subject,
// route as Operator context for a backlog item (BL-298), open a new
// subject (private DM -> the single default subject; an unmapped topic ->
// a fresh per-topic subject), or drop.
//
// backlogForTopic defaults to a no-op (always undefined) so every existing
// caller that has no notion of BL-### topics (BL-281/BL-294's own call
// sites/tests) keeps its exact prior behavior unchanged.
//
// SUP-### id ASSIGNMENT itself is not this function's job - it stays with
// the support store (support_thread.bb open / support_lib.bb's
// next-thread-id), reached through the openSubjectAndRecord adapter below;
// this function only ever decides WHICH of these things should happen for
// a given update. A topic already known to be a BL-### item's topic is
// checked BEFORE falling through to "open a new SUP-### subject here" -
// a reply in a BL-### topic must never be misfiled as a fresh support
// conversation.
// BL-434: pure - which of the Approvals-topic decision variants a reply's
// own text resolves to. Split out so decideUpdateAction's own branch count
// stays at the same CRAP-budget posture this file already enforces
// throughout (e.g. checkUpdateEligibility/deliveryOutcome).
function decideApprovalsTopicReplyAction(text: string): BotUpdateDecision {
  const parsed = classifyApprovalsTopicReply(text);
  if (parsed.kind === 'approve') {
    return { action: 'approvals-topic-approve', backlogId: parsed.backlogId, text };
  }
  if (parsed.kind === 'reject') {
    return { action: 'approvals-topic-reject', backlogId: parsed.backlogId, reason: parsed.reason, text };
  }
  return { action: 'approvals-topic-unrecognized', text };
}

// BL-450: pure - which of the Recert-topic decision variants a reply's own
// text resolves to. Split out for the same CRAP-budget reason as
// decideApprovalsTopicReplyAction above.
function decideRecertTopicReplyAction(text: string): BotUpdateDecision {
  const parsed = classifyRecertTopicReply(text);
  if (parsed.kind === 'validate') {
    return { action: 'recert-validate', scenarioId: parsed.scenarioId, text };
  }
  if (parsed.kind === 'amend') {
    return { action: 'recert-amend', scenarioId: parsed.scenarioId, newText: parsed.newText, text };
  }
  if (parsed.kind === 'delete') {
    return { action: 'recert-delete', scenarioId: parsed.scenarioId, text };
  }
  if (parsed.kind === 'confirm-delete') {
    return { action: 'recert-confirm-delete', text };
  }
  return { action: 'recert-unrecognized', text };
}

// Which reserved standing-topic subject id (Approvals, Recert, ...) a reply
// landed in, if any - collapsed into one lookup so decideUpdateAction's own
// branch count does not grow one-for-one with every new reserved subject
// (the same CRAP-budget reason decideApprovalsTopicReplyAction/
// decideRecertTopicReplyAction above were split out in the first place).
// undefined means the subject is not a reserved one - the caller falls
// through to its own ordinary post-existing/open handling.
function decideReservedSubjectReplyAction(subjectId: string | undefined, text: string): BotUpdateDecision | undefined {
  if (subjectId === APPROVALS_SUBJECT_ID) {
    return decideApprovalsTopicReplyAction(text);
  }
  if (subjectId === RECERT_SUBJECT_ID) {
    return decideRecertTopicReplyAction(text);
  }
  return undefined;
}

export function decideUpdateAction(
  update: TelegramUpdate,
  principalUserId: string,
  chatId: string,
  subjectForTopic: (topicId: number | undefined) => string | undefined,
  backlogForTopic: (topicId: number | undefined) => string | undefined = () => undefined
): BotUpdateDecision {
  const eligibility = checkUpdateEligibility(update, principalUserId, chatId);
  if (!eligibility.ok) {
    return { action: 'drop', reason: eligibility.reason };
  }
  const { text } = eligibility;
  const topicId = topicIdOf(update);
  const subjectId = subjectForTopic(topicId);
  // BL-434/BL-450: checked BEFORE the ordinary post-existing branch below -
  // a reply in a reserved standing topic (Approvals, Recert) must be PARSED
  // for the ticket/scenario id it names, never forwarded as a plain subject
  // post the way every other bound subject is.
  const reserved = decideReservedSubjectReplyAction(subjectId, text);
  if (reserved) {
    return reserved;
  }
  if (subjectId) {
    return { action: 'post-existing', subjectId, text };
  }
  const backlogId = backlogForTopic(topicId);
  if (backlogId) {
    return { action: 'operator-context', backlogId, text };
  }
  return topicId === undefined ? { action: 'open-default', text } : { action: 'open-for-topic', topicId, text };
}

// BL-425 slice 1: per-agent Telegram steering topics - REDIRECT mode only
// (an explicit, DISRUPTIVE message that interrupts the addressed role's
// live pane). Slice 2 (the non-disruptive QUESTION mode + a mode-marker
// selector) is parked in the .feature.draft until built, so this function
// has no mode-marker parameter yet: every steering message slice 1 handles
// is a redirect.
//
// Topic-scope (guard #2) is checked FIRST - a topic that is not one of the
// eight role topics is 'ignore' regardless of sender, so the existing
// BL-ticket/Operator/SUP routing in decideUpdateAction below is reached
// completely untouched for it, never even evaluating auth (the ticket's own
// "the same text in a BL-ticket topic, the Operator topic, or any other
// topic does nothing and those topics keep their existing behavior").
// Only once a message is confirmed to be IN a role topic does the
// principal guard (BL-239/240's isFromMyChat/isFromPrincipal, reused
// verbatim) apply, distinguishing an unauthorised sender ('refuse') from
// the authorised human ('redirect').
export type SteeringDecision = { kind: 'ignore' } | { kind: 'refuse' } | { kind: 'redirect'; role: string; text: string };

export function decideSteeringAction(
  update: TelegramUpdate,
  principalUserId: string,
  chatId: string,
  roleTopicMap: Record<string, number>
): SteeringDecision {
  const role = roleForTopic(roleTopicMap, topicIdOf(update));
  if (!role) {
    return { kind: 'ignore' };
  }
  if (!isFromMyChat(update, chatId) || !isFromPrincipal(update, principalUserId)) {
    return { kind: 'refuse' };
  }
  const text = messageTextOf(update);
  if (!text) {
    return { kind: 'ignore' };
  }
  return { kind: 'redirect', role, text };
}

// BL-426 slice 1: coordinator-Operator-topic voice-note round trip. STT/TTS
// results are a discriminated union, never a bare boolean - a TRANSIENT
// provider failure (retryable) and a STRUCTURALLY un-processable file
// (terminal, a deliberate drop) are different outcomes with opposite
// offset/retry treatment (the engineering article's own
// deliberate-drop-vs-failure rule), so this never collapses them the way
// BL-389 had to fix for ordinary drops.
export type SttResult = { kind: 'ok'; transcript: string } | { kind: 'transient-failure' } | { kind: 'unprocessable' };
export type TtsResult = { kind: 'ok'; audio: Buffer } | { kind: 'failure' };

export type VoiceUpdateDecision = { kind: 'transcribe'; fileId: string } | { kind: 'refuse' } | { kind: 'not-applicable' };

// Pure: is this update a voice note addressed to the coordinator's Operator
// topic, and if so is the sender authorised? Checked ahead of
// decideUpdateAction (which reads messageTextOf and would otherwise see a
// voice note as a text-less 'no-text' drop) - mirrors decideSteeringAction's
// own "decide first, fall through on not-applicable" shape. Scoped to the
// Operator topic ONLY (slice 1): that topic is the one already bound to the
// reserved OPERATOR_SUBJECT_ID (decideEnsureOperatorTopicAction), so
// subjectForTopic resolving to it is the same "is this the coordinator's
// topic" signal the rest of this file already trusts - no new topic-identity
// mechanism needed. A voice note in any OTHER topic returns 'not-applicable'
// and falls through completely unaffected to the pre-BL-426 no-text drop
// (audio for any other role is explicitly out of scope for slice 1, never a
// regression).
export function decideVoiceUpdateAction(
  update: TelegramUpdate,
  principalUserId: string,
  chatId: string,
  subjectForTopic: (topicId: number | undefined) => string | undefined
): VoiceUpdateDecision {
  const voice = update.message?.voice;
  if (!voice) {
    return { kind: 'not-applicable' };
  }
  if (subjectForTopic(topicIdOf(update)) !== OPERATOR_SUBJECT_ID) {
    return { kind: 'not-applicable' };
  }
  if (!isFromMyChat(update, chatId) || !isFromPrincipal(update, principalUserId)) {
    return { kind: 'refuse' };
  }
  return { kind: 'transcribe', fileId: voice.file_id };
}

// BL-466: an agent's clarifying question always lands in the dedicated
// Agent Questions topic (operator_ask.bb's own reply-outbox entries are
// marked agentQuestion - see deliverAgentQuestion below), regardless of
// which topic the asking SUP-### thread is otherwise bound to. So an
// inbound reply THERE never goes through the ordinary subjectForTopic/
// post-existing routing at all - it is ALWAYS either the answer to
// whichever question is currently pending (BL-306's own "one at a time"
// MVP constraint means there is never more than one to disambiguate
// between), or - no question pending at all - a drop, never a fresh
// SUP-### opened the way an ordinary unmapped topic would (this topic is
// reserved, not an ordinary conversation starter).
export type AgentQuestionsReplyDecision = { kind: 'deliver'; text: string } | { kind: 'refuse' } | { kind: 'not-applicable' };

export function decideAgentQuestionsReplyAction(
  update: TelegramUpdate,
  principalUserId: string,
  chatId: string,
  agentQuestionsTopicId: number | undefined
): AgentQuestionsReplyDecision {
  if (agentQuestionsTopicId === undefined || topicIdOf(update) !== agentQuestionsTopicId) {
    return { kind: 'not-applicable' };
  }
  if (!isFromMyChat(update, chatId) || !isFromPrincipal(update, principalUserId)) {
    return { kind: 'refuse' };
  }
  const text = messageTextOf(update);
  if (!text) {
    return { kind: 'refuse' };
  }
  return { kind: 'deliver', text };
}

// BL-466: a vote on a native poll carries no chat/topic/thread info at all
// (Telegram's poll_answer object is just {poll_id, option_ids, user}), so it
// cannot be filtered by isFromMyChat (there is no chat here to check) - only
// by the voter's own user id, which sendTelegramPoll's is_anonymous:false
// choice guarantees is present. option_ids is empty (never absent) when the
// voter RETRACTS their vote - a deliberate drop, never a delivery failure,
// same "retraction is a decision, not a failure" posture as every other
// deliberate-drop in this file.
export type PollAnswerDecision = { kind: 'answer'; pollId: string; optionIndex: number } | { kind: 'drop'; reason: 'not-principal' | 'no-selection' };

export function decidePollAnswerAction(pollAnswer: TelegramPollAnswer, principalUserId: string): PollAnswerDecision {
  if (pollAnswer.user === undefined || String(pollAnswer.user.id) !== String(principalUserId)) {
    return { kind: 'drop', reason: 'not-principal' };
  }
  const optionIndex = pollAnswer.option_ids[0];
  if (optionIndex === undefined) {
    return { kind: 'drop', reason: 'no-selection' };
  }
  return { kind: 'answer', pollId: pollAnswer.poll_id, optionIndex };
}

export interface PollAdapters {
  // BL-379: the bot's own configured chat id - decideUpdateAction's new
  // guard against getUpdates' bot-wide (not chat-scoped) result set. Lives
  // on the adapters object (a plain config value, not a function) rather
  // than as a new positional parameter threaded through
  // processUpdate/pollAndForward/runPollCycle, so those signatures - and
  // their many existing callers - are unaffected.
  chatId: string;
  getUpdates: (offset: number) => Promise<GetUpdatesResult>;
  // BL-369: updateId (the Telegram update's own update_id) rides every call
  // so the bridge can dedupe a redelivered message by its natural
  // idempotency key (scenario 03) - mirrors BL-320's id-based reply-outbox
  // dedup, reusing the SAME posture rather than inventing a second one.
  postToBridge: (subjectId: string, text: string, updateId: number) => Promise<boolean>;
  subjectForTopic: (topicId: number | undefined) => string | undefined;
  // BL-294: opens a fresh SUP-### for a not-yet-mapped context (topicId
  // undefined means the DM default) via the support store - the
  // authoritative id sequence, never duplicated here - records the
  // topicId(or default)->subjectId mapping so later messages in the same
  // context resolve through subjectForTopic instead of opening again, and
  // notifies the Operator the same way an existing-subject post does.
  // BL-389 rework (architect bounce): updateId rides this call too - a
  // redelivered update (offset never advanced) would otherwise mint a
  // SECOND, duplicate SUP-### for the same original conversation opener;
  // the real implementation dedupes on it before ever minting anything.
  openSubjectAndRecord: (topicId: number | undefined, text: string, updateId: number) => Promise<string>;
  // BL-298: looks up a BL-### backlog item's topic (topicRouter.ts's own
  // backlogForTopic, inverted from BL-297's outbound map) - checked before
  // treating an unmapped topic as a fresh support conversation.
  backlogForTopic: (topicId: number | undefined) => string | undefined;
  // BL-298: routes a reply as context for the given backlog item's task -
  // NOT the support-thread path (postToBridge/openSubjectAndRecord). What
  // the Operator does with that context is the Operator's own behavior,
  // out of scope here.
  // BL-389: updateId rides this call too, so the implementation can dedupe
  // a redelivered update - THIS adapter is the one that actually flooded
  // (backlog/topics/<id>.json gained 209 duplicate entries and the
  // Operator answered the same reply every ~15s) once a dropped update
  // parked the offset and Telegram kept redelivering the same batch.
  postOperatorContext: (backlogId: string, text: string, updateId: number) => Promise<boolean>;
  // BL-357: pendingApprovalReply.ts's recordApprovalReply, adapter-injected
  // - flips the ticket's human_approval field when its topic reply is
  // recognized as an approval (classifyApprovalReplyAction). A SEPARATE
  // effect from postOperatorContext above (that one is unconditional
  // context for whatever's happening with the ticket; this one only fires
  // on the approve verb, and writes to the ticket's own YAML, not a gated
  // pane) - both apply to the same reply, neither replaces the other.
  // Naturally idempotent on its own (a ticket already `approved` simply
  // no-ops on a second flip attempt), so it needs no updateId of its own.
  recordApprovalReply: (backlogId: string) => Promise<boolean>;
  // BL-409: pendingApprovalReply.ts's recordRejectionReply, the reject
  // verb's sibling effect - same posture as recordApprovalReply (a separate
  // effect alongside the unconditional context post, naturally idempotent,
  // no updateId needed).
  recordRejectionReply: (backlogId: string, reason: string) => Promise<boolean>;
  // BL-434: the Approvals-topic reply's own surfacing channel - a reply
  // naming an id that turns out not to be pending (recordApprovalReply/
  // recordRejectionReply's own `changed` result reports false) is told so
  // directly in the topic, never silently dropped (front-desk-operator-
  // fabricates-backlog-state memory). A SEPARATE channel from
  // postOperatorContext (that one posts into the TICKET's own context
  // stream, not a reply the human sees back in the Approvals topic itself).
  // Optional so every existing PollAdapters fixture keeps working unchanged
  // - missing means the surfacing reply degrades to a silent no-op rather
  // than a crash, mirroring this file's own established optional-adapter
  // convention (e.g. getPendingButtonAction above).
  notifyApprovalsTopic?: (topicId: number | undefined, text: string) => Promise<boolean>;
  // BL-450: recertificationStore.ts's own read-check-write functions,
  // adapter-injected. Each already refuses (returns false, writes nothing)
  // when the named scenarioId is not the one currently up for recert - the
  // SAME "the writer itself is the check" posture recordApprovalReply/
  // recordRejectionReply above already established, never a separate
  // check-then-write pair that could race. All optional - missing means
  // "recert not wired", the same "every existing PollAdapters fixture keeps
  // working unchanged" posture BL-410/BL-425/BL-426's own optional adapters
  // above already established; the delivery layer treats a missing writer
  // as "did not apply" (never a crash), since decideUpdateAction only ever
  // reaches the Recert branch for a topic id actually bound to
  // RECERT_SUBJECT_ID - no pre-BL-450 fixture's topicMap can produce that.
  recordRecertValidate?: (scenarioId: string) => Promise<boolean>;
  queueRecertAmendProposal?: (scenarioId: string, newText: string) => Promise<boolean>;
  queueRecertDeleteProposal?: (scenarioId: string) => Promise<boolean>;
  // BL-450: a delete reply is a two-step gate (BL-150 recert-04) - "delete
  // <id>" itself writes nothing yet, so it needs a read-only check (never
  // recordRecertValidate/queueRecert*Proposal's own check-and-write shape)
  // to decide whether to arm the confirmation marker below or surface
  // "not up for recert" immediately. The confirm step re-checks via
  // queueRecertDeleteProposal's own internal check instead, since the named
  // scenario could have moved on (e.g. validated away) between the two
  // replies.
  isScenarioUpForRecert?: (scenarioId: string) => Promise<boolean>;
  getPendingRecertDelete?: () => Promise<string | undefined>;
  setPendingRecertDelete?: (scenarioId: string) => Promise<void>;
  clearPendingRecertDelete?: () => Promise<void>;
  // BL-450: the Recert-topic reply's own surfacing channel - same optional,
  // degrades-to-silent-drop posture as notifyApprovalsTopic above.
  notifyRecertTopic?: (topicId: number | undefined, text: string) => Promise<boolean>;
  // BL-410: a Reject/Amend button tap has no reason/note text of its own -
  // it stashes which verb is awaited for this ticket, then the NEXT bare
  // (unverbed) reply in that ticket's topic is read as the reason/note
  // (deliverOperatorContext below). Optional so every PollAdapters fixture
  // written before BL-410 keeps working unchanged - a missing adapter here
  // means "no button-triggered follow-up is ever pending", exactly the
  // behavior this codebase had before buttons existed (mirrors this file's
  // own established "new adapter defaults to a no-op, existing callers
  // unaffected" convention, e.g. escalate/recordHeartbeat below).
  getPendingButtonAction?: (backlogId: string) => Promise<'reject' | 'amend' | undefined>;
  clearPendingButtonAction?: (backlogId: string) => Promise<void>;
  // BL-410: only ever reached via a real callback_query update (never
  // constructed by any pre-BL-410 PollAdapters fixture), so these two stay
  // required - unlike the two above, there is no legacy call site to stay
  // compatible with.
  setPendingButtonAction: (backlogId: string, kind: 'reject' | 'amend') => Promise<void>;
  // BL-410: clears the tapped button's Telegram loading spinner - called for
  // every recognized callback_query, even a no-op (stale/unknown data).
  // BL-484: an optional toast `text` - a stale/already-decided tap answers
  // with one naming the recorded verdict, instead of the plain silent
  // spinner-clear. Omitted for every ordinary (non-stale) tap, the exact
  // pre-BL-484 behavior.
  answerCallbackQuery: (callbackQueryId: string, text?: string) => Promise<void>;
  // BL-484: the persisted {topicId, messageId, text} for a ticket's posted
  // approval ask - topicRouter.ts's routeApprovalRequestedEvent recorded it
  // (RouteAdapters.recordApprovalAskMessageId), a SEPARATE, concierge-tick-
  // side subsystem from this poll loop. Optional: absent, or no entry for
  // this backlogId (the ask was posted before this feature shipped, or its
  // capture failed), means the closing routine has nothing to edit, so it
  // simply no-ops rather than crashing - the same "new capability degrades
  // to a no-op" posture as every other optional adapter in this file.
  readApprovalAskMessage?: (backlogId: string) => Promise<{ topicId: number; messageId: number; text: string } | undefined>;
  // BL-484: performs the actual close - strips the ask's inline keyboard
  // and replaces its text with the decided version (composeDecidedAskText).
  // BL-496: widened past a bare boolean to the full {success, error,
  // retryAfterSeconds} shape editMessageText's own result already carries -
  // a failure is logged by the caller with its REAL rejection reason, and
  // a rate-limited one (retryAfterSeconds present) is retried, bounded (see
  // closeApprovalAskIfPossible); it never blocks or unwinds the decision
  // recording that already happened (the ticket's own "never crashes the
  // tick/bot loop" constraint).
  editApprovalAskMessage?: (topicId: number, messageId: number, text: string) => Promise<EditMessageTextResult>;
  // BL-496: the ask-close retry loop's own injected wait seam - defaults to
  // a real setTimeout wait in production; a test injects one that resolves
  // immediately while recording the requested duration, so the loop's own
  // "wait retry_after seconds before the next attempt" behavior is provable
  // without a real clock (engineering's absolute no-real-timers rule).
  waitForAskCloseRetry?: (ms: number) => Promise<void>;
  // BL-496: the bounded number of edit attempts the ask-close retry loop
  // makes before giving up and logging the undelivered close loudly.
  // Defaults to a sane production value; a test pins a small budget so its
  // "exhausted retries" scenario runs in a handful of iterations.
  askCloseRetryBudget?: number;
  // BL-484: the stale-tap guard's own read - the SPECIFIC verdict already
  // recorded for this ticket, if any (pendingApprovalReply.ts's
  // readRecordedVerdict, adapter-injected). Optional: absent means the
  // guard never fires - every tap proceeds exactly as it did before this
  // ticket, the same "new capability degrades to prior behavior" posture
  // as every other optional adapter in this file.
  readRecordedApprovalVerdict?: (backlogId: string) => Promise<'approved' | 'rejected' | undefined>;
  // BL-425 slice 1: role->topic steering (REDIRECT mode). Both optional so
  // every PollAdapters fixture written before BL-425 keeps working
  // unchanged - either missing means "no role steering wired", the exact
  // pre-BL-425 behavior (mirrors this file's own established BL-410
  // optional-adapter convention above). Read fresh on every update (no
  // caching), same "a mapping just written is visible to the very next
  // poll" posture as subjectForTopic/backlogForTopic.
  readRoleTopicMap?: () => Record<string, number>;
  redirectToRole?: (role: string, text: string) => Promise<void>;
  // BL-426 slice 1: transcribes a coordinator Operator-topic voice note's
  // audio (already-resolved fileId) to text. Optional so every PollAdapters
  // fixture written before BL-426 keeps working unchanged - missing means
  // "voice I/O not wired", the exact pre-BL-426 behavior (mirrors this
  // file's own BL-410/BL-425 optional-adapter convention).
  transcribeVoice?: (fileId: string) => Promise<SttResult>;
  // BL-426 slice 1: marks the coordinator's NEXT reply on this subject as
  // voice-originated, so the reply-relay side (ReplyRelayAdapters below)
  // knows to synthesize it back to a voice note instead of staying
  // text-only. One-shot - consumed and cleared by the reply-relay path.
  markVoiceOriginatedTurn?: (subjectId: string) => Promise<void>;
  // BL-466: the standing Agent Questions topic's own id (ensureAgentQuestions
  // Topic, telegram-front-desk-bot.ts) - optional so every PollAdapters
  // fixture written before BL-466 keeps working unchanged, same posture as
  // every other optional adapter in this file; missing means "agent
  // questions not wired", never a crash.
  agentQuestionsTopicId?: () => Promise<number | undefined>;
  // BL-466: the SUP-### thread id of whichever agent question is currently
  // pending (operator_runtime.bb's own awaiting-answer.json, read-only from
  // this side - never a second, parallel record of the same fact) - nil
  // means no question pending, so an in-topic reply is a deliberate drop
  // rather than a guess at what it might be answering.
  getPendingAgentQuestionThread?: () => Promise<string | undefined>;
  // BL-466: resolves a native poll's own id (sendTelegramPoll's returned
  // pollId, recorded by recordPollMapping at send time - ReplyRelayAdapters
  // below) back to the SUP-### thread that asked it plus its own options,
  // so a poll_answer - which carries no thread/topic info at all - can
  // still map its selected option INDEX to the option's actual TEXT.
  resolvePollThread?: (pollId: string) => Promise<{ threadId: string; options: string[] } | undefined>;
  // BL-483: resolves an options-carrying ask's own options - undefined
  // means this thread's ask is no longer the pending one (answered,
  // retracted, or superseded by a later question - "ONE pending question
  // at a time" is the awaiting-answer store's own contract), the SAME
  // "undefined collapses every closed case" posture resolvePollThread
  // above already established for an unknown/stale poll id. Doubles as the
  // stale-tap guard: a tap whose threadId this resolves to undefined gets
  // the "no longer open" edit + toast, never a second/spurious answer.
  resolveAskOptions?: (threadId: string) => Promise<AskOption[] | undefined>;
  // BL-483: the posted ask message's own {topicId, messageId, text} -
  // recordAskMessage (ReplyRelayAdapters below) wrote it at send time.
  // Consulted both on a successful answer (edit to "answered: <label>")
  // and a stale tap (edit to "no longer open") - mirrors BL-484's
  // readApprovalAskMessage exactly, keyed by threadId instead of backlogId.
  readAskMessage?: (threadId: string) => Promise<{ topicId: number | undefined; messageId: number; text: string } | undefined>;
  // BL-483: edits the posted ask message in place - reused directly for
  // BOTH the answered-close and the stale-tap edit (a plain text edit, the
  // same shape editApprovalAskMessage already provides for the approval
  // ask's own close, so this is that same general-purpose "edit a message"
  // adapter, named for this call site).
  editAskMessage?: (topicId: number | undefined, messageId: number, text: string) => Promise<boolean>;
  // BL-423: the standing Control topic's own id - every stop/restart/pause
  // verb (text or button tap) only ever acts when sent/tapped here
  // (decideControlEventAction's own topic guard). Optional so every
  // PollAdapters fixture written before BL-423 keeps working unchanged;
  // missing means "swarm control not wired", never a crash.
  controlTopicId?: () => Promise<number | undefined>;
  // BL-423: the confirm state machine's own cross-tick memory - which
  // destructive confirm (if any) is currently awaiting a button tap. Absent
  // (undefined) means no confirm pending, so a stop-mode/restart-confirm
  // tap with nothing pending is a stale/already-actioned no-op, never a
  // fabricated execution.
  getPendingControlConfirm?: () => Promise<PendingControlConfirm>;
  setPendingControlConfirm?: (confirm: PendingControlConfirm) => Promise<void>;
  // BL-423: the pause state machine's own cross-tick memory - read-only
  // from the poll side (applyPause/resumeNow below own writing it); a
  // resume-now tap while not actually paused is a deliberate no-op.
  getPauseState?: () => Promise<PauseState>;
  // BL-423: one adapter per distinct message the control decision posts -
  // never a single generic "post text" adapter, since each carries its own
  // fixed wording/buttons the wiring composes once (mirrors this file's
  // own per-purpose adapter convention throughout, e.g. notifyApprovalsTopic
  // vs notifyRecertTopic).
  postControlStopModesMenu?: () => Promise<void>;
  postControlRestartConfirm?: () => Promise<void>;
  postControlCancelled?: () => Promise<void>;
  postControlPauseMenu?: () => Promise<void>;
  // BL-423: the three destructive/relaunch effects - each owns its own
  // real teardown/relaunch mechanism (kill_all_swarm.sh's socket-scoped
  // reap for the two stop modes, the existing bounce-sentinel/bounce-ack
  // path for restart, per the ticket's own "reuse the sanctioned bounce
  // path, do not invent a restart mechanism" constraint) - opaque here,
  // just an effect this module triggers and awaits.
  executeEmergencyStop?: () => Promise<void>;
  executeDrainStop?: () => Promise<void>;
  executeRestart?: () => Promise<void>;
  // BL-423: durationMs undefined means "Until I resume" (no timer).
  applyPause?: (durationMs: number | undefined) => Promise<void>;
  resumeNow?: () => Promise<void>;
}

// BL-389: the keystone fix. A DROP is a DECISION (the code looked at the
// update and chose not to act - not-principal, no-text) and can NEVER
// succeed on retry; a FAILURE is a transient delivery problem that MAY
// succeed on retry. Collapsing both into one boolean is exactly what
// parked the Telegram offset forever on a deliberately-dropped update (a
// photo, a sticker, a service message) - a drop must let the offset past
// it, a failure must not. See the engineering article's own "a deliberate
// DROP is terminal, never a retryable failure" rule.
export type UpdateDeliveryOutcome = 'posted' | 'dropped' | 'failed';

// Split out of pollAndForward so that function's own branch count stays
// low - one update's whole decision -> outcome.
// BL-357: split out of processUpdate below so its own branch count stays at
// the pre-BL-357 level (cleaner review: the new isApprovalReplyText branch
// pushed processUpdate's own CRAP over threshold at full coverage - the
// same class of split messageTextForEvent/routeEvent already use in
// topicRouter.ts for the identical reason).
// BL-409: extended to the three-verb dispatch (approve/reject/amend). An
// amend posts only its extracted NOTE as context (per the ticket's own
// "post the note" wording) and changes no approval state - it is not a
// resolution, so the context text is exactly what the specifier needs to
// see, not the "amend " verb prefix. approve/reject/none keep posting the
// raw reply text unchanged (no scenario asks otherwise), and only ONE of
// approve/reject's own record* effect ever fires per reply.
// BL-410: a Reject/Amend button tap carries no reason/note text, so it
// leaves a pending "which verb is this ticket awaiting a follow-up for"
// marker instead of firing its effect immediately. When the NEXT reply in
// that ticket's topic carries no verb of its own (classifyApprovalReplyAction
// returns 'none'), it is read as that pending verb's reason/note - the exact
// text BL-409's typed "reject <reason>"/"amend <note>" path would have
// captured, had the human typed the verb prefix themselves. An explicit
// verb-prefixed reply (or a plain "approve") always wins over a stale
// pending marker (checked first, via classifyApprovalReplyAction), and any
// reply at all - however it resolves - clears the pending marker, since the
// "awaiting a follow-up" window is a one-shot prompt, not a standing state.
function classifyWithPendingButton(
  text: string,
  pending: 'reject' | 'amend' | undefined
): ReturnType<typeof classifyApprovalReplyAction> {
  const classified = classifyApprovalReplyAction(text);
  if (classified.kind !== 'none' || !pending) {
    return classified;
  }
  const trimmed = text.trim();
  return pending === 'reject' ? { kind: 'reject', reason: trimmed } : { kind: 'amend', note: trimmed };
}

// BL-496: the default retry budget when the adapter doesn't pin its own -
// a sane production value; the acceptance/unit fixtures pin a small one
// (e.g. 3) so an "exhausted retries" scenario runs in a handful of
// iterations rather than this many.
const DEFAULT_ASK_CLOSE_RETRY_BUDGET = 5;

function defaultAskCloseWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// BL-496: the ask-close's own bounded, retry_after-honouring edit loop -
// distinct from telegramClient.ts's editForumTopicWithRateLimitRetry
// (UNBOUNDED: safe there because the wait is always a finite, server-told
// duration and that caller is a one-shot backfill/sync, never a live poll
// tick) and from telegramRetry.ts's sendWithBoundedRetry (retries ANY
// failure with an EXPONENTIAL backoff it computes itself). Neither fits: a
// genuine, non-rate-limited rejection here must fail FAST - attempted
// EXACTLY once, never retried (BL-496's own scenario 01) - and a
// rate-limited one must wait EXACTLY Telegram's own told-you-so
// retryAfterSeconds, never a guessed backoff. So this retries ONLY when the
// failure carries a retryAfterSeconds, up to a bounded maxAttempts.
async function editApprovalAskWithBoundedRateLimitRetry(
  edit: () => Promise<EditMessageTextResult>,
  maxAttempts: number,
  wait: (ms: number) => Promise<void>
): Promise<EditMessageTextResult> {
  let lastResult: EditMessageTextResult = { success: false };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await edit();
    if (lastResult.success || lastResult.retryAfterSeconds === undefined) {
      return lastResult;
    }
    if (attempt < maxAttempts) {
      await wait(lastResult.retryAfterSeconds * 1000);
    }
  }
  return lastResult;
}

// BL-496: logs the real reason a decided ask's close never landed - split
// out of closeApprovalAskIfPossible below for the same CRAP-budget reason
// this file already applies throughout. A rate-limited exhaustion (a
// retryAfterSeconds survived every retry) gets its own loud, named line so
// it reads distinctly from an ordinary rejection (message deleted, bot
// kicked, etc.), which logs its real Telegram error instead.
function logAskCloseFailure(backlogId: string, result: EditMessageTextResult): void {
  if (result.retryAfterSeconds !== undefined) {
    process.stderr.write(
      `front-desk bot: failed to close the approval ask for ${backlogId} - rate-limited, retry budget exhausted, close not delivered (last retry_after=${result.retryAfterSeconds}s)\n`
    );
  } else {
    process.stderr.write(`front-desk bot: failed to close the approval ask for ${backlogId}: ${result.error ?? 'message edit failed or not wired'}\n`);
  }
}

// BL-484: performs the actual Telegram edit that closes a decided ask -
// split out of recordApprovalDecisionAndClose below for the same CRAP-
// budget reason this file already applies throughout (e.g.
// isApprovalsTopicReplyDecision above). A missing readApprovalAskMessage
// adapter, or no stored message for this backlogId (never captured -
// posted before this feature shipped, or capture failed), means there is
// nothing to edit, so this simply no-ops rather than crashing. A failed
// edit is LOGGED, never thrown - the ticket's own explicit "editing must
// ... never crash the tick/bot loop" constraint.
// BL-496: a rate-limited failure (retryAfterSeconds present) is retried,
// bounded, honouring Telegram's own told-you-so wait; a genuine rejection
// is logged once with its real reason and not retried; exhausting the
// retry budget is logged loudly, naming the ticket and the rate limit.
async function closeApprovalAskIfPossible(adapters: PollAdapters, backlogId: string, verdict: ApprovalDecisionVerdict, nowMs: number): Promise<void> {
  const stored = await adapters.readApprovalAskMessage?.(backlogId);
  if (!stored) {
    return;
  }
  const newText = composeDecidedAskText(stored.text, verdict, nowMs);
  const editFn = adapters.editApprovalAskMessage;
  const result = editFn
    ? await editApprovalAskWithBoundedRateLimitRetry(
        () => editFn(stored.topicId, stored.messageId, newText),
        adapters.askCloseRetryBudget ?? DEFAULT_ASK_CLOSE_RETRY_BUDGET,
        adapters.waitForAskCloseRetry ?? defaultAskCloseWait
      )
    : { success: false };
  if (!result.success) {
    logAskCloseFailure(backlogId, result);
  }
}

// BL-484: the ONE closing routine serving BOTH decision entry points - a
// button tap (processCallbackQuery below) and a typed reply
// (deliverOperatorContext/deliverApprovalsTopicReply below) - so the two
// can never drift into two different edited shapes, per the ticket's own
// explicit constraint. Records the decision exactly as every caller
// already did (recordApprovalReply/recordRejectionReply, unchanged
// contract), then - only on a REAL transition (changed === true, never a
// no-op on an already-decided or unknown ticket) - closes the posted ask.
// nowMs defaults to the real clock (mirrors runConciergeTick's own
// injectable-nowMs convention) so every existing call site needs no clock
// plumbing of its own, while a test can still pin an exact instant.
export async function recordApprovalDecisionAndClose(
  adapters: PollAdapters,
  backlogId: string,
  verdict: ApprovalDecisionVerdict,
  nowMs: number = Date.now()
): Promise<boolean> {
  const changed =
    verdict.kind === 'approved' ? await adapters.recordApprovalReply(backlogId) : await adapters.recordRejectionReply(backlogId, verdict.reason);
  if (changed) {
    await closeApprovalAskIfPossible(adapters, backlogId, verdict, nowMs);
  }
  return changed;
}

async function deliverOperatorContext(backlogId: string, text: string, updateId: number, adapters: PollAdapters): Promise<boolean> {
  const pending = await adapters.getPendingButtonAction?.(backlogId);
  const action = classifyWithPendingButton(text, pending);
  if (pending) {
    await adapters.clearPendingButtonAction?.(backlogId);
  }
  const contextText = action.kind === 'amend' ? action.note : text;
  const posted = await adapters.postOperatorContext(backlogId, contextText, updateId);
  // BL-357/BL-409: fires alongside the context post above, never instead of
  // it - a reply that resolves a ticket is still ALSO context for it.
  if (action.kind === 'approve') {
    await recordApprovalDecisionAndClose(adapters, backlogId, { kind: 'approved' });
  } else if (action.kind === 'reject') {
    await recordApprovalDecisionAndClose(adapters, backlogId, { kind: 'rejected', reason: action.reason });
  }
  return posted;
}

// The three Approvals-topic-reply variants of BotUpdateDecision, narrowed
// out so deliverApprovalsTopicReply's own internal `decision.action ===
// 'approvals-topic-unrecognized'` guard actually narrows `decision` down to
// the two backlogId-carrying variants for the compiler - the FULL
// BotUpdateDecision union (its other branches carry no backlogId at all)
// cannot narrow that way.
type ApprovalsTopicReplyDecision = Extract<BotUpdateDecision, { action: 'approvals-topic-approve' | 'approvals-topic-reject' | 'approvals-topic-unrecognized' }>;

// Narrows AND collapses the three-way OR below into one call - split out so
// processMessageUpdate's own branch count (one decision point per `if`, plus
// one per `||`) stays at or below this file's CRAP threshold, the same
// "extract to keep CRAP down" convention this file already applies (e.g.
// openTopicIdFor for the open-default/open-for-topic pair above).
function isApprovalsTopicReplyDecision(decision: BotUpdateDecision): decision is ApprovalsTopicReplyDecision {
  return decision.action === 'approvals-topic-approve' || decision.action === 'approvals-topic-reject' || decision.action === 'approvals-topic-unrecognized';
}

// BL-434: the Approvals-topic reply's own delivery - reuses the EXISTING
// recordApprovalReply/recordRejectionReply adapters (never a second
// approval-recording path, per the ticket's own instruction) and their own
// boolean `changed` result to distinguish "this id really was pending, now
// recorded" from "this id was not pending" - never a separate pending-check
// adapter, since both already refuse to write a non-pending (or unknown)
// ticket and report that refusal via their return value. An unrecognized
// reply (no verb+id at all) and a not-currently-pending id are both
// DELIBERATE DROPS, never delivery FAILURES (the engineering article's own
// "a deliberate drop is terminal, never a retryable failure" rule) - the
// offset must advance past either, so neither one ever blocks re-polling.
async function deliverApprovalsTopicReply(decision: ApprovalsTopicReplyDecision, topicId: number | undefined, adapters: PollAdapters): Promise<UpdateDeliveryOutcome> {
  if (decision.action === 'approvals-topic-unrecognized') {
    return 'dropped';
  }
  const { backlogId } = decision;
  const changed =
    decision.action === 'approvals-topic-approve'
      ? await recordApprovalDecisionAndClose(adapters, backlogId, { kind: 'approved' })
      : await recordApprovalDecisionAndClose(adapters, backlogId, { kind: 'rejected', reason: decision.reason });
  if (!changed) {
    await adapters.notifyApprovalsTopic?.(topicId, `${backlogId} isn't awaiting approval.`);
    return 'dropped';
  }
  return 'posted';
}

// The five Recert-topic-reply variants of BotUpdateDecision, narrowed out so
// deliverRecertTopicReply's own internal `decision.action` guards actually
// narrow `decision` down for the compiler - same reason
// ApprovalsTopicReplyDecision exists above.
type RecertTopicReplyDecision = Extract<
  BotUpdateDecision,
  { action: 'recert-validate' | 'recert-amend' | 'recert-delete' | 'recert-confirm-delete' | 'recert-unrecognized' }
>;

// Collapses the five-way OR below into one call - same CRAP-budget reason as
// isApprovalsTopicReplyDecision above.
function isRecertTopicReplyDecision(decision: BotUpdateDecision): decision is RecertTopicReplyDecision {
  return (
    decision.action === 'recert-validate' ||
    decision.action === 'recert-amend' ||
    decision.action === 'recert-delete' ||
    decision.action === 'recert-confirm-delete' ||
    decision.action === 'recert-unrecognized'
  );
}

// recert-telegram-06: resolves a bare "confirm" reply against whichever
// scenario's delete is currently pending (getPendingRecertDelete) - no
// pending delete at all is a silent drop (nothing to confirm, never a
// "not awaiting recertification" surfacing, since no scenario id was even
// named in THIS reply). Clears the pending marker before queuing so a
// stale double-confirm can never queue twice. Split out of
// deliverRecertTopicReply below for the same CRAP-budget reason
// deliverApprovalsTopicReply's own extraction pattern already establishes
// throughout this file.
async function deliverRecertConfirmDelete(topicId: number | undefined, adapters: PollAdapters): Promise<UpdateDeliveryOutcome> {
  const pendingId = await adapters.getPendingRecertDelete?.();
  if (!pendingId) {
    return 'dropped';
  }
  await adapters.clearPendingRecertDelete?.();
  const queued = await adapters.queueRecertDeleteProposal?.(pendingId);
  if (!queued) {
    await adapters.notifyRecertTopic?.(topicId, `${pendingId} isn't awaiting recertification.`);
    return 'dropped';
  }
  return 'posted';
}

// recert-telegram-05: "delete <id>" never queues a proposal itself - it only
// ever ARMS the confirmation gate (BL-150 recert-04), after checking the
// named scenario is genuinely up for recert (never arming a confirmation
// for a fabricated/stale id - front-desk-operator-fabricates-backlog-state
// memory). Split out for the same CRAP-budget reason as
// deliverRecertConfirmDelete above.
async function deliverRecertDeleteRequest(scenarioId: string, topicId: number | undefined, adapters: PollAdapters): Promise<UpdateDeliveryOutcome> {
  const upForRecert = await adapters.isScenarioUpForRecert?.(scenarioId);
  if (!upForRecert) {
    await adapters.notifyRecertTopic?.(topicId, `${scenarioId} isn't awaiting recertification.`);
    return 'dropped';
  }
  await adapters.setPendingRecertDelete?.(scenarioId);
  await adapters.notifyRecertTopic?.(topicId, `Reply "confirm" to delete ${scenarioId}, or anything else to cancel.`);
  return 'posted';
}

// BL-450: the Recert-topic reply's own delivery - reuses the EXISTING
// recordRecertValidate/queueRecertAmendProposal/queueRecertDeleteProposal
// adapters (never a second recording path, per the ticket's own
// instruction) and their own boolean result to distinguish "this id really
// was up for recert, now recorded/queued" from "this id was not up for
// recert" - the SAME "the writer is the check" posture
// deliverApprovalsTopicReply already established. An unrecognized reply and
// a not-currently-up-for-recert id are both DELIBERATE DROPS, never
// delivery FAILURES (the engineering article's own drop-vs-failure rule) -
// the offset must advance past either.
async function deliverRecertTopicReply(decision: RecertTopicReplyDecision, topicId: number | undefined, adapters: PollAdapters): Promise<UpdateDeliveryOutcome> {
  if (decision.action === 'recert-unrecognized') {
    return 'dropped';
  }
  if (decision.action === 'recert-confirm-delete') {
    return deliverRecertConfirmDelete(topicId, adapters);
  }
  if (decision.action === 'recert-delete') {
    return deliverRecertDeleteRequest(decision.scenarioId, topicId, adapters);
  }
  const { scenarioId } = decision;
  const changed =
    decision.action === 'recert-validate'
      ? await adapters.recordRecertValidate?.(scenarioId)
      : await adapters.queueRecertAmendProposal?.(scenarioId, decision.newText);
  if (!changed) {
    await adapters.notifyRecertTopic?.(topicId, `${scenarioId} isn't awaiting recertification.`);
    return 'dropped';
  }
  return 'posted';
}

// Which reserved standing-topic's own delivery a decision resolves to, if
// any - collapsed into one dispatch so processMessageUpdate's own branch
// count does not grow one-for-one with every new reserved subject (the
// same CRAP-budget reason the decide* split above exists). undefined means
// the decision is not a reserved-subject reply at all - the caller falls
// through to its own ordinary post-existing/open handling.
async function deliverReservedSubjectReply(
  decision: BotUpdateDecision,
  topicId: number | undefined,
  adapters: PollAdapters
): Promise<UpdateDeliveryOutcome | undefined> {
  if (isApprovalsTopicReplyDecision(decision)) {
    return deliverApprovalsTopicReply(decision, topicId, adapters);
  }
  if (isRecertTopicReplyDecision(decision)) {
    return deliverRecertTopicReply(decision, topicId, adapters);
  }
  return undefined;
}

// BL-410: the callback-query twin of decideUpdateAction above - given a
// tapped inline-keyboard button, decides whether to act on it at all (the
// SAME my-chat-then-principal guard order as decideUpdateAction, and for
// the identical reason: a foreign chat is refused before who-sent-it is
// even considered) and, if so, which of the three buttons was tapped.
// Pure: no I/O, directly testable with a plain fixture callback_query.
// BL-483: an options-carrying ask's own tappable-button shape. label is what
// the button reads AND what rides the answer effect path (postToBridge)
// exactly as if the human had typed it; description is optional message-body
// context, never carried on the button itself (Telegram inline-keyboard
// buttons have no subtitle).
export interface AskOption {
  label: string;
  description?: string;
}

export type CallbackButtonDecision =
  | { action: 'approve'; backlogId: string }
  | { action: 'await-followup'; backlogId: string; kind: 'reject' | 'amend' }
  | { action: 'answer-ask'; threadId: string; optionIndex: number }
  | { action: 'drop'; reason: 'not-my-chat' | 'not-principal' | 'unrecognized-data' };

const CALLBACK_DATA_PATTERN = /^(approve|reject|amend):(.+)$/;
// BL-483: an ask option's own callback_data - an option INDEX + the ask's
// threadId, never the label text (the ticket's own "callback_data <= 64
// bytes" constraint - a label is unbounded, an index plus a short SUP-###
// id comfortably is not). threadId itself is `[^:]+` (never contains a
// colon - support_lib.bb's own SUP-<n> id shape), so the trailing `:<digits>`
// unambiguously anchors the option index even if a future id shape changed.
const ASK_CALLBACK_DATA_PATTERN = /^ask:([^:]+):(\d+)$/;

// The callback_query twins of isFromMyChat/isFromPrincipal above - same
// checks, read off TelegramCallbackQuery's own from/message.chat fields
// instead of TelegramUpdate's - split out (rather than inlined as compound
// `||` conditions) so decideCallbackQueryAction's own branch count stays at
// or below the CRAP threshold, the same "extract the ternary/guard into a
// named, tested helper" split this file already uses (see deliveryOutcome).
function isCallbackFromMyChat(callbackQuery: TelegramCallbackQuery, chatId: string): boolean {
  const cqChatId = callbackQuery.message?.chat?.id;
  return cqChatId !== undefined && String(cqChatId) === String(chatId);
}

function isCallbackFromPrincipal(callbackQuery: TelegramCallbackQuery, principalUserId: string): boolean {
  const fromId = callbackQuery.from?.id;
  return fromId !== undefined && String(fromId) === String(principalUserId);
}

export function decideCallbackQueryAction(
  callbackQuery: TelegramCallbackQuery,
  principalUserId: string,
  chatId: string
): CallbackButtonDecision {
  if (!isCallbackFromMyChat(callbackQuery, chatId)) {
    return { action: 'drop', reason: 'not-my-chat' };
  }
  if (!isCallbackFromPrincipal(callbackQuery, principalUserId)) {
    return { action: 'drop', reason: 'not-principal' };
  }
  // BL-483: checked ahead of the approve/reject/amend pattern - a distinct
  // literal callback_data namespace ("ask:" vs "approve:"/"reject:"/
  // "amend:"), so the two can never collide; order between them is
  // otherwise inconsequential.
  const askMatch = callbackQuery.data?.match(ASK_CALLBACK_DATA_PATTERN);
  if (askMatch) {
    const [, threadId, optionIndexText] = askMatch;
    return { action: 'answer-ask', threadId, optionIndex: Number(optionIndexText) };
  }
  const match = callbackQuery.data?.match(CALLBACK_DATA_PATTERN);
  if (!match) {
    return { action: 'drop', reason: 'unrecognized-data' };
  }
  const [, kind, backlogId] = match;
  return kind === 'approve' ? { action: 'approve', backlogId } : { action: 'await-followup', backlogId, kind: kind as 'reject' | 'amend' };
}

// A legitimate tap (right chat, right principal) always clears its own
// spinner, even when its data is unrecognized/stale - only a
// not-my-chat/not-principal tap is answered never (mirrors the ordinary
// message path's own silent drop for the same two reasons). Split out of
// processCallbackQuery below for the same CRAP-budget reason as
// isNoopControlDecision above.
function isUnauthorizedCallbackDrop(decision: CallbackButtonDecision): boolean {
  return decision.action === 'drop' && (decision.reason === 'not-my-chat' || decision.reason === 'not-principal');
}

// BL-484: a tap on an ALREADY-DECIDED ask is stale - answered with an
// informative toast naming the recorded verdict, no decision side effect
// at all (no recordApprovalReply, no setPendingButtonAction) - the exact
// "acting on a stale question's answer" class of incident this guard
// exists to prevent. Checked for every recognized (non-drop) decision -
// Approve, Reject, and Amend taps alike - since any of the three can be
// tapped again after the ticket already resolved. readRecordedApprovalVerdict
// absent (pre-BL-484 fixtures) or reporting undefined (still pending, or no
// matching ticket) means this returns false - the tap proceeds exactly as
// it did before this ticket. Split out of processCallbackQuery below so its
// own branch count stays at or below the CRAP threshold - the same
// "extract the guard into a named, tested helper" split this file already
// uses for isUnauthorizedCallbackDrop above.
async function answerIfAlreadyDecided(callbackQuery: TelegramCallbackQuery, decision: CallbackButtonDecision, adapters: PollAdapters): Promise<boolean> {
  if (decision.action === 'drop' || decision.action === 'answer-ask') {
    return false;
  }
  const recordedVerdict = await adapters.readRecordedApprovalVerdict?.(decision.backlogId);
  if (!recordedVerdict) {
    return false;
  }
  await adapters.answerCallbackQuery(callbackQuery.id, alreadyDecidedToastText(recordedVerdict));
  return true;
}

const ASK_CLOSED_TOAST_TEXT = 'This question is no longer open.';
const ASK_CLOSED_MESSAGE_SUFFIX = '\n\n-- No longer open.';

// BL-483: mirrors composeDecidedAskText/editApprovalAskMessage's own
// "strip the original message down to a closed-state notice" shape, kept
// local (rather than imported from approvalAskClosing.ts) since that
// module's own domain is a BACKLOG TICKET's human_approval verdict, not an
// ask's answer - a different concept that happens to need a similar edit.
function composeAskAnsweredText(originalText: string, answerLabel: string): string {
  return `${originalText}\n\n-- Answered: ${answerLabel}`;
}

function composeAskClosedText(originalText: string): string {
  return `${originalText}${ASK_CLOSED_MESSAGE_SUFFIX}`;
}

// BL-483: edits the posted ask message to a closed-state notice, if this
// codebase's wiring recorded one (readAskMessage/editAskMessage both
// optional - absent means "no message to edit", never a crash, same
// "new capability degrades to a no-op" posture as every other optional
// adapter pair in this file).
async function editAskMessageIfKnown(threadId: string, composeText: (originalText: string) => string, adapters: PollAdapters): Promise<void> {
  const message = await adapters.readAskMessage?.(threadId);
  if (!message) {
    return;
  }
  await adapters.editAskMessage?.(message.topicId, message.messageId, composeText(message.text));
}

// BL-483: a tap on a RETRACTED or ALREADY-ANSWERED ask is stale - answered
// with a toast, its message edited to a "no longer open" notice, NO answer
// side effect at all (no postToBridge) - the exact "acting on a stale
// question's answer" class of incident BL-484's own answerIfAlreadyDecided
// above exists to prevent, applied to an ask instead of an approval.
// resolveAskOptions doubles as the openness check (see its own PollAdapters
// comment): undefined means this thread's ask is not (or no longer) the
// one pending. Absent adapter means "cannot confirm either way" - proceeds
// exactly as before this ticket, the same "missing adapter never invents a
// staleness verdict" posture answerIfAlreadyDecided already established.
async function answerIfAskAlreadyClosed(callbackQuery: TelegramCallbackQuery, decision: CallbackButtonDecision, adapters: PollAdapters): Promise<boolean> {
  if (decision.action !== 'answer-ask' || !adapters.resolveAskOptions) {
    return false;
  }
  const options = await adapters.resolveAskOptions(decision.threadId);
  if (options) {
    return false;
  }
  await adapters.answerCallbackQuery(callbackQuery.id, ASK_CLOSED_TOAST_TEXT);
  await editAskMessageIfKnown(decision.threadId, composeAskClosedText, adapters);
  return true;
}

// BL-483: the tapped option's label rides back through postToBridge exactly
// as if the human had typed it - the SAME shared answer effect path
// processPollAnswer above already established for BL-466's poll answer
// (this ticket's own "one effect path, never a second one" constraint).
// An option index the resolved options no longer has (a stale/malformed
// tap) is a deliberate DROP, never a delivery failure - it can never
// succeed on retry, the same posture processPollAnswer's own "recorded
// options no longer has" branch already uses.
async function deliverAskAnswer(
  callbackQuery: TelegramCallbackQuery,
  decision: { threadId: string; optionIndex: number },
  updateId: number,
  adapters: PollAdapters
): Promise<UpdateDeliveryOutcome> {
  // Every recognized-chat/principal tap clears its own spinner, even a
  // no-op one (an index the resolved options no longer has) - the same
  // "never hangs" requirement isUnauthorizedCallbackDrop's own comment
  // states for the approve/reject/amend taps above.
  await adapters.answerCallbackQuery(callbackQuery.id);
  const options = adapters.resolveAskOptions ? await adapters.resolveAskOptions(decision.threadId) : undefined;
  const answerLabel = options?.[decision.optionIndex]?.label;
  if (answerLabel === undefined) {
    return 'dropped';
  }
  const ok = await adapters.postToBridge(decision.threadId, answerLabel, updateId);
  if (ok) {
    await editAskMessageIfKnown(decision.threadId, (originalText) => composeAskAnsweredText(originalText, answerLabel), adapters);
  }
  return deliveryOutcome(ok);
}

// Hardener 2026-07-17: split out of processCallbackQuery below so ITS OWN
// branch count stays at or below the CRAP threshold - the same "extract to
// keep the caller's branch count down" pattern this file already uses
// throughout (isUnauthorizedCallbackDrop, deliveryOutcome, processUpdate's
// own callback_query/poll_answer split) - reapplied here because BL-483's
// answer-ask branch pushed processCallbackQuery's own complexity to 8.
// Handles every RECOGNIZED (non-drop) decision once the caller has already
// checked the control: namespace and the unauthorized-drop guard.
//
// BL-410/BL-483: an Approve tap fires recordApprovalDecisionAndClose
// immediately (nothing else to gather); a Reject/Amend tap has no
// reason/note in hand yet, so it only ever stashes the pending marker
// deliverOperatorContext above consults on the next reply - never
// reimplementing recordRejectionReply/the amend effect here. An ask-option
// tap has its own stale-check/effect/close shape, entirely distinct from
// the approval-ask dispatch below (readRecordedApprovalVerdict vs
// resolveAskOptions, postToBridge vs recordApprovalDecisionAndClose) -
// dispatched before answerIfAlreadyDecided, which only ever reads
// decision.backlogId (absent on an 'answer-ask' decision).
async function dispatchRecognizedCallbackDecision(
  callbackQuery: TelegramCallbackQuery,
  decision: CallbackButtonDecision,
  updateId: number,
  adapters: PollAdapters
): Promise<UpdateDeliveryOutcome> {
  if (decision.action === 'answer-ask') {
    if (await answerIfAskAlreadyClosed(callbackQuery, decision, adapters)) {
      return 'dropped';
    }
    return deliverAskAnswer(callbackQuery, decision, updateId, adapters);
  }
  if (await answerIfAlreadyDecided(callbackQuery, decision, adapters)) {
    return 'dropped';
  }
  await adapters.answerCallbackQuery(callbackQuery.id);
  if (decision.action === 'drop') {
    return 'dropped';
  }
  if (decision.action === 'approve') {
    await recordApprovalDecisionAndClose(adapters, decision.backlogId, { kind: 'approved' });
  } else {
    await adapters.setPendingButtonAction(decision.backlogId, decision.kind);
  }
  return 'posted';
}

async function processCallbackQuery(
  callbackQuery: TelegramCallbackQuery,
  principalUserId: string,
  updateId: number,
  adapters: PollAdapters
): Promise<UpdateDeliveryOutcome> {
  // BL-423: the control: callback_data namespace is checked FIRST and
  // completely separately from the approve/reject/amend dispatch below -
  // decideCallbackQueryAction's own CALLBACK_DATA_PATTERN would otherwise
  // treat every control: tap as 'unrecognized-data' and drop it before this
  // module ever saw it. Any OTHER callback_data (including no data at all)
  // falls through to the existing dispatch completely unaffected.
  const controlOutcome = await attemptControlCallbackDelivery(callbackQuery, principalUserId, adapters);
  if (controlOutcome) {
    return controlOutcome;
  }
  const decision = decideCallbackQueryAction(callbackQuery, principalUserId, adapters.chatId);
  if (isUnauthorizedCallbackDrop(decision)) {
    return 'dropped';
  }
  return dispatchRecognizedCallbackDecision(callbackQuery, decision, updateId, adapters);
}

// Split out of processUpdate below so its own branch count stays at or
// below the CRAP threshold - the same "extract the ternary into a named,
// tested helper" split deliverOperatorContext above already uses for the
// identical reason (BL-357), reapplied here because BL-389's outcome
// mapping (ok -> 'posted' | 'failed') pushed processUpdate's CRAP to 8.
function deliveryOutcome(ok: boolean): UpdateDeliveryOutcome {
  return ok ? 'posted' : 'failed';
}

// BL-466: a poll_answer resolves via resolvePollThread (poll id -> the
// SUP-### thread that asked it + its own options - recorded by
// recordPollMapping at send time, ReplyRelayAdapters below), then the
// selected option's TEXT is fed back through postToBridge exactly as if the
// human had typed it as an ordinary reply - the ticket's own hard
// constraint ("do NOT build a parallel answer path"), reusing BL-325's
// existing awaiting-answer/unblock machinery unchanged. Every branch here is
// a deliberate DROP (not wired, unknown/stale poll id, a selected index the
// recorded options no longer has) - never a delivery FAILURE, since none of
// these can ever succeed on retry.
async function processPollAnswer(
  pollAnswer: TelegramPollAnswer,
  principalUserId: string,
  updateId: number,
  adapters: PollAdapters
): Promise<UpdateDeliveryOutcome> {
  const decision = decidePollAnswerAction(pollAnswer, principalUserId);
  if (decision.kind === 'drop' || !adapters.resolvePollThread) {
    return 'dropped';
  }
  const resolved = await adapters.resolvePollThread(decision.pollId);
  if (!resolved) {
    return 'dropped';
  }
  const selectedText = resolved.options[decision.optionIndex];
  if (selectedText === undefined) {
    return 'dropped';
  }
  const ok = await adapters.postToBridge(resolved.threadId, selectedText, updateId);
  return deliveryOutcome(ok);
}

// BL-410: a callback_query update carries no `message` of its own (they are
// mutually exclusive Telegram update shapes) - routed to its own decision
// path before decideUpdateAction (which reads update.message) is reached.
// Split out as its own dispatcher (rather than an early return inside
// processMessageUpdate below) so THAT function's own branch count stays
// exactly at its pre-BL-410 baseline, the same "extract so branch count
// stays at or below the CRAP threshold" reasoning as deliveryOutcome above.
// BL-466: a poll_answer update is the third, mutually-exclusive update
// shape (alongside callback_query/message) - checked here, ahead of the
// ordinary message path, for the same structural reason as callback_query.
async function processUpdate(update: TelegramUpdate, principalUserId: string, adapters: PollAdapters): Promise<UpdateDeliveryOutcome> {
  if (update.callback_query) {
    return processCallbackQuery(update.callback_query, principalUserId, update.update_id, adapters);
  }
  if (update.poll_answer) {
    return processPollAnswer(update.poll_answer, principalUserId, update.update_id, adapters);
  }
  return processMessageUpdate(update, principalUserId, adapters);
}

// BL-425 slice 1: the role-steering twin of deliverOperatorContext above -
// split out so processMessageUpdate's own branch count stays at its
// pre-BL-425 baseline (the same "extract so branch count stays at or below
// the CRAP threshold" reasoning this file already applies throughout).
// Returns undefined for an 'ignore' decision (not a role topic at all) so
// the caller falls through to the existing decideUpdateAction routing
// completely unaffected - only a message confirmed to be IN a role topic
// ever short-circuits here.
async function processSteeringUpdate(
  update: TelegramUpdate,
  principalUserId: string,
  chatId: string,
  roleTopicMap: Record<string, number>,
  redirectToRole: (role: string, text: string) => Promise<void>
): Promise<UpdateDeliveryOutcome | undefined> {
  const decision = decideSteeringAction(update, principalUserId, chatId, roleTopicMap);
  if (decision.kind === 'ignore') {
    return undefined;
  }
  if (decision.kind === 'refuse') {
    return 'dropped';
  }
  await redirectToRole(decision.role, decision.text);
  return 'posted';
}

// BL-425 slice 1 (cleaner): the readRoleTopicMap/redirectToRole optional-pair
// guard ahead of processSteeringUpdate above, split out so
// processMessageUpdate's own branch count stays at or below the CRAP
// threshold - adding this guard is exactly what pushed it over (same
// "extract so branch count stays low" reasoning this file already applies
// throughout). Returns undefined both when steering isn't wired at all AND
// when processSteeringUpdate itself says 'ignore' (not a role topic) - the
// caller treats both identically: fall through to the pre-BL-425 routing.
async function attemptSteeringDelivery(
  update: TelegramUpdate,
  principalUserId: string,
  adapters: PollAdapters
): Promise<UpdateDeliveryOutcome | undefined> {
  if (!adapters.readRoleTopicMap || !adapters.redirectToRole) {
    return undefined;
  }
  return processSteeringUpdate(update, principalUserId, adapters.chatId, adapters.readRoleTopicMap(), adapters.redirectToRole);
}

// Pure: which topic id (if any) an 'open-default'/'open-for-topic' decision
// opens - split out of processMessageUpdate below for the same CRAP-budget
// reason as attemptSteeringDelivery above.
function openTopicIdFor(decision: BotUpdateDecision): number | undefined {
  return decision.action === 'open-for-topic' ? decision.topicId : undefined;
}

// Collapses the open-default/open-for-topic OR into one call - same
// CRAP-budget reason as isApprovalsTopicReplyDecision above. A type guard
// (not a plain boolean) so the narrowed `decision.text` access below the
// call site still type-checks.
function isOpenDecision(decision: BotUpdateDecision): decision is Extract<BotUpdateDecision, { action: 'open-default' | 'open-for-topic' }> {
  return decision.action === 'open-default' || decision.action === 'open-for-topic';
}

// BL-426 slice 1: the voice-note twin of attemptSteeringDelivery above -
// optional adapter, defaults to "voice not wired" so every PollAdapters
// fixture written before BL-426 keeps working unchanged (same convention as
// readRoleTopicMap/redirectToRole).
//
// A transient STT failure returns 'failed', deliberately reusing
// pollAndForward/offsetAfterDelivery's EXISTING bounded-retry machinery
// (offsetAfterDelivery stops advancing the offset at the first 'failed'
// outcome, and runPollCycle's stuckAttempts/shouldEscalateStuckDelivery
// already escalate a sustained one) rather than inventing a second retry
// mechanism - the same voice note is simply redelivered by Telegram on the
// next poll cycle since the offset never advanced past it, and each such
// redelivery IS the bounded retry.
// Split out of attemptVoiceDelivery below for the same CRAP-budget reason
// as attemptSteeringDelivery/openTopicIdFor above - maps a non-'ok' SttResult
// to its delivery outcome (transient -> 'failed', reusing the bounded-retry
// machinery per the comment below; unprocessable -> 'dropped').
function sttFailureOutcome(stt: Exclude<SttResult, { kind: 'ok' }>): UpdateDeliveryOutcome {
  return stt.kind === 'transient-failure' ? 'failed' : 'dropped';
}

async function attemptVoiceDelivery(
  update: TelegramUpdate,
  principalUserId: string,
  adapters: PollAdapters
): Promise<UpdateDeliveryOutcome | undefined> {
  if (!adapters.transcribeVoice) {
    return undefined;
  }
  const decision = decideVoiceUpdateAction(update, principalUserId, adapters.chatId, adapters.subjectForTopic);
  if (decision.kind === 'not-applicable') {
    return undefined;
  }
  if (decision.kind === 'refuse') {
    return 'dropped';
  }
  const stt = await adapters.transcribeVoice(decision.fileId);
  if (stt.kind !== 'ok') {
    return sttFailureOutcome(stt);
  }
  const posted = await adapters.postToBridge(OPERATOR_SUBJECT_ID, stt.transcript, update.update_id);
  if (posted) {
    await adapters.markVoiceOriginatedTurn?.(OPERATOR_SUBJECT_ID);
  }
  return deliveryOutcome(posted);
}

// BL-423: the ONE place a decided control action becomes a real effect -
// every entry is a thin, opaque call into an injected adapter (the ticket's
// own "adapter-injected orchestration" split), never a second decision. A
// missing optional adapter degrades to "that effect is simply not wired"
// (this file's established optional-adapter convention throughout), never a
// crash - so a fixture that only wires SOME control effects still exercises
// the rest of the dispatch correctly. Table-driven (rather than a switch)
// so dispatch itself stays a single lookup; TypeScript's Record type below
// still requires every non-'apply-pause' action to have an entry, so a new
// action added to ControlDecision without a handler here is a compile error,
// the same exhaustiveness guarantee a switch's `default: assertNever` gives.
type ControlDecisionEffect = (adapters: PollAdapters) => Promise<void>;

const CONTROL_DECISION_EFFECTS: Record<Exclude<ControlDecision['action'], 'apply-pause'>, ControlDecisionEffect> = {
  ignore: async () => {},
  refuse: async () => {},
  'prompt-stop-modes': async (adapters) => {
    await adapters.setPendingControlConfirm?.({ kind: 'stop-modes' });
    await adapters.postControlStopModesMenu?.();
  },
  'prompt-restart-confirm': async (adapters) => {
    await adapters.setPendingControlConfirm?.({ kind: 'restart-confirm' });
    await adapters.postControlRestartConfirm?.();
  },
  cancel: async (adapters) => {
    await adapters.setPendingControlConfirm?.(undefined);
    await adapters.postControlCancelled?.();
  },
  'execute-emergency-stop': async (adapters) => {
    await adapters.setPendingControlConfirm?.(undefined);
    await adapters.executeEmergencyStop?.();
  },
  'execute-drain-stop': async (adapters) => {
    await adapters.setPendingControlConfirm?.(undefined);
    await adapters.executeDrainStop?.();
  },
  'execute-restart': async (adapters) => {
    await adapters.setPendingControlConfirm?.(undefined);
    await adapters.executeRestart?.();
  },
  'post-pause-menu': async (adapters) => {
    await adapters.postControlPauseMenu?.();
  },
  'resume-now': async (adapters) => {
    await adapters.resumeNow?.();
  },
};

async function applyControlDecision(decision: ControlDecision, adapters: PollAdapters): Promise<void> {
  if (decision.action === 'apply-pause') {
    await adapters.applyPause?.(decision.durationMs);
    return;
  }
  await CONTROL_DECISION_EFFECTS[decision.action](adapters);
}

// Shared by attemptControlTextDelivery/attemptControlCallbackDelivery below -
// both need the SAME pending-confirm/pause state read before deciding, so
// this is a DRY extraction as much as a CRAP-budget one (the same "extract
// so branch count stays at or below the CRAP threshold" reasoning this file
// applies throughout, here also removing a literal duplicate pair of lines).
async function gatherControlState(adapters: PollAdapters): Promise<{ pendingConfirm: PendingControlConfirm; pauseState: PauseState }> {
  const pendingConfirm = (await adapters.getPendingControlConfirm?.()) ?? undefined;
  const pauseState = (await adapters.getPauseState?.()) ?? { active: false };
  return { pendingConfirm, pauseState };
}

// Telegram's `from` is optional on both a message and a callback query;
// ControlEvent.fromId has no such optionality, so both call sites fold a
// missing id to '' the same way - split out for the same CRAP-budget reason
// as gatherControlState above.
function fallbackFromId(id: string | number | undefined): string | number {
  return id ?? '';
}

// Split out of attemptControlTextDelivery/attemptControlCallbackDelivery
// below for the same CRAP-budget reason as gatherControlState above.
function isNoopControlDecision(decision: ControlDecision): boolean {
  return decision.action === 'ignore' || decision.action === 'refuse';
}

// Split out of attemptControlTextDelivery below for the same CRAP-budget
// reason as gatherControlState above: a message is outside the Control
// topic both when the topic isn't bound yet (controlTopicId undefined) and
// when it's bound to a DIFFERENT topic than this message's own.
function isOutsideControlTopic(controlTopicId: number | undefined, update: TelegramUpdate): boolean {
  return controlTopicId === undefined || topicIdOf(update) !== controlTopicId;
}

// BL-423: gathers the pending-confirm/pause state and dispatches through
// decideControlEventAction - the ONE place a text message becomes a
// ControlEvent. controlTopicId absent (not wired) or the message being
// outside the Control topic both return undefined (not applicable), so
// ordinary routing continues completely unaffected - the Control topic is
// reserved (like Agent Questions/Approvals/Recert), so once a message IS
// confirmed to be in it, this NEVER falls through further: even
// unrecognized chatter resolves to a concrete 'dropped', never an
// open-for-topic fresh subject.
async function attemptControlTextDelivery(
  update: TelegramUpdate,
  principalUserId: string,
  adapters: PollAdapters
): Promise<UpdateDeliveryOutcome | undefined> {
  if (!adapters.controlTopicId) {
    return undefined;
  }
  const controlTopicId = await adapters.controlTopicId();
  if (isOutsideControlTopic(controlTopicId, update)) {
    return undefined;
  }
  const text = messageTextOf(update);
  if (!text) {
    return 'dropped';
  }
  const event: ControlEvent = { kind: 'text', text, fromId: fallbackFromId(update.message?.from?.id), topicId: controlTopicId };
  const { pendingConfirm, pauseState } = await gatherControlState(adapters);
  const decision = decideControlEventAction(event, principalUserId, controlTopicId, pendingConfirm, pauseState);
  if (isNoopControlDecision(decision)) {
    return 'dropped';
  }
  await applyControlDecision(decision, adapters);
  return 'posted';
}

// BL-423: the callback-tap twin of attemptControlTextDelivery above - only
// ever engages for the control: callback_data namespace (never the
// approve/reject/amend one), so a tap on any OTHER button falls through to
// the existing dispatch completely unaffected, even one tapped inside the
// Control topic somehow. A 'refuse' (unauthorised tap) never answers the
// spinner (BL-410's own "not this bot's spinner to clear" posture for an
// unauthorised tap); every other outcome - including a stale/mismatched
// 'ignore' - answers it, since the tap IS a real one of this bot's own
// buttons.
async function attemptControlCallbackDelivery(
  callbackQuery: TelegramCallbackQuery,
  principalUserId: string,
  adapters: PollAdapters
): Promise<UpdateDeliveryOutcome | undefined> {
  if (!adapters.controlTopicId || !callbackQuery.data?.startsWith('control:')) {
    return undefined;
  }
  const controlTopicId = await adapters.controlTopicId();
  const event: ControlEvent = {
    kind: 'callback',
    data: callbackQuery.data,
    fromId: fallbackFromId(callbackQuery.from?.id),
    topicId: callbackQuery.message?.message_thread_id,
  };
  const { pendingConfirm, pauseState } = await gatherControlState(adapters);
  const decision = decideControlEventAction(event, principalUserId, controlTopicId, pendingConfirm, pauseState);
  if (decision.action === 'refuse') {
    return 'dropped';
  }
  await adapters.answerCallbackQuery(callbackQuery.id);
  if (decision.action === 'ignore') {
    return 'dropped';
  }
  await applyControlDecision(decision, adapters);
  return 'posted';
}

// BL-466: the Agent Questions topic's own side channel - optional adapter
// (agentQuestionsTopicId), defaults to "not wired" so every PollAdapters
// fixture written before BL-466 keeps working unchanged, same convention as
// attemptVoiceDelivery/attemptSteeringDelivery above. A message in that
// topic never falls through to the ordinary decideUpdateAction routing
// below (see decideAgentQuestionsReplyAction's own comment) - 'refuse'
// (wrong chat/principal/no text) and "no question currently pending" both
// drop here, never open a fresh SUP-### the way an ordinary unmapped topic
// would.
async function attemptAgentQuestionsTopicDelivery(
  update: TelegramUpdate,
  principalUserId: string,
  adapters: PollAdapters
): Promise<UpdateDeliveryOutcome | undefined> {
  if (!adapters.agentQuestionsTopicId) {
    return undefined;
  }
  const topicId = await adapters.agentQuestionsTopicId();
  const decision = decideAgentQuestionsReplyAction(update, principalUserId, adapters.chatId, topicId);
  if (decision.kind === 'not-applicable') {
    return undefined;
  }
  if (decision.kind === 'refuse') {
    return 'dropped';
  }
  const pendingThreadId = await adapters.getPendingAgentQuestionThread?.();
  if (!pendingThreadId) {
    return 'dropped';
  }
  const ok = await adapters.postToBridge(pendingThreadId, decision.text, update.update_id);
  return deliveryOutcome(ok);
}

// Split out of processMessageUpdate below for the same CRAP-budget reason as
// attemptSteeringDelivery's own comment documents - composing the steering
// and voice side-channel attempts here (rather than as two separate ifs in
// processMessageUpdate) is that same precedent applied a second time: adding
// attemptVoiceDelivery as a third inline check is exactly what would push it
// over again.
// BL-466: the Agent Questions topic side channel is attempted LAST - it is
// the narrowest (topic-scoped) of the three, and ordering among the three
// never overlaps in practice (a role-steering topic, the coordinator's
// Operator topic, and the Agent Questions topic are three different bound
// topics), so this is a plain composition, never a priority decision.
async function attemptSideChannelDelivery(
  update: TelegramUpdate,
  principalUserId: string,
  adapters: PollAdapters
): Promise<UpdateDeliveryOutcome | undefined> {
  const steeringOutcome = await attemptSteeringDelivery(update, principalUserId, adapters);
  if (steeringOutcome) {
    return steeringOutcome;
  }
  const voiceOutcome = await attemptVoiceDelivery(update, principalUserId, adapters);
  if (voiceOutcome) {
    return voiceOutcome;
  }
  const controlOutcome = await attemptControlTextDelivery(update, principalUserId, adapters);
  if (controlOutcome) {
    return controlOutcome;
  }
  return attemptAgentQuestionsTopicDelivery(update, principalUserId, adapters);
}

async function processMessageUpdate(update: TelegramUpdate, principalUserId: string, adapters: PollAdapters): Promise<UpdateDeliveryOutcome> {
  const sideChannelOutcome = await attemptSideChannelDelivery(update, principalUserId, adapters);
  if (sideChannelOutcome) {
    return sideChannelOutcome;
  }
  const decision = decideUpdateAction(update, principalUserId, adapters.chatId, adapters.subjectForTopic, adapters.backlogForTopic);
  if (decision.action === 'post-existing') {
    const ok = await adapters.postToBridge(decision.subjectId, decision.text, update.update_id);
    return deliveryOutcome(ok);
  }
  if (decision.action === 'operator-context') {
    const ok = await deliverOperatorContext(decision.backlogId, decision.text, update.update_id, adapters);
    return deliveryOutcome(ok);
  }
  const reserved = await deliverReservedSubjectReply(decision, topicIdOf(update), adapters);
  if (reserved) {
    return reserved;
  }
  if (isOpenDecision(decision)) {
    await adapters.openSubjectAndRecord(openTopicIdFor(decision), decision.text, update.update_id);
    return 'posted';
  }
  // decision.action === 'drop': a DECISION, never a delivery attempt at
  // all - the offset must advance past it (see offsetAfterDelivery below).
  return 'dropped';
}

// BL-369 (bug #1, the keystone defect) / BL-389 (the fix for the fix): the
// offset must only ever STOP at a message whose delivery genuinely FAILED
// - never at one that was merely FETCHED (BL-369's own original framing),
// and never at one that was deliberately DROPPED either (BL-389: a drop is
// terminal, so refusing to advance past it is an unbounded retry of
// something that can never succeed - the exact mechanism that parked the
// offset forever and let Telegram redeliver the same batch every poll).
// Stops advancing at the FIRST 'failed' outcome in fetch order (never
// skips over it to ack a later one that happened to succeed) - a later
// update in the same batch is safely redelivered once the earlier failure
// clears, safe precisely because bridgeServer.ts's own ingest is
// idempotent by update_id (and, as of BL-389, so is postOperatorContext).
export function offsetAfterDelivery(updates: TelegramUpdate[], currentOffset: number, outcomes: UpdateDeliveryOutcome[]): number {
  let offset = currentOffset;
  for (let i = 0; i < updates.length; i++) {
    if (outcomes[i] === 'failed') {
      return offset;
    }
    offset = updates[i].update_id + 1;
  }
  return offset;
}

export interface PollResult {
  nextOffset: number;
  posted: number;
  dropped: number;
  // BL-389: a genuine delivery FAILURE, distinct from a deliberate DROP -
  // only `failed` blocks the offset (offsetAfterDelivery above); `dropped`
  // never does. Previously conflated into one `dropped` counter.
  failed: number;
  // BL-302: surfaces the poll CYCLE's own success/failure (getUpdates'
  // own result.success) - distinct from posted/dropped/failed, which
  // describe per-update OUTCOMES within a successful cycle. A failed cycle
  // has posted:0/dropped:0/failed:0 too, which was previously
  // indistinguishable from a legitimately-empty successful cycle - the
  // caller (pollLoop) needs to tell these apart to back off only on a
  // real failure.
  ok: boolean;
}

// Adapter-injected: one poll-and-forward cycle. Every update decision goes
// through decideUpdateAction (pure) above - this function's own job is
// just sequencing the adapters and counting outcomes, never a second
// decision path.
export async function pollAndForward(offset: number, principalUserId: string, adapters: PollAdapters): Promise<PollResult> {
  const result = await adapters.getUpdates(offset);
  if (!result.success) {
    return { nextOffset: offset, posted: 0, dropped: 0, failed: 0, ok: false };
  }
  let posted = 0;
  let dropped = 0;
  let failed = 0;
  const outcomes: UpdateDeliveryOutcome[] = [];
  for (const update of result.updates) {
    const outcome = await processUpdate(update, principalUserId, adapters);
    outcomes.push(outcome);
    if (outcome === 'posted') {
      posted += 1;
    } else if (outcome === 'dropped') {
      dropped += 1;
    } else {
      failed += 1;
    }
  }
  return { nextOffset: offsetAfterDelivery(result.updates, offset, outcomes), posted, dropped, failed, ok: true };
}

// ── BL-302: poll-loop resilience (bounded backoff, escalation, isolation) ──

export interface PollBackoffConfig {
  backoffBaseMs: number;
  backoffMaxMs: number;
  // Consecutive FAILED cycles before raising a degraded warning. The
  // warning fires exactly once per outage streak (consecutiveFailures
  // strictly increases while failing and resets to 0 on success, so it
  // equals this threshold on exactly one cycle per streak) - mirrors
  // paneTailer's own "keeps failing... only pushes the message once"
  // posture, not a warning-per-cycle spam once deep into an outage.
  degradedThreshold: number;
  // BL-369 (scenario 05): consecutive CYCLES the SAME undelivered update has
  // blocked the offset (offsetAfterDelivery never advances past it) before
  // escalating directly to the human - distinct from degradedThreshold,
  // which counts whole-cycle getUpdates FAILURES, not per-message delivery
  // failures within an otherwise-successful cycle. Each retry is a full
  // poll cycle (the long-poll's own pacing is the backoff here, never a
  // real wait inside this file - see runPollCycle's own docstring).
  stuckRetryLimit: number;
}

// Reuses telegramRetry.ts's own exponential-capped math directly (the
// project's established bounded-backoff convention) rather than
// reimplementing it - that function only ever reads backoffBaseMs/
// backoffMaxMs, so maxAttempts here is a required-but-unused field of its
// TelegramRetryConfig shape.
export function computePollBackoffMs(consecutiveFailures: number, config: PollBackoffConfig): number {
  return computeTelegramRetryBackoffMs(consecutiveFailures, {
    maxAttempts: Number.MAX_SAFE_INTEGER,
    backoffBaseMs: config.backoffBaseMs,
    backoffMaxMs: config.backoffMaxMs,
  });
}

// Retry-forever-with-capped-backoff, escalate-on-sustained is a DELIBERATE
// departure from decideTelegramRetryAction's own retry|escalate=stop
// semantics - a chat bot must keep trying to self-recover when the
// network returns, so "escalate" here means "raise a visible warning",
// never "give up".
export function shouldRaiseDegradedWarning(consecutiveFailures: number, config: PollBackoffConfig): boolean {
  return consecutiveFailures === config.degradedThreshold;
}

// BL-369 (scenario 05): same exactly-once-per-streak shape as
// shouldRaiseDegradedWarning above, for the distinct "stuck on one
// undelivered message" signal.
export function shouldEscalateStuckDelivery(stuckAttempts: number, config: PollBackoffConfig): boolean {
  return stuckAttempts === config.stuckRetryLimit;
}

// BL-370: the pure staleness decision - "has the front desk completed a
// poll cycle recently enough to prove it is still consuming". Deliberately
// NOT "has a message arrived" (unknowable, and unknowable-by-design is the
// whole reason a healthy front desk long-polls with a bounded timeout in
// the first place - see the ticket's own load-bearing design point): a
// quiet night with a fresh heartbeat must read as healthy, never stale.
// front_desk_supervisor_lib.bb mirrors this exact predicate independently
// (same "small deliberate duplication over cross-language coupling"
// convention this codebase already uses for its other dual TS/bb seams)
// so the REAL restart decision never depends on this process's own event
// loop being alive to make it.
export function isPollCycleStale(lastHeartbeatMs: number | undefined, nowMs: number, stallWindowMs: number): boolean {
  return lastHeartbeatMs === undefined || nowMs - lastHeartbeatMs >= stallWindowMs;
}

export interface PollLoopState {
  offset: number;
  consecutiveFailures: number;
  // BL-369: consecutive successful CYCLES in a row where the offset failed
  // to advance because at least one delivery genuinely FAILED
  // (result.failed > 0) - i.e. the SAME head-of-line update keeps failing.
  // Resets to 0 the instant the offset actually advances again or a cycle
  // has nothing undelivered; distinct from consecutiveFailures, which
  // counts whole-cycle getUpdates failures, not per-message ones within an
  // ok cycle. BL-389: deliberately keys off `failed`, NOT `dropped` - a
  // drop already let the offset past it (offsetAfterDelivery), so a
  // dropped-only cycle is never "stuck" in the first place.
  stuckAttempts: number;
}

export interface PollCycleResult {
  state: PollLoopState;
  // 0 means no explicit delay is needed (a successful cycle - the healthy
  // long-poll's own server-side wait already paces the loop, per the
  // ticket's own root-cause analysis).
  delayMs: number;
  degradedWarning: boolean;
  // BL-369 (scenario 05): true on the exact cycle stuckAttempts crosses
  // config.stuckRetryLimit - "it has retried up to its limit" (each poll
  // cycle IS a retry, the offset never having advanced past the stuck
  // update) - never fires again for the SAME stuck episode, mirroring
  // degradedWarning's own once-per-streak posture.
  escalateStuckDelivery: boolean;
}

// Adapter-injected, ONE cycle: calls pollAndForward, then applies the pure
// backoff/warning decisions above - deliberately never calls a sleep/wait
// itself (unlike sendWithBoundedRetry's own injected-wait shape), so this
// stays testable with zero clock/timer concerns at all; the actual waiting
// happens one level up, in the live, untested pollLoop wrapper, which owns
// only the timing.
export async function runPollCycle(
  state: PollLoopState,
  principalUserId: string,
  adapters: PollAdapters,
  config: PollBackoffConfig
): Promise<PollCycleResult> {
  const result = await pollAndForward(state.offset, principalUserId, adapters);
  if (result.ok) {
    const offsetAdvanced = result.nextOffset !== state.offset;
    const stuckAttempts = offsetAdvanced || result.failed === 0 ? 0 : state.stuckAttempts + 1;
    return {
      state: { offset: result.nextOffset, consecutiveFailures: 0, stuckAttempts },
      delayMs: 0,
      degradedWarning: false,
      escalateStuckDelivery: shouldEscalateStuckDelivery(stuckAttempts, config),
    };
  }
  const consecutiveFailures = state.consecutiveFailures + 1;
  return {
    state: { offset: result.nextOffset, consecutiveFailures, stuckAttempts: state.stuckAttempts },
    delayMs: computePollBackoffMs(consecutiveFailures, config),
    degradedWarning: shouldRaiseDegradedWarning(consecutiveFailures, config),
    escalateStuckDelivery: false,
  };
}

// Adapter-injected: the per-cycle side effects (the degraded-warning
// write, the escalation, the backoff wait) split out of pollLoop's own
// for(;;) so that loop stays a bare, complexity-1 forever loop - mirroring
// every other "extract the branch, thin the loop" split in this file. All
// three decisions (WHETHER to warn, WHETHER to escalate, HOW LONG to wait)
// already live in runPollCycle above; this function only ever sequences
// the adapter calls it's handed. escalate is a REAL notification (BL-369
// scenario 05: "the failure is escalated to the human"), distinct from
// writeWarning's local stderr log - defaulted to a no-op so every existing
// caller/test that has no reason to touch it is unaffected.
// BL-370: recordHeartbeat runs UNCONDITIONALLY, before any of the other
// branches - completing the cycle is the liveness fact the supervisor
// needs (success or a handled failure both count), never the outcome of
// it. Defaulted to a no-op for the same "existing callers unaffected"
// reason as escalate above.
export async function applyPollCycleResult(
  cycle: PollCycleResult,
  writeWarning: (message: string) => void,
  wait: (ms: number) => Promise<void>,
  escalate: () => Promise<void> = async () => {},
  recordHeartbeat: () => void = () => {}
): Promise<void> {
  recordHeartbeat();
  if (cycle.degradedWarning) {
    writeWarning(`front-desk bot: poll degraded - ${cycle.state.consecutiveFailures} consecutive failures, still retrying\n`);
  }
  if (cycle.escalateStuckDelivery) {
    await escalate();
  }
  if (cycle.delayMs > 0) {
    await wait(cycle.delayMs);
  }
}

export interface ReplyRelayLoopState {
  consecutiveFailures: number;
}

export interface ReplyRelayCycleResult {
  state: ReplyRelayLoopState;
  delayMs: number;
  degradedWarning: boolean;
}

// BL-320: same pure decision/adapter-sequencing split as runPollCycle/
// applyPollCycleResult above, for subscribeReplies's own reconnect-with-
// backoff loop. ok=true covers BOTH a real successful relay AND the SSE
// stream ending cleanly (server-closed, no body) - neither is a fault, but
// a brief pause (backoffBaseMs) before resubscribing is still worth it
// over a hot reconnect loop, mirrored below by returning that same delay
// on success rather than 0.
export function computeReplyRelayCycleResult(state: ReplyRelayLoopState, ok: boolean, config: PollBackoffConfig): ReplyRelayCycleResult {
  if (ok) {
    return { state: { consecutiveFailures: 0 }, delayMs: config.backoffBaseMs, degradedWarning: false };
  }
  const consecutiveFailures = state.consecutiveFailures + 1;
  return {
    state: { consecutiveFailures },
    delayMs: computePollBackoffMs(consecutiveFailures, config),
    degradedWarning: shouldRaiseDegradedWarning(consecutiveFailures, config),
  };
}

// errorMessage is only ever read when degradedWarning is true (a failed
// cycle) - undefined on the success path, where it is never referenced.
export async function applyReplyRelayCycleResult(
  cycle: ReplyRelayCycleResult,
  errorMessage: string | undefined,
  writeWarning: (message: string) => void,
  wait: (ms: number) => Promise<void>
): Promise<void> {
  if (cycle.degradedWarning) {
    writeWarning(
      `front-desk bot: reply-relay degraded - ${cycle.state.consecutiveFailures} consecutive reconnect failures, still retrying: ${errorMessage}\n`
    );
  }
  if (cycle.delayMs > 0) {
    await wait(cycle.delayMs);
  }
}

// BL-302 LOOP ISOLATION: runs `start` and, if it THROWS (a fault - never
// on a normal return, which stays exactly as-is; subscribeReplies's own
// silent-stop-on-stream-end gap is an explicitly out-of-scope follow-up),
// reports it via onFault, waits, and retries - forever, without ever
// itself rejecting. Wrapping each of the bot's three forever-loops in this
// (instead of racing their raw promises under Promise.all) means a fault
// in one can never reject the Promise.all and take runCliMain's
// reportFatalAndExit(process.exit(1)) path, which would otherwise kill
// the other two loops too even though nothing is actually wrong with them.
export async function runContainedLoop(
  name: string,
  start: () => Promise<void>,
  wait: (ms: number) => Promise<void>,
  restartDelayMs: number,
  onFault?: (name: string, error: unknown) => void
): Promise<void> {
  try {
    await start();
  } catch (error) {
    onFault?.(name, error);
    await wait(restartDelayMs);
    await runContainedLoop(name, start, wait, restartDelayMs, onFault);
  }
}

// ── SSE reply relay (telegram-topic-03) ──────────────────────────────────

export interface SseRecord {
  event: string | undefined;
  data: string;
}

// Parses one complete "event: ...\ndata: ...\n\n" SSE record out of an
// accumulated buffer, mirroring holisticUiHtml.ts's own client-side SSE
// parser but extended to read the named `event:` line (that page's own
// stream is unnamed data-only). Returns the record's {event, data} and
// the remaining buffer, or null if no complete record is buffered yet.
export function parseNextSseRecord(buffer: string): (SseRecord & { rest: string }) | null {
  const boundary = buffer.indexOf('\n\n');
  if (boundary === -1) {
    return null;
  }
  const record = buffer.slice(0, boundary);
  const rest = buffer.slice(boundary + 2);
  const eventLine = record.split('\n').find((l) => l.startsWith('event: '));
  const dataLine = record.split('\n').find((l) => l.startsWith('data: '));
  return { event: eventLine?.slice('event: '.length), data: dataLine?.slice('data: '.length) ?? '', rest };
}

export interface SseChunkResult {
  done: boolean;
  chunk: string;
}

export interface ReplyRelayAdapters {
  readChunk: () => Promise<SseChunkResult>;
  // BL-355: topicId undefined means "send with no message_thread_id", which
  // Telegram routes to the chat's General topic - a real, first-class
  // destination now, not a sentinel for "cannot deliver."
  // BL-440: the optional third param rides a reply record's own
  // retractsPendingQuestion flag (operator-decide.ts's runApprove, on a
  // successful gate answer) through to the real wiring's blTopicStore
  // append, so the resulting outbound message is recorded as voiding the
  // ticket's pending question - the real production writer BL-440's own
  // premise-live gate needs. Absent for every ordinary reply.
  sendReply: (topicId: number | undefined, text: string, retractsPendingQuestion?: boolean) => Promise<void>;
  resolveDelivery: (threadId: string) => ReplyDelivery;
  // BL-320: confirms this entry's id back to the bridge (POST /reply-ack
  // live-side) - the bridge only advances its own persisted cursor on
  // this, so a dropped connection between relay and ack replays the SAME
  // entry on reconnect rather than silently losing it.
  ackReply: (id: string) => Promise<void>;
  // BL-426 slice 1: true when the turn this reply answers was opened by a
  // voice note (markVoiceOriginatedTurn, PollAdapters above) - the signal
  // deliverReply below uses to ALSO synthesize a voice note alongside the
  // ordinary text reply. All four optional and default to "voice not
  // wired", the exact pre-BL-426 text-only behavior (mirrors this file's
  // own BL-410/BL-425 optional-adapter convention) - every ReplyRelayAdapters
  // fixture written before BL-426 keeps working unchanged.
  isVoiceOriginatedTurn?: (threadId: string) => Promise<boolean>;
  // Clears the one-shot marker - called whenever it was consulted, whether
  // or not synthesis actually happens this turn, so a marker never survives
  // to a LATER, unrelated reply.
  clearVoiceOriginatedTurn?: (threadId: string) => Promise<void>;
  synthesizeVoice?: (text: string) => Promise<TtsResult>;
  sendVoice?: (topicId: number | undefined, audio: Buffer) => Promise<void>;
  // BL-466: sends a native poll instead of an ordinary sendReply when the
  // outbound record carries 2+ discrete options (see deliverAgentQuestion
  // below) - returns the poll's own id (undefined on a failed send) so the
  // caller can record the poll->thread mapping a later poll_answer needs to
  // resolve back to this SUP-### thread (PollAdapters.resolvePollThread).
  // BL-483: superseded as deliverAgentQuestion's own options-carrying-ask
  // rendering (sendAskButtons below) - kept only because decidePollAnswerAction/
  // processPollAnswer (still-correct, generically reusable poll-answer
  // handling) reference the same PollAdapters.resolvePollThread shape;
  // deliverAgentQuestion itself no longer calls this.
  sendPoll?: (topicId: number | undefined, question: string, options: string[]) => Promise<{ pollId?: string }>;
  // BL-466: persists the poll id -> {threadId, options} mapping at send
  // time - the ONLY place this mapping is ever written; resolvePollThread
  // (PollAdapters above) only ever reads it. BL-483: see sendPoll's own
  // comment above - superseded, kept for the still-valid poll-answer sibling.
  recordPollMapping?: (pollId: string, threadId: string, options: string[]) => Promise<void>;
  // BL-483: sends an options-carrying ask as tappable inline-keyboard
  // buttons (see deliverAgentQuestion below) - returns the sent message's
  // own id (undefined on a failed send) so the caller can record the
  // {threadId -> message} mapping a later tap (PollAdapters.resolveAskOptions/
  // readAskMessage) and a stale-tap edit both need.
  sendAskButtons?: (
    topicId: number | undefined,
    text: string,
    buttons: InlineKeyboardButton[][]
  ) => Promise<{ success: boolean; messageId?: number }>;
  // BL-483: persists the {threadId -> topicId, messageId, text} mapping at
  // send time - the ONLY place this mapping is ever written; readAskMessage/
  // resolveAskOptions (PollAdapters above) only ever read it.
  recordAskMessage?: (threadId: string, topicId: number | undefined, messageId: number, text: string) => Promise<void>;
  // BL-466: the standing Agent Questions topic's own id - every agentQuestion
  // record (poll or plain fallback) routes HERE, never through resolveDelivery
  // (see deliverAgentQuestion's own comment for why the ordinary per-subject
  // topic resolution does not apply to an agent's question).
  agentQuestionsTopicId?: () => Promise<number | undefined>;
}

// BL-426 slice 1: when the delivery's threadId is marked voice-originated,
// ALSO sends a synthesized voice note alongside the text reply already sent
// by the caller (human decision: voice note + transcript, never
// voice-only) before clearing the one-shot marker. A TTS failure - or
// voice simply not being wired - degrades silently to the text-only reply
// already sent, rather than blocking or crashing the relay: mirrors this
// codebase's own "*-briefing-line helpers DEGRADE to nil/omit" posture for
// a non-critical enrichment failure (the engineering article's CLI-failure
// wiring rule, applied to an adapter instead of a subprocess). Never called
// for the alsoPointerToDefault pointer notice - that message is not itself
// an answer to anything, the same carve-out BL-440's retractsPendingQuestion
// already uses.
async function synthesizeVoiceReplyIfNeeded(
  threadId: string,
  text: string,
  topicId: number | undefined,
  adapters: ReplyRelayAdapters
): Promise<void> {
  if (!adapters.isVoiceOriginatedTurn || !adapters.synthesizeVoice || !adapters.sendVoice) {
    return;
  }
  const isVoiceTurn = await adapters.isVoiceOriginatedTurn(threadId);
  if (!isVoiceTurn) {
    return;
  }
  await adapters.clearVoiceOriginatedTurn?.(threadId);
  const tts = await adapters.synthesizeVoice(text);
  if (tts.kind === 'ok') {
    await adapters.sendVoice(topicId, tts.audio);
  }
}

// BL-355: executes one resolved delivery decision. A 'topic' delivery keeps
// the full reply in its canonical topic and, when that subject was ALSO
// ever asked about from General, additionally posts a short pointer there
// so General is never left silent. A 'default' delivery (no real topic
// bound at all) sends the full reply straight to General. 'undeliverable'
// (no binding resolves at all - e.g. a corrupt/unknown threadId) sends
// nothing, same as the prior behavior for a genuinely unmapped subject.
// BL-440: retractsPendingQuestion rides ONLY the actual answer send (the
// 'topic' branch's primary send, and the 'default' branch's - the two
// deliveries that carry the real reply text) - never the pointer notice
// (a distinct, unrelated message pointing at the real topic, not itself an
// answer to anything).
async function deliverReply(
  threadId: string,
  delivery: ReplyDelivery,
  text: string,
  adapters: ReplyRelayAdapters,
  retractsPendingQuestion?: boolean
): Promise<void> {
  if (delivery.kind === 'topic') {
    await adapters.sendReply(delivery.topicId, text, retractsPendingQuestion);
    await synthesizeVoiceReplyIfNeeded(threadId, text, delivery.topicId, adapters);
    if (delivery.alsoPointerToDefault) {
      await adapters.sendReply(undefined, REPLY_POINTER_TEXT);
    }
    return;
  }
  if (delivery.kind === 'default') {
    await adapters.sendReply(undefined, text, retractsPendingQuestion);
    await synthesizeVoiceReplyIfNeeded(threadId, text, undefined, adapters);
  }
}

// BL-483: an options-carrying ask's message body - the question, then each
// option numbered with its optional description, then the standing
// free-text hint (Telegram's own reply box IS the "type something else"
// affordance - this line just states that in words, per the ticket's own
// acceptance criterion). Pure/testable: no Telegram I/O.
export function composeAskMessageBody(question: string, options: AskOption[]): string {
  const lines = [question, ''];
  options.forEach((option, index) => {
    const suffix = option.description ? ` — ${option.description}` : '';
    lines.push(`${index + 1}. ${option.label}${suffix}`);
  });
  lines.push('', 'Or reply with your own answer.');
  return lines.join('\n');
}

// BL-483: one tappable button per option, one option per row (the ticket's
// own Telegram-limit constraint), callback_data carrying the ask's threadId
// + the option's own INDEX - never the label text, which is unbounded and
// could overrun callback_data's 64-byte cap. Pure/testable: no Telegram I/O.
export function composeAskButtons(threadId: string, options: AskOption[]): InlineKeyboardButton[][] {
  return options.map((option, index) => [{ text: option.label, callbackData: `ask:${threadId}:${index}` }]);
}

// BL-466/BL-483: an agent's clarifying question is delivered to the
// dedicated Agent Questions topic instead of adapters.resolveDelivery's own
// per-subject resolution - the routing exception the ticket calls for
// (every agent question lands in ONE standing topic regardless of which
// topic its SUP-### thread would otherwise resolve to). BL-483 supersedes
// BL-466's native-poll rendering for an options-carrying ask with tappable
// buttons (per-option description, a "type something else" hint, and an
// editable-after-answer message - none of which a native poll can do); a
// bare question - no options, or sendAskButtons not wired - falls back to
// an ordinary message in that same topic, unchanged from before this
// ticket (scenario 5's own byte-identical contract).
async function deliverAgentQuestion(threadId: string, text: string, options: AskOption[] | undefined, adapters: ReplyRelayAdapters): Promise<void> {
  const topicId = await adapters.agentQuestionsTopicId?.();
  if (options && options.length > 0 && adapters.sendAskButtons) {
    const body = composeAskMessageBody(text, options);
    const buttons = composeAskButtons(threadId, options);
    const sent = await adapters.sendAskButtons(topicId, body, buttons);
    if (sent.messageId !== undefined) {
      await adapters.recordAskMessage?.(threadId, topicId, sent.messageId, body);
    }
    return;
  }
  await adapters.sendReply(topicId, text);
}

// BL-320: an entry already in seenIds was already successfully posted to
// Telegram earlier in THIS process's lifetime - a redelivery after a
// reconnect (the bridge replays every unacked entry on a fresh
// connection, and the ack for this one may be exactly what got lost) must
// re-ack without ever re-posting, or a transient drop between "sent" and
// "acked" would double-post to Telegram on every reconnect until the ack
// finally lands. An 'undeliverable' resolution still gets acked - the
// bridge cannot tell "decided to drop" from "never seen" and would
// otherwise replay an undeliverable entry on every single reconnect
// forever.
// One record's worth of relay decision, split out of relaySseReplies below
// so that function's own branch count stays low.
async function relayOneRecord(record: SseRecord, adapters: ReplyRelayAdapters, seenIds: Set<string>): Promise<void> {
  if (record.event !== 'telegram-reply' || !record.data) {
    return;
  }
  const { id, threadId, text, retractsPendingQuestion, agentQuestion, options } = JSON.parse(record.data) as {
    id: string;
    threadId: string;
    text: string;
    retractsPendingQuestion?: boolean;
    // BL-466: set by operator_ask.bb/operator_runtime.bb (see
    // deliverAgentQuestion's own comment) - every other, ordinary reply
    // record omits it and is completely unaffected.
    agentQuestion?: boolean;
    // BL-483: {label, description?}[] - operator_ask.bb's own --options
    // normalizer (operator-lib/ask-options) emits this exact shape.
    options?: AskOption[];
  };
  if (!seenIds.has(id)) {
    if (agentQuestion) {
      await deliverAgentQuestion(threadId, text, options, adapters);
    } else {
      await deliverReply(threadId, adapters.resolveDelivery(threadId), text, adapters, retractsPendingQuestion);
    }
    seenIds.add(id);
  }
  await adapters.ackReply(id);
}

// Drains every complete record out of buffer, relaying each in turn, and
// returns the remaining (incomplete) buffer.
async function drainBufferedRecords(buffer: string, adapters: ReplyRelayAdapters, seenIds: Set<string>): Promise<string> {
  let parsed = parseNextSseRecord(buffer);
  while (parsed) {
    buffer = parsed.rest;
    await relayOneRecord(parsed, adapters, seenIds);
    parsed = parseNextSseRecord(buffer);
  }
  return buffer;
}

// BL-320: seenIds is caller-owned and passed in (rather than created fresh
// here) so it survives ACROSS reconnects within one bot process lifetime -
// telegram-front-desk-bot.ts's subscribeReplies creates it once, outside
// its own reconnect-with-backoff loop, and threads the SAME set into every
// relaySseReplies call the loop makes.
export async function relaySseReplies(initialBuffer: string, adapters: ReplyRelayAdapters, seenIds: Set<string>): Promise<void> {
  let buffer = initialBuffer;
  for (;;) {
    const { done, chunk } = await adapters.readChunk();
    if (done) {
      return;
    }
    buffer = await drainBufferedRecords(buffer + chunk, adapters, seenIds);
  }
}
