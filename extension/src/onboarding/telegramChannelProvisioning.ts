import { GetUpdatesResult, TelegramUpdate } from '../notify/telegramClient';
import { nextUpdateOffset } from '../tools/telegramFrontDeskBotCore';

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
//
// BL-444: the CLI's own documented happy path ("create a group ... THEN
// enable Topics") CAUSES Telegram to silently upgrade the basic group to a
// supergroup with a NEW id, emitting migrate_to_chat_id/migrate_from_chat_id
// service messages - so "the first chat any update carries" is, on every
// real onboarding, the DEAD pre-migration id. Scan every update (never stop
// at the first) and follow the newest migration signal seen, so the live
// post-migration id always wins over the stale first-seen one, regardless of
// where in the batch the migration notice happens to land.
export function decideChannelDetection(updates: TelegramUpdate[]): ChannelDetectionResult {
  const withChat = updates.filter((update) => update.message?.chat?.id !== undefined);
  if (withChat.length === 0) {
    return { ready: false };
  }

  let chatId = String(withChat[0].message!.chat.id);
  for (const update of withChat) {
    const message = update.message!;
    if (message.migrate_to_chat_id !== undefined) {
      chatId = String(message.migrate_to_chat_id);
    } else if (message.migrate_from_chat_id !== undefined) {
      chatId = String(message.chat.id);
    }
  }
  return { ready: true, chatId };
}

export interface CreateNegotiationTopicOutcome {
  success: boolean;
  messageThreadId?: number;
  error?: string;
  // BL-444: set when the target's chat id has migrated (Telegram's own
  // "group chat was upgraded to a supergroup chat" error carries the new
  // id) - a REDIRECT to retry against, never a terminal failure.
  migrateToChatId?: string;
}

export interface ChannelProvisioningAdapters {
  // BL-380 bounce: was `() => Promise<TelegramUpdate[]>` - discarding
  // success/error collapsed a fetch FAILURE (bad token, network error) into
  // the same empty-array shape as "no updates yet", so provisionTelegramChannel
  // could never tell the two apart. Reuses telegramClient.ts's own
  // GetUpdatesResult rather than inventing a second success/error shape.
  getUpdates: () => Promise<GetUpdatesResult>;
  createNegotiationTopic: (chatId: string) => Promise<CreateNegotiationTopicOutcome>;
  persistChannel: (chatId: string, negotiationTopicId: number) => void | Promise<void>;
  persistBotToken: () => void | Promise<void>;
  // BL-444: called with the getUpdates offset to confirm once provisioning
  // has FULLY succeeded (chat detected AND the negotiation topic opened) -
  // advances the CLI's own persisted offset past every update this run
  // consumed, so a later re-run never re-fetches the stale pre-migration
  // queue that poisoned every prior re-run (this ticket's own root cause:
  // "the confirm-offset never advances").
  persistConfirmOffset: (offset: number) => void | Promise<void>;
}

export interface ChannelProvisioningOutcome {
  instructions: ChannelProvisioningInstructions;
  ready: boolean;
  chatId?: string;
  negotiationTopicId?: number;
  error?: string;
}

type ChatDetectionOutcome =
  | { ready: false; error?: string }
  // BL-444: nextOffset is the offset a caller should confirm once the WHOLE
  // provisioning outcome (not just detection) has succeeded - computed here
  // because this is the one place that still has the raw update list.
  | { ready: true; chatId: string; nextOffset: number };

// Split out of provisionTelegramChannel (BL-394 hardening: CRAP was 8 on the
// unsplit function) so the fetch/detect decision points and the
// topic-open/persist decision points are counted, and covered, separately.
// Behavior-preserving: the branch shapes below are copied verbatim from the
// original inline code, including the not-ready branch's bare `{ ready:
// false }` (no `error` key) so a caller that spreads this result never gains
// an `error: undefined` key the pre-split code never produced.
async function detectReadyChatId(adapters: ChannelProvisioningAdapters): Promise<ChatDetectionOutcome> {
  const updatesResult = await adapters.getUpdates();
  if (!updatesResult.success) {
    // BL-380 bounce: distinguishable from the legitimate not-ready-yet
    // outcome below (which carries no `error` field) by the presence of one.
    return { ready: false, error: updatesResult.error ?? 'failed to fetch updates' };
  }
  const detection = decideChannelDetection(updatesResult.updates);
  if (!detection.ready || detection.chatId === undefined) {
    return { ready: false };
  }
  return { ready: true, chatId: detection.chatId, nextOffset: nextUpdateOffset(updatesResult.updates, 0) };
}

// BL-380 scenario 04's guard lives here structurally: createNegotiationTopic
// is only ever called once decideChannelDetection has already reported
// ready, so a half-finished channel can never open a topic. Split out of
// provisionTelegramChannel so that function's own branch count reflects only
// the getUpdates/detection stages, not this separate topic-creation stage.
//
// BL-444: "group chat was upgraded to a supergroup chat" is a REDIRECT to the
// new id Telegram includes in that same error (migrateToChatId), not a
// terminal failure - retried exactly once against the new id (never chases a
// chain of retries; a second migration within the SAME call is not a real
// scenario this needs to survive).
async function finalizeChannelProvisioning(
  chatId: string,
  instructions: ChannelProvisioningInstructions,
  adapters: ChannelProvisioningAdapters
): Promise<ChannelProvisioningOutcome> {
  const topic = await adapters.createNegotiationTopic(chatId);
  if (topic.success && topic.messageThreadId !== undefined) {
    await adapters.persistChannel(chatId, topic.messageThreadId);
    return { instructions, ready: true, chatId, negotiationTopicId: topic.messageThreadId };
  }

  if (topic.migrateToChatId !== undefined) {
    const redirectedChatId = topic.migrateToChatId;
    const retriedTopic = await adapters.createNegotiationTopic(redirectedChatId);
    if (retriedTopic.success && retriedTopic.messageThreadId !== undefined) {
      await adapters.persistChannel(redirectedChatId, retriedTopic.messageThreadId);
      return { instructions, ready: true, chatId: redirectedChatId, negotiationTopicId: retriedTopic.messageThreadId };
    }
    return {
      instructions,
      ready: true,
      chatId: redirectedChatId,
      error: retriedTopic.error ?? 'failed to open the negotiation topic after following the supergroup migration',
    };
  }

  return {
    instructions,
    ready: true,
    chatId,
    error: topic.error ?? 'failed to open the negotiation topic',
  };
}

export async function provisionTelegramChannel(
  botUsername: string,
  adapters: ChannelProvisioningAdapters
): Promise<ChannelProvisioningOutcome> {
  const instructions = buildChannelProvisioningInstructions(botUsername);
  await adapters.persistBotToken();

  const detection = await detectReadyChatId(adapters);
  if (!detection.ready) {
    return { instructions, ...detection };
  }

  const outcome = await finalizeChannelProvisioning(detection.chatId, instructions, adapters);
  if (outcome.negotiationTopicId !== undefined) {
    // BL-444: only a FULLY successful provisioning confirms the offset - a
    // topic-open failure leaves the stale updates available to a retry,
    // rather than risking hiding real diagnostic updates behind a
    // half-succeeded confirm.
    await adapters.persistConfirmOffset(detection.nextOffset);
  }
  return outcome;
}
