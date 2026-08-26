#!/usr/bin/env node
// BL-494: one-time reconcile CLI that CLOSES (never deletes -
// closeForumTopic collapses a topic to read-only and PRESERVES its
// history) every legacy per-ticket Telegram topic now that BL-492/493's
// edit-in-place epic/Backlog routing has replaced the old per-ticket-topic
// model. Honors a 429's own told-you-so retry_after exactly as
// backfill-topic-icons.ts already does (reusing telegramClient.ts's shared
// closeForumTopicWithRateLimitRetry, never a second throttle) - this is a
// mass edit over a rate-limited surface at first-run volume (potentially
// hundreds of topics), the exact backfill-storm the engineering.prompt
// rate-limit rule and the operator memory "icon-backfill-vs-stale-tick"
// exist to prevent.
//
// A HAND-RUN operator CLI, deliberately not an automatic sweep - a mass
// close over a live group should not fire unattended (human decision,
// BL-494's own approval_context).
//
// Usage: node close-legacy-ticket-topics.js <target-repo-path>
import { readBacklogTopicMap, dropBacklogTopicMapping } from '../concierge/backlogTopicMapStore';
import { closeForumTopicWithRateLimitRetry, TelegramPostFn } from '../notify/telegramClient';
import { selectLegacyPerTicketTopics, LegacyTopicEntry } from '../concierge/legacyTopicReconcile';
import { runCliMain } from './swarm-metrics';
import { requiredEnv, defaultWait } from './backfill-topic-icons';

export interface CloseLegacyTopicOutcome {
  backlogId: string;
  closed: boolean;
}

// Exported so a test can drive the close loop directly against fixture
// entries + a fake close function, without touching disk - the map read
// and the per-success drop (both real fs) stay in closeLegacyTicketTopics
// below.
export async function closeEachLegacyTopic(entries: LegacyTopicEntry[], close: (topicId: number) => Promise<boolean>): Promise<CloseLegacyTopicOutcome[]> {
  const outcomes: CloseLegacyTopicOutcome[] = [];
  for (const entry of entries) {
    const closed = await close(entry.topicId);
    outcomes.push({ backlogId: entry.backlogId, closed });
  }
  return outcomes;
}

// Idempotent: a topic already closed (or whose key was already dropped) is
// simply absent from selectLegacyPerTicketTopics' next read, so a re-run is
// a safe no-op. A genuinely-failed close (a non-429 rejection) is left in
// the map so a later re-run retries it - only a CONFIRMED close drops the
// key, never a delivery attempt.
export async function closeLegacyTicketTopics(
  targetPath: string,
  botToken: string,
  chatId: string,
  wait: (ms: number) => Promise<void> = defaultWait,
  postFn?: TelegramPostFn
): Promise<CloseLegacyTopicOutcome[]> {
  const entries = selectLegacyPerTicketTopics(readBacklogTopicMap(targetPath));
  const outcomes = await closeEachLegacyTopic(entries, (topicId) => closeForumTopicWithRateLimitRetry(botToken, chatId, topicId, wait, postFn));
  for (const outcome of outcomes) {
    if (outcome.closed) {
      dropBacklogTopicMapping(targetPath, outcome.backlogId);
    }
  }
  return outcomes;
}

export function formatCloseSummary(outcomes: CloseLegacyTopicOutcome[]): string {
  const closed = outcomes.filter((o) => o.closed).length;
  const rest = outcomes.length - closed;
  return `CLOSED ${closed}/${outcomes.length} legacy per-ticket topic(s)${rest > 0 ? ` (${rest} not closed - see detail)` : ''}`;
}

export async function main(): Promise<void> {
  const targetPath = process.argv[2];
  if (!targetPath) {
    process.stderr.write('Usage: close-legacy-ticket-topics.js <target-repo-path>\n');
    process.exitCode = 1;
    return;
  }
  const botToken = requiredEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requiredEnv('TELEGRAM_CHAT_ID');
  const outcomes = await closeLegacyTicketTopics(targetPath, botToken, chatId);
  process.stdout.write(`${formatCloseSummary(outcomes)}\n`);
  process.stdout.write(`${JSON.stringify(outcomes)}\n`);
}

if (require.main === module) {
  runCliMain(main);
}
