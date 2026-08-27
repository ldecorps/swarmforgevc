// BL-744: Telegram env + chunk send helpers for Bubble talk mirror delivery.
import { appendOperatorEvent } from './operatorEventQueue';
import type { MirrorLetsTalkTurnDeps } from './bubbleMirrorTypes';
import { sendTelegramMessageWithRateLimitRetry } from '../notify/telegramClient';
import { splitTelegramChunks } from '../tools/telegramCursorBridgeCore';

export function telegramMirrorEnv(): { botToken: string; chatId: string } | undefined {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    return undefined;
  }
  return { botToken, chatId };
}

export async function sendBubbleMirrorChunks(
  targetPath: string,
  botToken: string,
  chatId: string,
  topicId: number,
  text: string,
  deps: MirrorLetsTalkTurnDeps = {}
): Promise<boolean> {
  const splitChunks = deps.splitChunks ?? splitTelegramChunks;
  const sendMessage = deps.sendMessage ?? sendTelegramMessageWithRateLimitRetry;
  const chunks = splitChunks(text);
  for (let i = 0; i < chunks.length; i += 1) {
    const result = await sendMessage(botToken, chatId, chunks[i], undefined, undefined, topicId);
    if (!result.success) {
      const err = result.error || 'unknown send failure';
      console.error(`Bubble talk mirror failed (topic ${topicId}, chunk ${i + 1}/${chunks.length}): ${err}`);
      appendOperatorEvent(targetPath, {
        type: 'bubble-talk-mirror-failed',
        topicId,
        chunk: i + 1,
        chunkCount: chunks.length,
        error: err,
        at: new Date().toISOString(),
      });
      return false;
    }
  }
  return true;
}
