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
import * as fs from 'fs';
import * as path from 'path';
import { getTelegramUpdates, createForumTopic, TelegramPostFn } from '../notify/telegramClient';
import {
  provisionTelegramChannel,
  NEGOTIATION_TOPIC_NAME,
  ChannelProvisioningAdapters,
} from '../onboarding/telegramChannelProvisioning';
import { writeTelegramChannel } from '../onboarding/telegramChannelStore';
import { storeTelegramBotToken } from '../onboarding/telegramChannelSecretStore';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';
import { atomicWrite } from '../util/atomicWrite';

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

function operatorDir(targetRepoPath: string): string {
  return path.join(targetRepoPath, '.swarmforge', 'operator');
}

function provisioningOffsetPath(targetRepoPath: string): string {
  return path.join(operatorDir(targetRepoPath), 'telegram-provisioning-offset.json');
}

// BL-444: the one piece of state THIS CLI owns across separate invocations -
// mirrors relay-onboarding-negotiation-telegram.ts's own readRelayOffset/
// writeRelayOffset convention exactly. Before this ticket getUpdates was
// called with a hardcoded offset of 0 on every run, so the stale
// pre-migration updates that caused the very first failure never left the
// queue and poisoned every re-run identically.
export function readProvisioningOffset(targetRepoPath: string): number {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(provisioningOffsetPath(targetRepoPath), 'utf8'));
    const offset = (parsed as Record<string, unknown>).offset;
    return typeof offset === 'number' ? offset : 0;
  } catch {
    return 0;
  }
}

export function writeProvisioningOffset(targetRepoPath: string, offset: number): void {
  atomicWrite(provisioningOffsetPath(targetRepoPath), JSON.stringify({ offset }));
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
    getUpdates: () => getTelegramUpdates(botToken, readProvisioningOffset(targetRepoPath), 0, postFn),
    createNegotiationTopic: async (chatId) => {
      const result = await createForumTopic(botToken, chatId, NEGOTIATION_TOPIC_NAME, postFn);
      return {
        success: result.success,
        messageThreadId: result.messageThreadId,
        error: result.error,
        migrateToChatId: result.migrateToChatId !== undefined ? String(result.migrateToChatId) : undefined,
      };
    },
    persistChannel: (chatId, negotiationTopicId) => writeTelegramChannel(targetRepoPath, { chatId, negotiationTopicId }),
    persistBotToken: () => storeTelegramBotToken(hostSecretsFilePath, targetRepoPath, botToken),
    persistConfirmOffset: (offset) => writeProvisioningOffset(targetRepoPath, offset),
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
