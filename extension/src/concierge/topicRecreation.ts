// BL-332: recreates a ticket's Telegram topic from its OWN durable
// serialised record (blTopicStore.ts, BL-329) - the slice that proves
// BL-331's deletion is actually reversible, not merely claimed to be.
// `reopenForumTopic` only works on a topic that still exists (closed, not
// deleted), so once the thread id is genuinely gone, "reopen" cannot mean
// reopen at all - it can only mean CREATE A FRESH TOPIC and REPLAY the
// record into it. decideTopicRestore below picks between the two paths;
// this module owns only the (more expensive, rendering) recreate+replay
// half - reopenForumTopic itself is a thin telegramClient.ts wrapper, no
// decision logic of its own.
//
// HONEST LIMIT: Telegram will not let a bot repost history as its
// original authors or at its original timestamps. A recreated topic is a
// RENDERED RECONSTRUCTION, labelled as such (reconstructionHeaderText),
// never quietly presented as the original conversation - a reconstruction
// passed off as the original is a lie the human would have no way to
// detect.
import { TopicRecord, TopicMessage } from './blTopicStore';
import { topicNameForItem } from './topicRouter';

export function reconstructionHeaderText(rebuiltAtMs: number): string {
  const date = new Date(rebuiltAtMs).toISOString().slice(0, 10);
  return `This topic was reconstructed from the repository's own record on ${date}. It is a rendered replay for reference, not the original live conversation.`;
}

// Renders the message's ORIGINAL author and timestamp INTO the text - the
// only way either survives at all, since every replayed message is
// (re)posted by the bot, now (the ticket's own "HONEST LIMIT" framing).
export function renderedMessageText(message: TopicMessage): string {
  return `[${message.author} · ${new Date(message.ts).toISOString()}]\n${message.text}`;
}

// Prefer a TRUE reopen (cheaper, byte-identical history, no
// rendering/replay needed at all) whenever the topic still EXISTS - a
// mapping present means the topic was only ever CLOSED, never deleted
// (deleteForumTopic's own caller, topicDeletion.ts's sweepTopicDeletions,
// always drops the mapping via dropTopicMapping in the SAME action that
// deletes). Recreate+replay is the fallback ONLY once the topic is
// genuinely gone - reopenForumTopic on a dead thread id cannot work at
// all, per Telegram's own API.
export type TopicRestoreAction = { action: 'reopen'; topicId: number } | { action: 'recreate' };

export function decideTopicRestore(topicMap: Record<string, number>, ticketId: string): TopicRestoreAction {
  const topicId = topicMap[ticketId];
  return topicId === undefined ? { action: 'recreate' } : { action: 'reopen', topicId };
}

export interface TopicRecreationAdapters {
  // NON-DESTRUCTIVE: a plain read, never a consume/move - the repo record
  // stays the source of truth so the SAME topic can be rebuilt again and
  // again (scope item 4/recreate-topic-05).
  readRecord: (ticketId: string) => TopicRecord;
  createTopic: (name: string) => Promise<number | undefined>;
  postMessage: (topicId: number, text: string) => Promise<boolean>;
  // The reverse of topicDeletion.ts's own dropTopicMapping - records the
  // NEW thread id so ordinary routing resumes and the recreated topic
  // becomes the ticket's live one (scope item 3).
  recordTopicId: (ticketId: string, topicId: number) => void;
}

export interface TopicRecreationResult {
  success: boolean;
  topicId?: number;
}

// Creates a fresh topic, posts the reconstruction header FIRST (so it is
// never missed even if replay is later interrupted), then replays every
// serialised message IN ORDER (seq order is the record's own array
// order - blTopicStore.ts's appendMessage always pushes, never reorders).
// A createTopic failure is a clean no-op: nothing is recorded, the record
// itself is untouched, and the caller can simply retry.
export async function recreateTopicFromRecord(
  ticketId: string,
  title: string,
  adapters: TopicRecreationAdapters,
  nowMs: number
): Promise<TopicRecreationResult> {
  const record = adapters.readRecord(ticketId);
  const topicId = await adapters.createTopic(topicNameForItem(ticketId, title));
  if (topicId === undefined) {
    return { success: false };
  }
  await adapters.postMessage(topicId, reconstructionHeaderText(nowMs));
  for (const message of record.messages) {
    await adapters.postMessage(topicId, renderedMessageText(message));
  }
  adapters.recordTopicId(ticketId, topicId);
  return { success: true, topicId };
}
