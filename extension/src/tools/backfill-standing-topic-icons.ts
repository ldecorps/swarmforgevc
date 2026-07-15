#!/usr/bin/env node
// BL-418 scope item ("Plus tests and a backfill"): a bulk, human-INITIATED
// seed for the standing (non-ticket) topics' icons - the Operator topic and
// every currently-open support subject - mirroring BL-342's own
// backfill-topic-icons.ts exactly: a ONE-TIME maintenance pass (running it
// at all IS the authorization) that treats every standing topic as eligible
// to receive its computed icon regardless of any existing marker, never the
// live tick's own conservative "only a genuinely NEW appearance is free to
// set" posture (conciergeTick.ts's syncStandingTopicIcons).
//
// This is also what makes the live tick's own change-gate safe from day
// one: it ALSO seeds standingIconSeenIds (the durable "already evaluated"
// set conciergeTick.ts's TickState carries) with every standing topic this
// backfill just touched, so the live tick never re-treats an
// already-backfilled topic as "newly entered" and never re-derives its own
// (unprotected, override-everything) eligibility for it - only a standing
// topic that appears AFTER this backfill runs is later picked up
// automatically by the live tick's own diff.
//
// Usage: node backfill-standing-topic-icons.js <target-repo-path>
import { getForumTopicIconStickers, TelegramPostFn } from '../notify/telegramClient';
import { STANDING_TOPIC_ICON, IconStickerLookup } from '../concierge/topicIcon';
import { syncTopicIcon, IconSyncOutcome } from '../concierge/topicIconSync';
import { standingTopicTargets, readTickState, writeTickState } from './telegram-front-desk-bot';
import { requiredEnv, defaultWait, buildAlwaysEligibleIconAdapters } from './backfill-topic-icons';
import { runCliMain } from './swarm-metrics';

export interface BackfillStandingIconOutcome {
  id: string;
  outcome: IconSyncOutcome;
}

export async function backfillStandingTopicIcons(
  targetPath: string,
  botToken: string,
  chatId: string,
  wait: (ms: number) => Promise<void> = defaultWait,
  postFn?: TelegramPostFn
): Promise<BackfillStandingIconOutcome[]> {
  const targets = standingTopicTargets(targetPath);
  const iconStickersResult = await getForumTopicIconStickers(botToken, postFn);
  const stickers: IconStickerLookup[] = iconStickersResult.success ? iconStickersResult.stickers : [];
  const adapters = buildAlwaysEligibleIconAdapters(targetPath, botToken, chatId, stickers, wait, postFn);

  const outcomes: BackfillStandingIconOutcome[] = [];
  for (const target of targets) {
    const outcome = await syncTopicIcon(target.id, target.topicId, STANDING_TOPIC_ICON[target.iconKey], true, adapters);
    outcomes.push({ id: target.id, outcome });
  }

  // Seed the live tick's own seen-set with every id this backfill just
  // touched, so it never re-treats these as "newly entered" - see this
  // file's header for why that matters.
  const state = readTickState(targetPath);
  const seen = new Set([...(state.standingIconSeenIds ?? []), ...targets.map((t) => t.id)]);
  writeTickState(targetPath, { ...state, standingIconSeenIds: [...seen] });

  return outcomes;
}

export function formatBackfillStandingSummary(outcomes: BackfillStandingIconOutcome[]): string {
  const updated = outcomes.filter((o) => o.outcome === 'updated').length;
  const rest = outcomes.length - updated;
  return `BACKFILLED ${updated}/${outcomes.length} standing topic(s)${rest > 0 ? ` (${rest} not updated - see detail)` : ''}`;
}

export async function main(): Promise<void> {
  const targetPath = process.argv[2];
  if (!targetPath) {
    process.stderr.write('Usage: backfill-standing-topic-icons.js <target-repo-path>\n');
    process.exitCode = 1;
    return;
  }
  const botToken = requiredEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requiredEnv('TELEGRAM_CHAT_ID');
  const outcomes = await backfillStandingTopicIcons(targetPath, botToken, chatId);
  process.stdout.write(`${formatBackfillStandingSummary(outcomes)}\n`);
  process.stdout.write(`${JSON.stringify(outcomes)}\n`);
}

if (require.main === module) {
  runCliMain(main);
}
