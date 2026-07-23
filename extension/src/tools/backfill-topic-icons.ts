#!/usr/bin/env node
// BL-342 scope item 5: a bulk backfill for the 26 ticket topics the
// Operator hand-iconed before this ticket existed - seeds the swarm's own
// ownership marker (blTopicStore.ts's swarmIconId) across every EXISTING
// ticket topic so future state changes can maintain it automatically.
// Deliberately different from the live tick's own syncTopicIcon posture:
// this is a ONE-TIME, human-INITIATED maintenance pass (running it at all
// IS the authorization), so it treats every ticket topic as eligible to
// receive its computed icon regardless of any existing marker - never an
// epic topic (trophy/lightning/folder), excluded by type entirely, the
// SAME scope boundary the live sync uses.
//
// MUST HONOUR RATE LIMITS AND COMPLETE EVERY TOPIC. The Operator's own
// hand pass hit "Too Many Requests: retry after 26" after 19 of 26 calls
// and silently dropped the remaining 7 - the exact failure this backfill
// exists to never repeat. A 429 waits exactly retry_after seconds (never
// a generic guess) and retries the SAME topic, unboundedly - a genuine
// (non-429) failure is not retried and is simply reported.
//
// Usage: node backfill-topic-icons.js <target-repo-path>
import { readBacklogFolders, BacklogItem } from '../panel/backlogReader';
import { readBacklogTopicMap } from '../concierge/backlogTopicMapStore';
import { editForumTopicWithRateLimitRetry, getForumTopicIconStickers, TelegramPostFn } from '../notify/telegramClient';
import { readSwarmIconId, recordSwarmIconId } from '../concierge/blTopicStore';
import { resolveIconState, ICON_EMOJI, IconStickerLookup } from '../concierge/topicIcon';
import { syncTopicIcon, IconSyncOutcome, TopicIconAdapters } from '../concierge/topicIconSync';
import { runCliMain } from './swarm-metrics';

export interface BackfillIconOutcome {
  backlogId: string;
  outcome: IconSyncOutcome;
}

