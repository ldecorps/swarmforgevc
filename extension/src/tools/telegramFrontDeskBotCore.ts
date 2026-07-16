// BL-281: pure decision logic + adapter-injected orchestration for the
// Telegram Front Desk Bot (a bridge client, never coupled to the Operator
// runtime directly) - principal filtering, topic demux, and the poll-then-
// forward decision, all testable with fixture updates/fake adapters and no
// live Telegram/network. telegram-front-desk-bot.ts is the thin,
// untested-boundary process that injects the real adapters (real
// getUpdates, a real fetch POST to the bridge, the real persisted topic
// map) into pollAndForward below.
import { TelegramUpdate, TelegramCallbackQuery, GetUpdatesResult } from '../notify/telegramClient';
import { computeTelegramRetryBackoffMs } from '../notify/telegramRetry';
import { classifyApprovalReplyAction, classifyApprovalsTopicReply } from '../concierge/pendingApprovalReply';
import { classifyRecertTopicReply } from '../concierge/recertTopicReply';
import { roleForTopic } from '../concierge/roleTopicMapStore';

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
export const OPERATOR_SUBJECT_ID = 'OPERATOR';
export const OPERATOR_TOPIC_NAME = 'Operator';

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
  // BL-434: checked BEFORE the ordinary post-existing branch below - a reply
  // in the Approvals topic must be PARSED for the ticket id it names, never
  // forwarded as a plain subject post the way every other bound subject is.
  if (subjectId === APPROVALS_SUBJECT_ID) {
    return decideApprovalsTopicReplyAction(text);
  }
  // BL-450: checked BEFORE the ordinary post-existing branch below, same
  // reason as the Approvals-topic check just above - a reply in the Recert
  // topic must be PARSED for the verb+scenario id it names, never forwarded
  // as a plain subject post.
  if (subjectId === RECERT_SUBJECT_ID) {
    return decideRecertTopicReplyAction(text);
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
  answerCallbackQuery: (callbackQueryId: string) => Promise<void>;
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
    await adapters.recordApprovalReply(backlogId);
  } else if (action.kind === 'reject') {
    await adapters.recordRejectionReply(backlogId, action.reason);
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
      ? await adapters.recordApprovalReply(backlogId)
      : await adapters.recordRejectionReply(backlogId, decision.reason);
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

// BL-410: the callback-query twin of decideUpdateAction above - given a
// tapped inline-keyboard button, decides whether to act on it at all (the
// SAME my-chat-then-principal guard order as decideUpdateAction, and for
// the identical reason: a foreign chat is refused before who-sent-it is
// even considered) and, if so, which of the three buttons was tapped.
// Pure: no I/O, directly testable with a plain fixture callback_query.
export type CallbackButtonDecision =
  | { action: 'approve'; backlogId: string }
  | { action: 'await-followup'; backlogId: string; kind: 'reject' | 'amend' }
  | { action: 'drop'; reason: 'not-my-chat' | 'not-principal' | 'unrecognized-data' };

const CALLBACK_DATA_PATTERN = /^(approve|reject|amend):(.+)$/;

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
  const match = callbackQuery.data?.match(CALLBACK_DATA_PATTERN);
  if (!match) {
    return { action: 'drop', reason: 'unrecognized-data' };
  }
  const [, kind, backlogId] = match;
  return kind === 'approve' ? { action: 'approve', backlogId } : { action: 'await-followup', backlogId, kind: kind as 'reject' | 'amend' };
}

// BL-410: a legitimate tap (right chat, right principal) always clears its
// own spinner, even when its data is unrecognized/stale - only a
// not-my-chat/not-principal tap is answered never (mirrors the ordinary
// message path's own silent drop for the same two reasons). An Approve tap
// fires recordApprovalReply immediately (nothing else to gather); a
// Reject/Amend tap has no reason/note in hand yet, so it only ever stashes
// the pending marker deliverOperatorContext above consults on the next
// reply - never reimplementing recordRejectionReply/the amend effect here.
async function processCallbackQuery(callbackQuery: TelegramCallbackQuery, principalUserId: string, adapters: PollAdapters): Promise<UpdateDeliveryOutcome> {
  const decision = decideCallbackQueryAction(callbackQuery, principalUserId, adapters.chatId);
  if (decision.action === 'drop' && (decision.reason === 'not-my-chat' || decision.reason === 'not-principal')) {
    return 'dropped';
  }
  await adapters.answerCallbackQuery(callbackQuery.id);
  if (decision.action === 'drop') {
    return 'dropped';
  }
  if (decision.action === 'approve') {
    await adapters.recordApprovalReply(decision.backlogId);
  } else {
    await adapters.setPendingButtonAction(decision.backlogId, decision.kind);
  }
  return 'posted';
}

// Split out of processUpdate below so its own branch count stays at or
// below the CRAP threshold - the same "extract the ternary into a named,
// tested helper" split deliverOperatorContext above already uses for the
// identical reason (BL-357), reapplied here because BL-389's outcome
// mapping (ok -> 'posted' | 'failed') pushed processUpdate's CRAP to 8.
function deliveryOutcome(ok: boolean): UpdateDeliveryOutcome {
  return ok ? 'posted' : 'failed';
}

// BL-410: a callback_query update carries no `message` of its own (they are
// mutually exclusive Telegram update shapes) - routed to its own decision
// path before decideUpdateAction (which reads update.message) is reached.
// Split out as its own dispatcher (rather than an early return inside
// processMessageUpdate below) so THAT function's own branch count stays
// exactly at its pre-BL-410 baseline, the same "extract so branch count
// stays at or below the CRAP threshold" reasoning as deliveryOutcome above.
async function processUpdate(update: TelegramUpdate, principalUserId: string, adapters: PollAdapters): Promise<UpdateDeliveryOutcome> {
  if (update.callback_query) {
    return processCallbackQuery(update.callback_query, principalUserId, adapters);
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

// Split out of processMessageUpdate below for the same CRAP-budget reason as
// attemptSteeringDelivery's own comment documents - composing the steering
// and voice side-channel attempts here (rather than as two separate ifs in
// processMessageUpdate) is that same precedent applied a second time: adding
// attemptVoiceDelivery as a third inline check is exactly what would push it
// over again.
async function attemptSideChannelDelivery(
  update: TelegramUpdate,
  principalUserId: string,
  adapters: PollAdapters
): Promise<UpdateDeliveryOutcome | undefined> {
  const steeringOutcome = await attemptSteeringDelivery(update, principalUserId, adapters);
  if (steeringOutcome) {
    return steeringOutcome;
  }
  return attemptVoiceDelivery(update, principalUserId, adapters);
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
  if (isApprovalsTopicReplyDecision(decision)) {
    return deliverApprovalsTopicReply(decision, topicIdOf(update), adapters);
  }
  if (isRecertTopicReplyDecision(decision)) {
    return deliverRecertTopicReply(decision, topicIdOf(update), adapters);
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
  const { id, threadId, text, retractsPendingQuestion } = JSON.parse(record.data) as {
    id: string;
    threadId: string;
    text: string;
    retractsPendingQuestion?: boolean;
  };
  if (!seenIds.has(id)) {
    await deliverReply(threadId, adapters.resolveDelivery(threadId), text, adapters, retractsPendingQuestion);
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
