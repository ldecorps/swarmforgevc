// BL-332/BL-495: repairs a ticket's Telegram topic when it has genuinely
// gone (deleted out-of-band, not merely closed). BL-495 (topic-
// consolidation epic): post-BL-493 there is no per-ticket topic anymore -
// a ticket's topic is its FOLD TARGET (its epic's topic, or the standing
// Backlog topic), so the repair path targets THAT, never resurrecting the
// retired per-ticket model. `reopenForumTopic` only works on a topic that
// still exists (closed, not deleted); once the target's own thread id is
// genuinely gone, "reopen" cannot mean reopen at all - only CREATE A FRESH
// TOPIC. decideTopicRestore below picks between the two paths.
//
// HONEST LIMIT: Telegram will not let a bot repost history as its
// original authors or at its original timestamps, and a fold topic
// aggregates MANY tickets' status lines - there is no single per-topic
// message record to replay from anymore (that per-ticket concern is
// BL-493's own ticketMessageMapStore, re-posted naturally by the next
// concierge tick once it observes the recreated topic). So recreateFoldTopic
// below posts only a labelled reconstruction header, never a history
// replay - a recreated topic is honestly marked as a fresh rebuild, never
// quietly presented as continuous history.

export function reconstructionHeaderText(rebuiltAtMs: number): string {
  const date = new Date(rebuiltAtMs).toISOString().slice(0, 10);
  return `This topic was reconstructed from the repository's own record on ${date}. It is a rendered replay for reference, not the original live conversation.`;
}

// Prefer a TRUE reopen (cheaper, byte-identical history, no
// rendering/replay needed at all) whenever the FOLD TARGET's topic still
// EXISTS - a mapping present means the topic was only ever CLOSED, never
// deleted. Recreate is the fallback ONLY once the target is genuinely gone
// - reopenForumTopic on a dead thread id cannot work at all, per
// Telegram's own API. BL-495: keyed on the ticket's fold-target topic id
// (its epic's topic, or the standing Backlog topic's id) - never a
// per-ticket id, since no per-ticket topic exists post-BL-493. The caller
// resolves WHICH map/key that id comes from - topicRouter.ts's own
// ensureEpicTopicId/ensureBacklogTopic already establish those two lookups
// for the live tick; the repair CLI mirrors them.
export type TopicRestoreAction = { action: 'reopen'; topicId: number } | { action: 'recreate' };

export function decideTopicRestore(targetTopicId: number | undefined): TopicRestoreAction {
  return targetTopicId === undefined ? { action: 'recreate' } : { action: 'reopen', topicId: targetTopicId };
}

export interface FoldTopicRecreationAdapters {
  createTopic: (name: string) => Promise<number | undefined>;
  postMessage: (topicId: number, text: string) => Promise<boolean>;
  // Records the NEW thread id under the fold target's own key (an epic id,
  // or the Backlog subject) - the caller supplies the write, since which
  // map/key that is differs by target kind.
  recordTopicId: (topicId: number) => void;
}

export interface TopicRecreationResult {
  success: boolean;
  topicId?: number;
}

// Creates a fresh fold-target topic and posts the reconstruction header -
// no message replay (see the HONEST LIMIT comment above). A createTopic
// failure is a clean no-op: nothing is recorded, the caller can simply
// retry. The mapping is only ARMED onto a topic whose header actually
// posted: a failed postMessage skips recordTopicId, so the target stays
// unmapped and a later retry can recreate again, rather than routing to a
// topic silently missing even its own reconstruction label.
export async function recreateFoldTopic(name: string, adapters: FoldTopicRecreationAdapters, nowMs: number): Promise<TopicRecreationResult> {
  const topicId = await adapters.createTopic(name);
  if (topicId === undefined) {
    return { success: false };
  }
  const posted = await adapters.postMessage(topicId, reconstructionHeaderText(nowMs));
  if (!posted) {
    return { success: false, topicId };
  }
  adapters.recordTopicId(topicId);
  return { success: true, topicId };
}
