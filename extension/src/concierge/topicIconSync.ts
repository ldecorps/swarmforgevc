// BL-342: the adapter-injected orchestration half of topic icons - reads
// the ticket's icon marker (blTopicStore.ts's own swarmIconId), decides
// whether the swarm may touch this topic's icon at all, resolves the
// desired emoji against the REAL, live-fetched Telegram sticker set, and
// applies it. Mirrors topicRouter.ts's own RouteAdapters shape (a small,
// named adapters interface; a pure decision function; a thin apply step).
import { resolveIconStickerId, IconStickerLookup } from './topicIcon';

export interface TopicIconAdapters {
  // BL-342: getForumTopicIconStickers is a live Telegram read with no
  // per-call caching baked in here - a caller driving MANY topics in one
  // pass (the bulk backfill) should fetch it ONCE and reuse the same list,
  // never refetch per topic.
  getIconStickers: () => Promise<IconStickerLookup[]>;
  setTopicIcon: (topicId: number, iconCustomEmojiId: string) => Promise<boolean>;
  readSwarmIconId: (ticketId: string) => string | undefined;
  recordSwarmIconId: (ticketId: string, iconId: string) => void;
}

export type IconSyncOutcome = 'updated' | 'skipped-not-owned' | 'skipped-unresolved-icon' | 'failed';

// BL-342 scenarios 01/03/04/05: a BRAND NEW topic (isNewTopic) is always
// free to have its initial icon set - there is nothing to protect yet.
// An EXISTING topic may only be updated when the swarm's own marker shows
// it set the CURRENT icon (readSwarmIconId present) - absent means either
// a human customised it (scenario 04, the trophy) or its origin is simply
// unknown (scenario 05) - both cases resolve to the SAME safe default:
// leave it alone. This is the one rule this ticket exists to enforce, so
// it is a single, un-overridable early return, never a flag a caller could
// bypass.
export async function syncTopicIcon(
  ticketId: string,
  topicId: number,
  desiredEmoji: string,
  isNewTopic: boolean,
  adapters: TopicIconAdapters
): Promise<IconSyncOutcome> {
  if (!isNewTopic && adapters.readSwarmIconId(ticketId) === undefined) {
    return 'skipped-not-owned';
  }
  const stickers = await adapters.getIconStickers();
  const iconId = resolveIconStickerId(stickers, desiredEmoji);
  if (iconId === undefined) {
    // BL-342 scenario 06: never call the Telegram API with an id that was
    // not just validated against the live sticker set.
    return 'skipped-unresolved-icon';
  }
  const ok = await adapters.setTopicIcon(topicId, iconId);
  if (!ok) {
    return 'failed';
  }
  adapters.recordSwarmIconId(ticketId, iconId);
  return 'updated';
}
