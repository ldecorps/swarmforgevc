// BL-281: pure decision logic + adapter-injected orchestration for the
// Telegram Front Desk Bot (a bridge client, never coupled to the Operator
// runtime directly) - principal filtering, topic demux, and the poll-then-
// forward decision, all testable with fixture updates/fake adapters and no
// live Telegram/network. telegram-front-desk-bot.ts is the thin,
// untested-boundary process that injects the real adapters (real
// getUpdates, a real fetch POST to the bridge, the real persisted topic
// map) into pollAndForward below.
import { TelegramUpdate, GetUpdatesResult } from '../notify/telegramClient';
import { computeTelegramRetryBackoffMs } from '../notify/telegramRetry';

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

export type BotUpdateDecision =
  | { action: 'post-existing'; subjectId: string; text: string }
  | { action: 'operator-context'; backlogId: string; text: string }
  | { action: 'open-default'; text: string }
  | { action: 'open-for-topic'; topicId: number; text: string }
  | { action: 'drop'; reason: 'not-principal' | 'no-text' };

// Pure: the bot's whole per-update decision - given the update, the
// principal's user id, a lookup from topic id -> already-mapped SUP-###
// subject id (the bot's own persisted mapping), and a lookup from topic id
// -> a BL-### backlog item's topic (BL-297's own persisted mapping,
// inverted via topicRouter.ts's backlogForTopic) - decides whether to post
// under an existing subject, route as Operator context for a backlog item
// (BL-298), open a new subject (private DM -> the single default subject;
// an unmapped topic -> a fresh per-topic subject), or drop.
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
export function decideUpdateAction(
  update: TelegramUpdate,
  principalUserId: string,
  subjectForTopic: (topicId: number | undefined) => string | undefined,
  backlogForTopic: (topicId: number | undefined) => string | undefined = () => undefined
): BotUpdateDecision {
  if (!isFromPrincipal(update, principalUserId)) {
    return { action: 'drop', reason: 'not-principal' };
  }
  const text = messageTextOf(update);
  if (!text) {
    return { action: 'drop', reason: 'no-text' };
  }
  const topicId = topicIdOf(update);
  const subjectId = subjectForTopic(topicId);
  if (subjectId) {
    return { action: 'post-existing', subjectId, text };
  }
  const backlogId = backlogForTopic(topicId);
  if (backlogId) {
    return { action: 'operator-context', backlogId, text };
  }
  return topicId === undefined ? { action: 'open-default', text } : { action: 'open-for-topic', topicId, text };
}

export interface PollAdapters {
  getUpdates: (offset: number) => Promise<GetUpdatesResult>;
  postToBridge: (subjectId: string, text: string) => Promise<boolean>;
  subjectForTopic: (topicId: number | undefined) => string | undefined;
  // BL-294: opens a fresh SUP-### for a not-yet-mapped context (topicId
  // undefined means the DM default) via the support store - the
  // authoritative id sequence, never duplicated here - records the
  // topicId(or default)->subjectId mapping so later messages in the same
  // context resolve through subjectForTopic instead of opening again, and
  // notifies the Operator the same way an existing-subject post does.
  openSubjectAndRecord: (topicId: number | undefined, text: string) => Promise<string>;
  // BL-298: looks up a BL-### backlog item's topic (topicRouter.ts's own
  // backlogForTopic, inverted from BL-297's outbound map) - checked before
  // treating an unmapped topic as a fresh support conversation.
  backlogForTopic: (topicId: number | undefined) => string | undefined;
  // BL-298: routes a reply as context for the given backlog item's task -
  // NOT the support-thread path (postToBridge/openSubjectAndRecord). What
  // the Operator does with that context is the Operator's own behavior,
  // out of scope here.
  postOperatorContext: (backlogId: string, text: string) => Promise<boolean>;
  nextOffset: (updates: TelegramUpdate[], currentOffset: number) => number;
}

export interface PollResult {
  nextOffset: number;
  posted: number;
  dropped: number;
  // BL-302: surfaces the poll CYCLE's own success/failure (getUpdates'
  // own result.success) - distinct from posted/dropped, which describe
  // per-update OUTCOMES within a successful cycle. A failed cycle has
  // posted:0/dropped:0 too, which was previously indistinguishable from a
  // legitimately-empty successful cycle - the caller (pollLoop) needs to
  // tell these apart to back off only on a real failure.
  ok: boolean;
}

