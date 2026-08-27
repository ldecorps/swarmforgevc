import type { SendMessageResult } from '../notify/telegramClient';

export type BubbleMirrorSendFn = (
  token: string,
  chatId: string,
  text: string,
  replyToMessageId?: number,
  postFn?: unknown,
  messageThreadId?: number
) => Promise<SendMessageResult>;

export type BubbleMirrorPollFn = (
  token: string,
  chatId: string,
  question: string,
  options: string[],
  messageThreadId?: number
) => Promise<{ success: boolean; pollId?: string; error?: string }>;

export interface MirrorLetsTalkTurnDeps {
  sendMessage?: BubbleMirrorSendFn;
  sendPoll?: BubbleMirrorPollFn;
  splitChunks?: (text: string, maxLen?: number) => string[];
}
