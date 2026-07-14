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
import { getTelegramUpdates, createForumTopic } from '../notify/telegramClient';
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

function buildAdapters(
  targetRepoPath: string,
  botToken: string,
  hostSecretsFilePath: string
): ChannelProvisioningAdapters {
  return {
    getUpdates: async () => (await getTelegramUpdates(botToken, 0, 0)).updates,
    createNegotiationTopic: (chatId) => createForumTopic(botToken, chatId, NEGOTIATION_TOPIC_NAME),
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
