// BL-281: pure decision logic + adapter-injected orchestration for the
// Telegram Front Desk Bot (a bridge client, never coupled to the Operator
// runtime directly) - principal filtering, topic demux, and the poll-then-
// forward decision, all testable with fixture updates/fake adapters and no
// live Telegram/network. telegram-front-desk-bot.ts is the thin,
// untested-boundary process that injects the real adapters (real
// getUpdates, a real fetch POST to the bridge, the real persisted topic
// map) into pollAndForward below.
import { TelegramUpdate, GetUpdatesResult } from '../notify/telegramClient';

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

export type BotUpdateDecision =
  | { action: 'post-existing'; subjectId: string; text: string }
  | { action: 'open-default'; text: string }
  | { action: 'open-for-topic'; topicId: number; text: string }
  | { action: 'drop'; reason: 'not-principal' | 'no-text' };

// Pure: the bot's whole per-update decision - given the update, the
// principal's user id, and a lookup from topic id -> already-mapped
// SUP-### subject id (the bot's own persisted mapping, read by the
// caller), decides whether to post under an existing subject, open a new
// one (private DM -> the single default subject; an unmapped topic -> a
// fresh per-topic subject), or drop.
//
// SUP-### id ASSIGNMENT itself is not this function's job - it stays with
// the support store (support_thread.bb open / support_lib.bb's
// next-thread-id), reached through the openSubjectAndRecord adapter below;
// this function only ever decides WHICH of those three things should
// happen for a given update.
export function decideUpdateAction(
  update: TelegramUpdate,
  principalUserId: string,
  subjectForTopic: (topicId: number | undefined) => string | undefined
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
  nextOffset: (updates: TelegramUpdate[], currentOffset: number) => number;
}

export interface PollResult {
  nextOffset: number;
  posted: number;
  dropped: number;
}

// Adapter-injected: one poll-and-forward cycle. Every update decision goes
// through decideUpdateAction (pure) above - this function's own job is
// just sequencing the adapters and counting outcomes, never a second
// decision path.
export async function pollAndForward(offset: number, principalUserId: string, adapters: PollAdapters): Promise<PollResult> {
  const result = await adapters.getUpdates(offset);
  if (!result.success) {
    return { nextOffset: offset, posted: 0, dropped: 0 };
  }
  let posted = 0;
  let dropped = 0;
  for (const update of result.updates) {
    const decision = decideUpdateAction(update, principalUserId, adapters.subjectForTopic);
    if (decision.action === 'post-existing') {
      const ok = await adapters.postToBridge(decision.subjectId, decision.text);
      if (ok) {
        posted += 1;
      } else {
        dropped += 1;
      }
    } else if (decision.action === 'open-default' || decision.action === 'open-for-topic') {
      const topicId = decision.action === 'open-for-topic' ? decision.topicId : undefined;
      await adapters.openSubjectAndRecord(topicId, decision.text);
      posted += 1;
    } else {
      dropped += 1;
    }
  }
  return { nextOffset: adapters.nextOffset(result.updates, offset), posted, dropped };
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
  sendReply: (topicId: number, text: string) => Promise<void>;
  topicForSubject: (subjectId: string) => number | undefined;
}

// Adapter-injected: reads chunks forever (readChunk is the only untested
// boundary - the real stream reader), draining every complete SSE record
// out of the buffer as it grows and relaying each named telegram-reply
// record into its mapped topic (an unmapped threadId - should not happen
// for a reply to a real dispatch, but never throws - is dropped, same
// "no silent mis-route" posture as pollAndForward's own drop path).
// Testable with a fake readChunk sequence (a few chunks then done) and
// fake sendReply/topicForSubject, mirroring pollAndForward's own shape -
// so this decision logic is not left uncovered behind the live network
// wrapper (telegram-front-desk-bot.ts's subscribeReplies).
// One record's worth of relay decision, split out of relaySseReplies below
// so that function's own branch count stays low.
async function relayOneRecord(record: SseRecord, adapters: ReplyRelayAdapters): Promise<void> {
  if (record.event !== 'telegram-reply' || !record.data) {
    return;
  }
  const { threadId, text } = JSON.parse(record.data) as { threadId: string; text: string };
  const topicId = adapters.topicForSubject(threadId);
  if (topicId !== undefined) {
    await adapters.sendReply(topicId, text);
  }
}

// Drains every complete record out of buffer, relaying each in turn, and
// returns the remaining (incomplete) buffer.
async function drainBufferedRecords(buffer: string, adapters: ReplyRelayAdapters): Promise<string> {
  let parsed = parseNextSseRecord(buffer);
  while (parsed) {
    buffer = parsed.rest;
    await relayOneRecord(parsed, adapters);
    parsed = parseNextSseRecord(buffer);
  }
  return buffer;
}

export async function relaySseReplies(initialBuffer: string, adapters: ReplyRelayAdapters): Promise<void> {
  let buffer = initialBuffer;
  for (;;) {
    const { done, chunk } = await adapters.readChunk();
    if (done) {
      return;
    }
    buffer = await drainBufferedRecords(buffer + chunk, adapters);
  }
}
