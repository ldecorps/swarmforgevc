#!/usr/bin/env node
/**
 * BL-381: the wiring ticket - joins BL-344's negotiation rounds
 * (negotiate-onboarding-contract.ts's own runObject/runApprove, the ONE real
 * writer of negotiation state, never a second engine) to BL-380's
 * provisioned Telegram channel (telegramChannelStore.ts's persisted
 * chatId/negotiationTopicId), so the contract can be argued out on the
 * phone instead of only over files/CLI. All per-update DECISIONS live in
 * onboarding/negotiationTelegramRouting.ts and
 * onboarding/negotiationTelegramRelay.ts (pure/adapter-injected, unit
 * tested); this file is the thin, untested-boundary process that wires the
 * real Telegram network calls and the real negotiation CLI functions in.
 *
 * Usage:
 *   node relay-onboarding-negotiation-telegram.js <target-repo-path> <host-secrets-file-path> post-proposal
 *   node relay-onboarding-negotiation-telegram.js <target-repo-path> <host-secrets-file-path> poll
 *
 * Env:
 *   TELEGRAM_PRINCIPAL_USER_ID   the one authorized sender (BL-379 guard) -
 *                                 required for `poll`, unused by `post-proposal`.
 *
 * The bot token itself is never taken on argv (it would leak via `ps`) -
 * it is read from the host secrets file BL-380's provisioning step already
 * wrote it into (telegramChannelSecretStore.ts), keyed by target repo path.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTelegramUpdates, sendTelegramMessage, TelegramPostFn } from '../notify/telegramClient';
import { readTelegramChannel } from '../onboarding/telegramChannelStore';
import { readTelegramBotToken } from '../onboarding/telegramChannelSecretStore';
import { parseContractYaml } from '../onboarding/contractView';
import { ProposedContract } from '../onboarding/contractTypes';
import { formatContractForTelegram } from '../onboarding/negotiationTelegramRouting';
import { NegotiationRelayAdapters, relayNegotiationUpdates, NegotiationRelayResult } from '../onboarding/negotiationTelegramRelay';
import { runObject, runApprove } from './negotiate-onboarding-contract';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

const POLL_TIMEOUT_SECONDS = 25;

function operatorDir(targetRepoPath: string): string {
  return path.join(targetRepoPath, '.swarmforge', 'operator');
}

function proposalPostedMarkerPath(targetRepoPath: string): string {
  return path.join(operatorDir(targetRepoPath), 'negotiation-topic-posted.json');
}

function relayOffsetPath(targetRepoPath: string): string {
  return path.join(operatorDir(targetRepoPath), 'negotiation-relay-offset.json');
}

function contractYamlPath(targetRepoPath: string): string {
  return path.join(targetRepoPath, '.swarmforge', 'contract.yaml');
}

// BL-381 scenario 03: the poll cursor is the one piece of state THIS file
// owns (the negotiation round state itself already survives a restart via
// contract.yaml + the round log, per negotiate-onboarding-contract.ts) -
// persisted so a restarted relay never re-applies an already-handled
// objection as a second, duplicate round.
export function readRelayOffset(targetRepoPath: string): number {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(relayOffsetPath(targetRepoPath), 'utf8'));
    const offset = (parsed as Record<string, unknown>).offset;
    return typeof offset === 'number' ? offset : 0;
  } catch {
    return 0;
  }
}

export function writeRelayOffset(targetRepoPath: string, offset: number): void {
  fs.mkdirSync(operatorDir(targetRepoPath), { recursive: true });
  fs.writeFileSync(relayOffsetPath(targetRepoPath), JSON.stringify({ offset }));
}

function requireBotToken(targetRepoPath: string, hostSecretsFilePath: string): string {
  const botToken = readTelegramBotToken(hostSecretsFilePath, targetRepoPath);
  if (!botToken) {
    throw new Error(`no Telegram bot token found for ${targetRepoPath} in ${hostSecretsFilePath} - run provision-onboarding-telegram-channel first`);
  }
  return botToken;
}

function requireChannel(targetRepoPath: string): { chatId: string; negotiationTopicId: number } {
  const channel = readTelegramChannel(targetRepoPath);
  if (!channel) {
    throw new Error(`no provisioned Telegram channel found for ${targetRepoPath} - run provision-onboarding-telegram-channel first`);
  }
  return channel;
}

function isAlreadyEndedError(err: unknown): boolean {
  return err instanceof Error && /already ended/.test(err.message);
}

// BL-381: wraps negotiate-onboarding-contract.ts's own runObject/runApprove
// as this relay's NegotiationRelayAdapters - the "REAL writer" the ticket's
// own notes insist on, never a second negotiation engine. The "already
// ended" throw those functions raise for a stale/replayed update is caught
// here and translated to the adapter's own terminal outcome (see
// negotiationTelegramRelay.ts's own ObjectToContractResult/ApproveContractResult
// doc) rather than propagating as an exception that would abort the whole
// poll cycle.
export function buildRelayAdapters(
  targetRepoPath: string,
  botToken: string,
  chatId: string,
  negotiationTopicId: number,
  postFn?: TelegramPostFn
): NegotiationRelayAdapters {
  return {
    objectToContract: async (text) => {
      try {
        const result = await runObject(targetRepoPath, text);
        if (result.ended) {
          return { outcome: 'round-limit' };
        }
        return { outcome: 'revised', contract: result.contract as ProposedContract };
      } catch (err) {
        if (isAlreadyEndedError(err)) {
          return { outcome: 'already-ended' };
        }
        throw err;
      }
    },
    approveContract: async () => {
      try {
        const result = await runApprove(targetRepoPath);
        return { outcome: 'agreed', contract: result.contract as ProposedContract };
      } catch (err) {
        if (isAlreadyEndedError(err)) {
          return { outcome: 'already-ended' };
        }
        throw err;
      }
    },
    postToTopic: async (text) => {
      const result = await sendTelegramMessage(botToken, chatId, text, undefined, postFn, negotiationTopicId);
      if (!result.success) {
        // BL-381: the negotiation state (contract.yaml + the round log) is
        // already durably written by the time this send is attempted - a
        // delivery failure here only delays the human SEEING the revision,
        // it can never corrupt or lose the state itself. So this logs and
        // moves on rather than throwing, which would otherwise block the
        // poll offset from advancing and cause the NEXT poll to re-run
        // objectToContract on the SAME objection text, appending a
        // duplicate round.
        process.stderr.write(`relay-onboarding-negotiation-telegram: failed to post to the negotiation topic: ${result.error}\n`);
      }
    },
  };
}

export interface PostProposalOutcome {
  posted: boolean;
}

// BL-381 scenario 01. Idempotent like BL-380's own provisioning step: a
// second call after a successful post is a no-op (posted: false), never a
// duplicate announcement in the topic.
export async function runPostProposal(targetRepoPath: string, hostSecretsFilePath: string, postFn?: TelegramPostFn): Promise<PostProposalOutcome> {
  const channel = requireChannel(targetRepoPath);
  if (fs.existsSync(proposalPostedMarkerPath(targetRepoPath))) {
    return { posted: false };
  }
  const botToken = requireBotToken(targetRepoPath, hostSecretsFilePath);
  const rawContract = fs.readFileSync(contractYamlPath(targetRepoPath), 'utf8');
  const contract = parseContractYaml(rawContract);
  if (!contract) {
    throw new Error(`${contractYamlPath(targetRepoPath)} is missing or malformed - cannot post a contract that was never proposed`);
  }
  const result = await sendTelegramMessage(botToken, channel.chatId, formatContractForTelegram(contract), undefined, postFn, channel.negotiationTopicId);
  if (!result.success) {
    throw new Error(`failed to post the proposed contract to the negotiation topic: ${result.error}`);
  }
  fs.mkdirSync(operatorDir(targetRepoPath), { recursive: true });
  fs.writeFileSync(proposalPostedMarkerPath(targetRepoPath), JSON.stringify({ posted: true }));
  return { posted: true };
}

// BL-381 scenarios 02/04: one getUpdates + route + persist-offset cycle.
// Each invocation is its own process reading the offset fresh off disk
// (readRelayOffset), which is what makes the SEQUENCE of separate `poll`
// invocations a real test of scenario 03 (restart survival), not just a
// claim about it - the same posture negotiate-onboarding-contract.ts's own
// per-invocation readNegotiationState already established for the round
// state itself.
export async function runPoll(targetRepoPath: string, hostSecretsFilePath: string, principalUserId: string, postFn?: TelegramPostFn): Promise<NegotiationRelayResult> {
  const channel = requireChannel(targetRepoPath);
  const botToken = requireBotToken(targetRepoPath, hostSecretsFilePath);
  const offset = readRelayOffset(targetRepoPath);
  const updatesResult = await getTelegramUpdates(botToken, offset, POLL_TIMEOUT_SECONDS, postFn);
  if (!updatesResult.success) {
    throw new Error(`failed to fetch Telegram updates: ${updatesResult.error}`);
  }
  const adapters = buildRelayAdapters(targetRepoPath, botToken, channel.chatId, channel.negotiationTopicId, postFn);
  const result = await relayNegotiationUpdates(updatesResult.updates, offset, principalUserId, channel.chatId, channel.negotiationTopicId, adapters);
  writeRelayOffset(targetRepoPath, result.nextOffset);
  return result;
}

export type ParsedArgs =
  | { targetRepoPath: string; hostSecretsFilePath: string; action: 'post-proposal' }
  | { targetRepoPath: string; hostSecretsFilePath: string; action: 'poll'; principalUserId: string };

function parsePollArgs(targetRepoPath: string, hostSecretsFilePath: string): ParsedArgs | null {
  const principalUserId = process.env.TELEGRAM_PRINCIPAL_USER_ID;
  if (!principalUserId) return null;
  return { targetRepoPath, hostSecretsFilePath, action: 'poll', principalUserId };
}

export function parseArgs(argv: string[]): ParsedArgs | null {
  const [targetRepoPath, hostSecretsFilePath, action] = argv;
  if (!targetRepoPath || !hostSecretsFilePath || !action) return null;
  if (action === 'post-proposal') {
    return { targetRepoPath, hostSecretsFilePath, action };
  }
  if (action === 'poll') {
    return parsePollArgs(targetRepoPath, hostSecretsFilePath);
  }
  return null;
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node relay-onboarding-negotiation-telegram.js <target-repo-path> <host-secrets-file-path> post-proposal\n' +
    '       node relay-onboarding-negotiation-telegram.js <target-repo-path> <host-secrets-file-path> poll   (TELEGRAM_PRINCIPAL_USER_ID env required)\n',
  async (args) => {
    const result =
      args.action === 'post-proposal'
        ? await runPostProposal(args.targetRepoPath, args.hostSecretsFilePath)
        : await runPoll(args.targetRepoPath, args.hostSecretsFilePath, args.principalUserId);
    printJsonToStdout(result);
  }
);

if (require.main === module) {
  runCliMain(main);
}