// Exported so backfill-standing-topic-icons.ts (BL-418, the same one-time
// maintenance-pass shape for the standing topics) can share this rather
// than duplicating it - mirrors that file's own import of
// setTopicIconWithRateLimitRetry below.
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set in the environment`);
  }
  return value;
}

export function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// BL-342: honours a 429's own told-you-so retry_after, unboundedly - the
// one place in this codebase a retry loop is deliberately NOT capped,
// because the alternative (giving up) is precisely the "7 of 26 silently
// dropped" failure this ticket exists to close. A genuine (non-429)
// failure returns false immediately rather than looping forever on
// something that can never succeed. BL-414: the retry loop itself now
// lives in telegramClient.ts's editForumTopicWithRateLimitRetry (generalized
// to any editForumTopic update, not just an icon) so the live concierge
// tick's title-age sync can reuse it too, rather than a second copy of this
// same loop; this function keeps its own name/signature as the icon-shaped
// call every existing caller/test already uses.
export async function setTopicIconWithRateLimitRetry(
  botToken: string,
  chatId: string,
  topicId: number,
  iconCustomEmojiId: string,
  wait: (ms: number) => Promise<void> = defaultWait,
  postFn?: TelegramPostFn
): Promise<boolean> {
  return editForumTopicWithRateLimitRetry(botToken, chatId, topicId, { iconCustomEmojiId }, wait, postFn);
}

// Exported so backfill-standing-topic-icons.ts (BL-418) shares this rather
// than duplicating it - both backfills build the SAME "always eligible"
// TopicIconAdapters shape (see the comment on readSwarmIconId below), only
// ever varying by which live target/topic-id pairs they loop over.
export function buildAlwaysEligibleIconAdapters(
  targetPath: string,
  botToken: string,
  chatId: string,
  stickers: IconStickerLookup[],
  wait: (ms: number) => Promise<void>,
  postFn?: TelegramPostFn
): TopicIconAdapters {
  return {
    getIconStickers: async () => stickers,
    setTopicIcon: (topicId, iconId) => setTopicIconWithRateLimitRetry(botToken, chatId, topicId, iconId, wait, postFn),
    // BL-342/418: the backfill's own "always eligible" posture (see this
    // file's header) - never consults the real marker, so isNewTopic=true
    // on every call below is what actually grants that eligibility;
    // readSwarmIconId here exists only to satisfy the shared interface and
    // is never reached, since syncTopicIcon short-circuits its own
    // ownership check whenever isNewTopic is true.
    readSwarmIconId: (id) => readSwarmIconId(targetPath, id),
    recordSwarmIconId: (id, iconId) => recordSwarmIconId(targetPath, id, iconId),
  };
}

// Exported so every one-time backfill (this file, backfill-standing-topic-
// icons.ts, backfill-epic-topic-icons.ts) shares the SAME "fetch the live
// sticker set, fall back to empty on failure, then build the always-eligible
// adapters" sequence rather than each carrying its own copy (BL-449 tripled
// what was already a 2-file duplication into 3 identical copies).
export async function fetchAlwaysEligibleIconAdapters(
  targetPath: string,
  botToken: string,
  chatId: string,
  wait: (ms: number) => Promise<void> = defaultWait,
  postFn?: TelegramPostFn
): Promise<TopicIconAdapters> {
  const iconStickersResult = await getForumTopicIconStickers(botToken, postFn);
  const stickers: IconStickerLookup[] = iconStickersResult.success ? iconStickersResult.stickers : [];
  return buildAlwaysEligibleIconAdapters(targetPath, botToken, chatId, stickers, wait, postFn);
}

interface FolderedItem {
  item: BacklogItem;
  folder: 'active' | 'paused' | 'done';
}

// Every non-epic ticket across all three folders, tagged with which one
// currently holds it - resolveIconState's own required input.
function allTicketsByFolder(targetPath: string): FolderedItem[] {
  const folders = readBacklogFolders(targetPath);
  const tagged: FolderedItem[] = [
    ...folders.active.map((item) => ({ item, folder: 'active' as const })),
    ...folders.paused.map((item) => ({ item, folder: 'paused' as const })),
    ...folders.done.map((item) => ({ item, folder: 'done' as const })),
  ];
  return tagged.filter(({ item }) => item.type !== 'epic');
}

export async function backfillTopicIcons(
  targetPath: string,
  botToken: string,
  chatId: string,
  wait: (ms: number) => Promise<void> = defaultWait,
  postFn?: TelegramPostFn
): Promise<BackfillIconOutcome[]> {
  const topicMap = readBacklogTopicMap(targetPath);
  const adapters = await fetchAlwaysEligibleIconAdapters(targetPath, botToken, chatId, wait, postFn);

  const outcomes: BackfillIconOutcome[] = [];
  for (const { item, folder } of allTicketsByFolder(targetPath)) {
    const topicId = topicMap[item.id];
    if (topicId === undefined) {
      continue;
    }
    // BL-424: same paused-scoped awaiting-approval state + fallback as the
    // live tick's syncIconForBacklogId - item.humanApproval is already
    // parsed off the ticket YAML by readBacklogFolders/BacklogItem.
    const state = resolveIconState(folder, item.type, item.humanApproval);
    const fallbackEmoji = state === 'awaiting-approval' ? ICON_EMOJI.paused : undefined;
    const outcome = await syncTopicIcon(item.id, topicId, ICON_EMOJI[state], true, adapters, fallbackEmoji);
    outcomes.push({ backlogId: item.id, outcome });
  }
  return outcomes;
}

export function formatBackfillSummary(outcomes: BackfillIconOutcome[]): string {
  const updated = outcomes.filter((o) => o.outcome === 'updated').length;
  const rest = outcomes.length - updated;
  return `BACKFILLED ${updated}/${outcomes.length} topic(s)${rest > 0 ? ` (${rest} not updated - see detail)` : ''}`;
}

export async function main(): Promise<void> {
  const targetPath = process.argv[2];
  if (!targetPath) {
    process.stderr.write('Usage: backfill-topic-icons.js <target-repo-path>\n');
    process.exitCode = 1;
    return;
  }
  const botToken = requiredEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requiredEnv('TELEGRAM_CHAT_ID');
  const outcomes = await backfillTopicIcons(targetPath, botToken, chatId);
  process.stdout.write(`${formatBackfillSummary(outcomes)}\n`);
  process.stdout.write(`${JSON.stringify(outcomes)}\n`);
}

if (require.main === module) {
  runCliMain(main);
}