// Split out of pollAndForward so that function's own branch count stays
// low - one update's whole decision -> outcome, true when posted/opened,
// false when dropped.
async function processUpdate(update: TelegramUpdate, principalUserId: string, adapters: PollAdapters): Promise<boolean> {
  const decision = decideUpdateAction(update, principalUserId, adapters.subjectForTopic, adapters.backlogForTopic);
  if (decision.action === 'post-existing') {
    return adapters.postToBridge(decision.subjectId, decision.text);
  }
  if (decision.action === 'operator-context') {
    return adapters.postOperatorContext(decision.backlogId, decision.text);
  }
  if (decision.action === 'open-default' || decision.action === 'open-for-topic') {
    const topicId = decision.action === 'open-for-topic' ? decision.topicId : undefined;
    await adapters.openSubjectAndRecord(topicId, decision.text);
    return true;
  }
  return false;
}

// Adapter-injected: one poll-and-forward cycle. Every update decision goes
// through decideUpdateAction (pure) above - this function's own job is
// just sequencing the adapters and counting outcomes, never a second
// decision path.
export async function pollAndForward(offset: number, principalUserId: string, adapters: PollAdapters): Promise<PollResult> {
  const result = await adapters.getUpdates(offset);
  if (!result.success) {
    return { nextOffset: offset, posted: 0, dropped: 0, ok: false };
  }
  let posted = 0;
  let dropped = 0;
  for (const update of result.updates) {
    if (await processUpdate(update, principalUserId, adapters)) {
      posted += 1;
    } else {
      dropped += 1;
    }
  }
  return { nextOffset: adapters.nextOffset(result.updates, offset), posted, dropped, ok: true };
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

export interface PollLoopState {
  offset: number;
  consecutiveFailures: number;
}

export interface PollCycleResult {
  state: PollLoopState;
  // 0 means no explicit delay is needed (a successful cycle - the healthy
  // long-poll's own server-side wait already paces the loop, per the
  // ticket's own root-cause analysis).
  delayMs: number;
  degradedWarning: boolean;
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
    return { state: { offset: result.nextOffset, consecutiveFailures: 0 }, delayMs: 0, degradedWarning: false };
  }
  const consecutiveFailures = state.consecutiveFailures + 1;
  return {
    state: { offset: result.nextOffset, consecutiveFailures },
    delayMs: computePollBackoffMs(consecutiveFailures, config),
    degradedWarning: shouldRaiseDegradedWarning(consecutiveFailures, config),
  };
}

// Adapter-injected: the per-cycle side effects (the degraded-warning
// write, the backoff wait) split out of pollLoop's own for(;;) so that
// loop stays a bare, complexity-1 forever loop - mirroring every other
// "extract the branch, thin the loop" split in this file. Both decisions
// (WHETHER to warn, HOW LONG to wait) already live in runPollCycle above;
// this function only ever sequences the two adapter calls it's handed.
export async function applyPollCycleResult(
  cycle: PollCycleResult,
  writeWarning: (message: string) => void,
  wait: (ms: number) => Promise<void>
): Promise<void> {
  if (cycle.degradedWarning) {
    writeWarning(`front-desk bot: poll degraded - ${cycle.state.consecutiveFailures} consecutive failures, still retrying\n`);
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
  sendReply: (topicId: number | undefined, text: string) => Promise<void>;
  resolveDelivery: (threadId: string) => ReplyDelivery;
  // BL-320: confirms this entry's id back to the bridge (POST /reply-ack
  // live-side) - the bridge only advances its own persisted cursor on
  // this, so a dropped connection between relay and ack replays the SAME
  // entry on reconnect rather than silently losing it.
  ackReply: (id: string) => Promise<void>;
}

// BL-355: executes one resolved delivery decision. A 'topic' delivery keeps
// the full reply in its canonical topic and, when that subject was ALSO
// ever asked about from General, additionally posts a short pointer there
// so General is never left silent. A 'default' delivery (no real topic
// bound at all) sends the full reply straight to General. 'undeliverable'
// (no binding resolves at all - e.g. a corrupt/unknown threadId) sends
// nothing, same as the prior behavior for a genuinely unmapped subject.
async function deliverReply(delivery: ReplyDelivery, text: string, adapters: ReplyRelayAdapters): Promise<void> {
  if (delivery.kind === 'topic') {
    await adapters.sendReply(delivery.topicId, text);
    if (delivery.alsoPointerToDefault) {
      await adapters.sendReply(undefined, REPLY_POINTER_TEXT);
    }
    return;
  }
  if (delivery.kind === 'default') {
    await adapters.sendReply(undefined, text);
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
  const { id, threadId, text } = JSON.parse(record.data) as { id: string; threadId: string; text: string };
  if (!seenIds.has(id)) {
    await deliverReply(adapters.resolveDelivery(threadId), text, adapters);
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
