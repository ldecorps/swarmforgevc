#!/usr/bin/env node
// BL-449: a one-time, human-initiated seed for the icons of the three epic
// topics the human hand-created before this ticket existed (147 Swarm Role
// Benchmarking, 149 Dynamic Routing, 151 Onboarding a New Target Repo) -
// mirrors backfill-topic-icons.ts/backfill-standing-topic-icons.ts's own
// "always eligible" one-time maintenance-pass shape (running it at all IS
// the authorization) exactly, only varying by source: those three topics
// were never created through decideEpicTopicAction's own create/reuse flow,
// so there is no existing live source for their topic ids - this reads the
// human-provided epic-topic-map.json (epicTopicMapStore.ts) instead.
//
// Also seeds backlog-topic-map.json with each entry (when not already
// present) - decideEpicTopicAction/postEpicAction (topicRouter.ts/
// conciergeTick.ts) already treat that SAME map as their create-vs-reuse
// gate for every other epic topic, so adding these entries there is what
// stops the live tick from ever re-treating a backfilled epic as
// newly-entered and creating a duplicate topic for it - mirrors
// backfill-standing-topic-icons.ts's own standingIconSeenIds seed, reusing
// the mechanism epics already have rather than inventing a second one.
//
// Usage: node backfill-epic-topic-icons.js <target-repo-path>
import { readEpicTopicMap } from '../concierge/epicTopicMapStore';
import { readBacklogTopicMap, writeBacklogTopicMap } from '../concierge/backlogTopicMapStore';
import { getForumTopicIconStickers, TelegramPostFn } from '../notify/telegramClient';
import { IconStickerLookup } from '../concierge/topicIcon';
import { resolveEpicIcon } from '../concierge/epicIcon';
import { syncTopicIcon, IconSyncOutcome } from '../concierge/topicIconSync';
import { requiredEnv, defaultWait, buildAlwaysEligibleIconAdapters } from './backfill-topic-icons';
import { runCliMain } from './swarm-metrics';

export interface BackfillEpicIconOutcome {
  epicId: string;
  outcome: IconSyncOutcome;
}

// Only fills an ABSENT entry - an epic topic id already known to
// backlog-topic-map.json (whether backfilled by a prior run, or created
// live through the normal epic-topic-create path) is never overwritten by
// this backfill's own input.
function seedBacklogTopicMap(targetPath: string, epicTopicMap: Record<string, number>): void {
  const backlogTopicMap = readBacklogTopicMap(targetPath);
  let changed = false;
  for (const [epicId, topicId] of Object.entries(epicTopicMap)) {
    if (backlogTopicMap[epicId] === undefined) {
      backlogTopicMap[epicId] = topicId;
      changed = true;
    }
  }
  if (changed) {
    writeBacklogTopicMap(targetPath, backlogTopicMap);
  }
}

export async function backfillEpicTopicIcons(
  targetPath: string,
  botToken: string,
  chatId: string,
  wait: (ms: number) => Promise<void> = defaultWait,
  postFn?: TelegramPostFn
): Promise<BackfillEpicIconOutcome[]> {
  const epicTopicMap = readEpicTopicMap(targetPath);
  seedBacklogTopicMap(targetPath, epicTopicMap);

  const iconStickersResult = await getForumTopicIconStickers(botToken, postFn);
  const stickers: IconStickerLookup[] = iconStickersResult.success ? iconStickersResult.stickers : [];
  const adapters = buildAlwaysEligibleIconAdapters(targetPath, botToken, chatId, stickers, wait, postFn);

  const outcomes: BackfillEpicIconOutcome[] = [];
  const usedIcons: string[] = [];
  for (const [epicId, topicId] of Object.entries(epicTopicMap)) {
    const icon = resolveEpicIcon(epicId, usedIcons);
    usedIcons.push(icon);
    const outcome = await syncTopicIcon(epicId, topicId, icon, true, adapters);
    outcomes.push({ epicId, outcome });
  }
  return outcomes;
}

export function formatBackfillEpicSummary(outcomes: BackfillEpicIconOutcome[]): string {
  const updated = outcomes.filter((o) => o.outcome === 'updated').length;
  const rest = outcomes.length - updated;
  return `BACKFILLED ${updated}/${outcomes.length} epic topic(s)${rest > 0 ? ` (${rest} not updated - see detail)` : ''}`;
}

export async function main(): Promise<void> {
  const targetPath = process.argv[2];
  if (!targetPath) {
    process.stderr.write('Usage: backfill-epic-topic-icons.js <target-repo-path>\n');
    process.exitCode = 1;
    return;
  }
  const botToken = requiredEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requiredEnv('TELEGRAM_CHAT_ID');
  const outcomes = await backfillEpicTopicIcons(targetPath, botToken, chatId);
  process.stdout.write(`${formatBackfillEpicSummary(outcomes)}\n`);
  process.stdout.write(`${JSON.stringify(outcomes)}\n`);
}

if (require.main === module) {
  runCliMain(main);
}
