#!/usr/bin/env node
/**
 * BL-380: onboarding's Telegram-channel provisioning step - a thin CLI that
 * wires the real Telegram API (telegramClient.ts, never a second client) and
 * the real host/target stores around the pure decisions in
 * onboarding/telegramChannelProvisioning.ts. Safe to call more than once for
 * the same target: before the human finishes creating the group it reports
 * not-ready (no topic opened); once the group exists it is detected off
 * Telegram's own reply and the negotiation topic is opened.
 *
 * Usage: node provision-onboarding-telegram-channel.js <target-repo-path> <bot-token> <bot-username> <host-secrets-file-path>
 */
import { getTelegramUpdates, createForumTopic, TelegramPostFn } from '../notify/telegramClient';
import {
  provisionTelegramChannel,
  NEGOTIATION_TOPIC_NAME,
  ChannelProvisioningAdapters,
} from '../onboarding/telegramChannelProvisioning';
import { writeTelegramChannel } from '../onboarding/telegramChannelStore';
import { storeTelegramBotToken } from '../onboarding/telegramChannelSecretStore';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

export interface ProvisionOnboardingTelegramChannelArgs {
  targetRepoPath: string;
  botToken: string;
  botUsername: string;
  hostSecretsFilePath: string;
}

export function parseArgs(argv: string[]): ProvisionOnboardingTelegramChannelArgs | null {
  const [targetRepoPath, botToken, botUsername, hostSecretsFilePath] = argv;
  return targetRepoPath && botToken && botUsername && hostSecretsFilePath
    ? { targetRepoPath, botToken, botUsername, hostSecretsFilePath }
    : null;
}

// BL-380 bounce: this getUpdates line was the actual defect location - it
// discarded the fetch's own success/error and handed provisionTelegramChannel
// only `.updates`, so a bad/revoked token was indistinguishable from "no
// updates yet". Exported (with an injectable postFn, matching this
// codebase's established telegramClient.ts DI pattern - see
// backfillTopicIcons's identical seam) so this exact wiring is covered by an
// in-process test, not only the live network path.
export function buildAdapters(
  targetRepoPath: string,
  botToken: string,
  hostSecretsFilePath: string,
  postFn?: TelegramPostFn
): ChannelProvisioningAdapters {
  return {
    getUpdates: () => getTelegramUpdates(botToken, 0, 0, postFn),
    createNegotiationTopic: (chatId) => createForumTopic(botToken, chatId, NEGOTIATION_TOPIC_NAME, postFn),
    persistChannel: (chatId, negotiationTopicId) => writeTelegramChannel(targetRepoPath, { chatId, negotiationTopicId }),
    persistBotToken: () => storeTelegramBotToken(hostSecretsFilePath, targetRepoPath, botToken),
  };
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node provision-onboarding-telegram-channel.js <target-repo-path> <bot-token> <bot-username> <host-secrets-file-path>\n',
  async ({ targetRepoPath, botToken, botUsername, hostSecretsFilePath }) => {
    const outcome = await provisionTelegramChannel(botUsername, buildAdapters(targetRepoPath, botToken, hostSecretsFilePath));
    printJsonToStdout(outcome);
  }
);

if (require.main === module) {
  runCliMain(main);
}
