#!/usr/bin/env node
// BL-332/BL-495: one-shot CLI a human/Operator runs to bring a ticket's
// Telegram topic back - REOPENS it if it still exists (cheaper,
// byte-identical history), or RECREATES it once it is genuinely gone.
// BL-495 (topic-consolidation epic): post-BL-493 there is no per-ticket
// topic anymore, so the repair path targets the ticket's FOLD target
// instead - its epic's topic (epic-bound), or the standing Backlog topic
// (epic-less) - never resurrecting the retired per-ticket model.
// decideTopicRestore/recreateFoldTopic (topicRecreation.ts) own the actual
// decision/recreate logic; this file only wires the real
// Telegram/filesystem adapters, same "thin CLI, real logic elsewhere"
// shape as repair-bl-topic-records.ts.
//
// Usage: recreate-bl-topic.js <project-root> <ticket-id>
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
import { toFoldersSnapshot, readTopicMap, writeTopicMap, topicMapKey } from './telegram-front-desk-bot';
import { epicDefinitionsFor, epicTitleFor } from '../concierge/conciergeTick';
import { resolveTicketStatusTarget } from '../concierge/ticketStatusMessage';
import { epicTopicName } from '../concierge/topicRouter';
import { decideTopicRestore, recreateFoldTopic, TopicRecreationResult } from '../concierge/topicRecreation';
import { createForumTopic, reopenForumTopic, sendTelegramMessage } from '../notify/telegramClient';
import { BACKLOG_SUBJECT_ID, BACKLOG_TOPIC_NAME, topicForSubject } from './telegramFrontDeskBotCore';
import { readBacklogTopicMap, writeBacklogTopicMap } from '../concierge/backlogTopicMapStore';
import { runCliMain } from './swarm-metrics';

// BL-353/notify-dead-letters.ts's own TELEGRAM_NOTIFY_FORCE_RESULT
// convention, mirrored exactly - no real network call ever happens under
// it. One shared seam covers all three Telegram calls this CLI can make
// (reopen, create, post) since a test driving main() in-process only
// needs to prove the WIRING (which branch runs, what gets recorded), not
// re-exercise telegramClient.ts's own already-unit-tested response
// parsing a second time here.
async function callTelegramOrForced<T extends { success: boolean }>(real: () => Promise<T>): Promise<T> {
  const forced = process.env.TELEGRAM_RECREATE_FORCE_RESULT;
  if (forced) {
    return JSON.parse(forced);
  }
  return real();
}

export interface RecreateBlTopicResult {
  action: 'reopen' | 'recreate';
  success: boolean;
  topicId?: number;
}

// BL-495: the repair path itself, keyed on the fold target's OWN current
// topic id (undefined if it doesn't exist yet) and how to record a freshly
// recreated one - the two call sites below resolve those two things
// differently (an epic-bound ticket's target lives in backlog-topic-
// map.json keyed by its epic id; an epic-less ticket's target, the
// standing Backlog topic, lives in telegram-topic-map.json keyed by the
// reserved BACKLOG_SUBJECT_ID via topicForSubject's own reverse lookup -
// never a single flattened map, since that is not how these two topics are
// actually persisted), but the reopen-or-recreate mechanics themselves are
// identical, so this is the ONE place that mechanic is written.
async function reopenOrRecreateFoldTopic(
  currentTopicId: number | undefined,
  name: string,
  recordTopicId: (topicId: number) => void,
  token: string,
  chatId: string,
  nowMs: number
): Promise<RecreateBlTopicResult> {
  const restore = decideTopicRestore(currentTopicId);
  if (restore.action === 'reopen') {
    const reopened = await callTelegramOrForced(() => reopenForumTopic(token, chatId, restore.topicId));
    return { action: 'reopen', success: reopened.success, topicId: restore.topicId };
  }
  const result: TopicRecreationResult = await recreateFoldTopic(
    name,
    {
      createTopic: async (topicName) => {
        const created = await callTelegramOrForced(() => createForumTopic(token, chatId, topicName));
        return created.success ? created.messageThreadId : undefined;
      },
      postMessage: async (topicId, text) => {
        const sent = await callTelegramOrForced(() => sendTelegramMessage(token, chatId, text, undefined, undefined, topicId));
        return sent.success;
      },
      recordTopicId,
    },
    nowMs
  );
  return { action: 'recreate', success: result.success, topicId: result.topicId };
}

export async function recreateBlTopic(targetPath: string, ticketId: string, nowMs: number = Date.now()): Promise<RecreateBlTopicResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || '';
  const folders = toFoldersSnapshot(targetPath);
  const ticket = [...folders.active, ...folders.paused, ...folders.done].find((item) => item.id === ticketId);
  const target = resolveTicketStatusTarget(ticket?.epic);

  if (target.kind === 'backlog') {
    const opTopicMap = readTopicMap(targetPath);
    return reopenOrRecreateFoldTopic(
      topicForSubject(opTopicMap, BACKLOG_SUBJECT_ID),
      BACKLOG_TOPIC_NAME,
      (topicId) => {
        const map = readTopicMap(targetPath);
        map[topicMapKey(topicId)] = BACKLOG_SUBJECT_ID;
        writeTopicMap(targetPath, map);
      },
      token,
      chatId,
      nowMs
    );
  }

  const { epicId } = target;
  const epicTitle = epicTitleFor(epicId, epicDefinitionsFor(folders)) ?? epicId;
  const topicMap = readBacklogTopicMap(targetPath);
  return reopenOrRecreateFoldTopic(
    topicMap[epicId],
    epicTopicName(epicTitle),
    (topicId) => {
      const map = readBacklogTopicMap(targetPath);
      map[epicId] = topicId;
      writeBacklogTopicMap(targetPath, map);
    },
    token,
    chatId,
    nowMs
  );
}

export async function main(): Promise<void> {
  const targetPath = process.argv[2];
  const ticketId = process.argv[3];
  if (!targetPath || !ticketId) {
    process.stderr.write('Usage: recreate-bl-topic.js <project-root> <ticket-id>\n');
    process.exitCode = 1;
    return;
  }
  const result = await recreateBlTopic(targetPath, ticketId);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  runCliMain(main);
}
