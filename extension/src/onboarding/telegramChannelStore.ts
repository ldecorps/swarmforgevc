import * as fs from 'fs';
import * as path from 'path';

// BL-380: the target's OWN, machine-local record of its provisioned Telegram
// channel - the chat id and the contract-negotiation topic id. Never the bot
// token (see telegramChannelSecretStore.ts, which is the host-side, outside-
// the-working-tree home for that) - only non-secret ids, the same
// "gitignored, machine-local" posture telegram-front-desk-bot.ts's own
// telegram-topic-map.json already establishes under this exact directory.
export interface TelegramChannelRecord {
  chatId: string;
  negotiationTopicId: number;
}

function telegramChannelPath(targetRepoPath: string): string {
  return path.join(targetRepoPath, '.swarmforge', 'operator', 'telegram-channel.json');
}

export function readTelegramChannel(targetRepoPath: string): TelegramChannelRecord | undefined {
  try {
    return JSON.parse(fs.readFileSync(telegramChannelPath(targetRepoPath), 'utf8')) as TelegramChannelRecord;
  } catch {
    return undefined;
  }
}

export function writeTelegramChannel(targetRepoPath: string, record: TelegramChannelRecord): void {
  const filePath = telegramChannelPath(targetRepoPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(record));
}
