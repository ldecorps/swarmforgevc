#!/usr/bin/env node
// BL-332: one-shot CLI a human/Operator runs to bring a ticket's Telegram
// topic back - REOPENS it if it still exists (cheaper, byte-identical
// history), or RECREATES it as a labelled reconstruction replayed from
// its own durable repo record (blTopicStore.ts) once it is genuinely
// gone. decideTopicRestore/recreateTopicFromRecord (topicRecreation.ts)
// own the actual decision/replay logic; this file only wires the real
// Telegram/filesystem adapters, same "thin CLI, real logic elsewhere"
// shape as repair-bl-topic-records.ts.
//
// Usage: recreate-bl-topic.js <project-root> <ticket-id>
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
import { readRecord } from '../concierge/blTopicStore';
import { readBacklogFolders } from '../panel/backlogReader';
import { decideTopicRestore, recreateTopicFromRecord, TopicRecreationResult } from '../concierge/topicRecreation';
import { createForumTopic, reopenForumTopic, sendTelegramMessage } from '../notify/telegramClient';
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

export async function recreateBlTopic(targetPath: string, ticketId: string, nowMs: number = Date.now()): Promise<RecreateBlTopicResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || '';
  const topicMap = readBacklogTopicMap(targetPath);
  const restore = decideTopicRestore(topicMap, ticketId);

  if (restore.action === 'reopen') {
    const reopened = await callTelegramOrForced(() => reopenForumTopic(token, chatId, restore.topicId));
    return { action: 'reopen', success: reopened.success, topicId: restore.topicId };
  }

  const folders = readBacklogFolders(targetPath);
  const ticket = [...folders.active, ...folders.paused, ...folders.done].find((item) => item.id === ticketId);
  const title = ticket ? ticket.title : ticketId;

  const result: TopicRecreationResult = await recreateTopicFromRecord(
    ticketId,
    title,
    {
      readRecord: (id) => readRecord(targetPath, id),
      createTopic: async (name) => {
        const created = await callTelegramOrForced(() => createForumTopic(token, chatId, name));
        return created.success ? created.messageThreadId : undefined;
      },
      postMessage: async (topicId, text) => {
        const sent = await callTelegramOrForced(() => sendTelegramMessage(token, chatId, text, undefined, undefined, topicId));
        return sent.success;
      },
      recordTopicId: (id, topicId) => {
        const map = readBacklogTopicMap(targetPath);
        map[id] = topicId;
        writeBacklogTopicMap(targetPath, map);
      },
    },
    nowMs
  );
  return { action: 'recreate', success: result.success, topicId: result.topicId };
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
