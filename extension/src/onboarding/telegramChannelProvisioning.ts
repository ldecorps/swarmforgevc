import { TelegramUpdate } from '../notify/telegramClient';

// BL-380: gives each onboarded target its OWN Telegram bot and forum group,
// so the contract can later be negotiated there (BL-381). The Bot API has no
// create-bot or create-group/enable-topics method (telegramClient.ts's own
// createForumTopic comment), so the human does that part once per target by
// hand; this module owns everything either side of it - the instructions
// (including the add-to-group deep link) and detecting completion. The
// human is asked for the bot's token and username (BotFather hands out both
// together) but NEVER the group's chat id - that is read off Telegram's own
// getUpdates reply, because a brand-new per-target bot has seen no chat
// before this, so the first one it reports IS the target's group.

export const NEGOTIATION_TOPIC_NAME = 'Contract negotiation';

export interface ChannelProvisioningInstructions {
  steps: string[];
  addToGroupLink: string;
}

export function buildAddToGroupLink(botUsername: string): string {
  return `https://t.me/${botUsername}?startgroup=true`;
}

export function buildChannelProvisioningInstructions(botUsername: string): ChannelProvisioningInstructions {
  const addToGroupLink = buildAddToGroupLink(botUsername);
  return {
    addToGroupLink,
    steps: [
      "Message @BotFather in Telegram and run /newbot to create this target's own bot (note the token it gives you).",
      'Create a new Telegram group for this target repo.',
      "Open the group's settings and enable Topics (Group settings -> Topics -> on) - it must become a forum-enabled supergroup.",
      `Add the bot to the group and make it an admin using this link: ${addToGroupLink}`,
    ],
  };
}

export interface ChannelDetectionResult {
  ready: boolean;
  chatId?: string;
}

// BL-380 scenario 02: the FIRST chat any update carries IS the target's
// group (the bot is brand new and per-target - see the ticket's own
// load-bearing decision) - so detection never needs, and never accepts, a
// human-supplied chat id.
export function decideChannelDetection(updates: TelegramUpdate[]): ChannelDetectionResult {
  const withChat = updates.find((update) => update.message?.chat?.id !== undefined);
  if (!withChat?.message) {
    return { ready: false };
  }
  return { ready: true, chatId: String(withChat.message.chat.id) };
}

export interface CreateNegotiationTopicOutcome {
  success: boolean;
  messageThreadId?: number;
  error?: string;
}

export interface ChannelProvisioningAdapters {
  getUpdates: () => Promise<TelegramUpdate[]>;
  createNegotiationTopic: (chatId: string) => Promise<CreateNegotiationTopicOutcome>;
  persistChannel: (chatId: string, negotiationTopicId: number) => void | Promise<void>;
  persistBotToken: () => void | Promise<void>;
}

export interface ChannelProvisioningOutcome {
  instructions: ChannelProvisioningInstructions;
  ready: boolean;
  chatId?: string;
  negotiationTopicId?: number;
  error?: string;
}

// BL-380 scenario 04's guard lives here structurally: createNegotiationTopic
// is only ever called once decideChannelDetection has already reported
// ready, so a half-finished channel can never open a topic.
export async function provisionTelegramChannel(
  botUsername: string,
  adapters: ChannelProvisioningAdapters
): Promise<ChannelProvisioningOutcome> {
  const instructions = buildChannelProvisioningInstructions(botUsername);
  await adapters.persistBotToken();

  const updates = await adapters.getUpdates();
  const detection = decideChannelDetection(updates);
  if (!detection.ready || detection.chatId === undefined) {
    return { instructions, ready: false };
  }

  const topic = await adapters.createNegotiationTopic(detection.chatId);
  if (!topic.success || topic.messageThreadId === undefined) {
    return {
      instructions,
      ready: true,
      chatId: detection.chatId,
      error: topic.error ?? 'failed to open the negotiation topic',
    };
  }

  await adapters.persistChannel(detection.chatId, topic.messageThreadId);
  return { instructions, ready: true, chatId: detection.chatId, negotiationTopicId: topic.messageThreadId };
}
