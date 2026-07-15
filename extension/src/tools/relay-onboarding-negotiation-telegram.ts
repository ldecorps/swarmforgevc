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
 *   node relay-onboarding-negotiation-telegram.js <target-repo-path> <host-secrets-file-path> poll-loop
 *
 * Env:
 *   TELEGRAM_PRINCIPAL_USER_ID   the one authorized sender (BL-379 guard) -
 *                                 required for `poll`/`poll-loop`, unused by
 *                                 `post-proposal`.
 *
 * The bot token itself is never taken on argv (it would leak via `ps`) -
 * it is read from the host secrets file BL-380's provisioning step already
 * wrote it into (telegramChannelSecretStore.ts), keyed by target repo path.
 *
 * BL-381 QA bounce (2026-07-15): `poll` alone is a one-shot CLI call - fine
 * for `post-proposal` (BL-380's own provisioning CLI is legitimately
 * one-shot too), but nothing calling `poll` repeatedly means a human's
 * objection/agreement in the negotiation topic is never actually picked up
 * without a human running this command by hand. `poll-loop` is the live
 * trigger: it runs `poll` forever, one getUpdates cycle after another
 * (Telegram's own long-poll already paces it - no extra sleep needed on the
 * happy path), and is the process `swarmforge/scripts/
 * negotiation_relay_supervisor.bb` spawns and supervises with bounded
 * restart, mirroring `front_desk_supervisor.bb`'s own bridge/bot pattern.
 *
 * BL-381 architect bounce (2026-07-15): the supervisor above still had no
 * live caller - `swarmforge/scripts/launch_negotiation_relay.sh` existed
 * but nothing ever ran it, so a human still had to remember a THIRD manual
 * step. A successful `post-proposal` (the moment a human can first reply)
 * now launches it automatically (see runPostProposal/defaultLaunchRelaySupervisor
 * below) - `poll`/`poll-loop` stay reachable directly for manual/recovery use.
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
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
import { runContainedLoop } from './telegramFrontDeskBotCore';
import { atomicWrite } from '../util/atomicWrite';

const POLL_TIMEOUT_SECONDS = 25;
const LOOP_RESTART_DELAY_MS = 5000;

function operatorDir(targetRepoPath: string): string {
  return path.join(targetRepoPath, '.swarmforge', 'operator');
}

function proposalPostedMarkerPath(targetRepoPath: string): string {
  return path.join(operatorDir(targetRepoPath), 'negotiation-topic-posted.json');
}

// BL-381 QA bounce: negotiation_relay_supervisor.bb reads this SAME
// {lastHeartbeatMs} JSON shape - mirroring front-desk-poll-heartbeat.json -
// to tell "the poll-loop process has a pid" apart from "the poll-loop
// process is still actually completing cycles" (front_desk_supervisor_lib's
// own poll-heartbeat-stale? lesson: a live pid is not proof of that).
function pollHeartbeatPath(targetRepoPath: string): string {
  return path.join(operatorDir(targetRepoPath), 'negotiation-relay-poll-heartbeat.json');
}

function writeNegotiationRelayPollHeartbeat(targetRepoPath: string): void {
  atomicWrite(pollHeartbeatPath(targetRepoPath), JSON.stringify({ lastHeartbeatMs: Date.now() }));
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

// BL-381 architect bounce (2026-07-15): launch_negotiation_relay.sh - the
// supervisor that keeps poll-loop alive - existed but nothing in the live
// swarm ever called it, the same "dark feature" gap the QA bounce above
// closed one layer down for `poll` itself. post-proposal is the operator's
// one manual step for a target (idempotent, like BL-380's own provisioning
// CLI); this is the moment a human can first reply in the topic, so it is
// also the natural moment to start listening for that reply - closing the
// loop end to end without adding a SECOND manual step the docs would need
// to keep reminding the operator to run.
//
// child_process.spawn is real, untested-boundary I/O (this codebase's
// established DI shape - mirrors swarmLauncher.ts's own SwarmSpawnFn/
// defaultSwarmSpawn split): an injectable adapter with a real default, so
// runPostProposal's own decision - launch exactly once, only after a REAL
// first post, never on the idempotent no-op or a throw - stays covered by a
// fake in tests, and only the actual spawn call itself is unverified here.
export type LaunchRelaySupervisorFn = (targetRepoPath: string, hostSecretsFilePath: string) => void;

// Exported so a test can lock the "3 levels up from extension/out/tools"
// path math (an easy off-by-one) against the REAL file on disk, without
// needing to trigger an actual spawn.
export function launchNegotiationRelayScriptPath(): string {
  const repoRoot = path.join(__dirname, '..', '..', '..');
  return path.join(repoRoot, 'swarmforge', 'scripts', 'launch_negotiation_relay.sh');
}

// Mirrors daemon_alarm_lib.bb's own test-fixture-root? exactly (same
// rationale, applied to a real detached process spawn instead of a real
// email send): a target repo path that resolves under the system temp
// directory is, by construction, a throwaway test/acceptance fixture, never
// a real onboarded target - so this is the safety net for a test author who
// forgets to inject a fake launchRelaySupervisor (as this file's own tests
// did until this defect surfaced live: a fixture-only bug leaked several
// real bounded-restart-forever supervisor processes polling the real
// Telegram API with a fake token during this ticket's own acceptance runs).
// Never throws on an unresolvable/relative path.
// Exported so a test can drive tryRealpath's ENOENT fallback directly - the
// only path defaultLaunchRelaySupervisor's own tests (which always pass an
// already-created target dir) can never reach.
export function isTestFixtureRoot(targetRepoPath: string): boolean {
  const tmpDir = process.env.TMPDIR || os.tmpdir();
  const canonicalTmp = tryRealpath(tmpDir);
  const canonicalRoot = tryRealpath(targetRepoPath);
  return canonicalRoot.startsWith(canonicalTmp);
}

function tryRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

// The launcher's own idempotent pid-alive guard (launch_negotiation_relay.sh)
// makes a redundant call here harmless - never double-supervises a target.
// Output is captured to a log rather than 'ignore' so a launch failure
// (missing compiled entrypoint, missing TELEGRAM_PRINCIPAL_USER_ID in this
// process's own env) is diagnosable instead of silently lost - the same
// posture launch_negotiation_relay.sh already gives its OWN supervisor
// child via `>> "$LOG" 2>&1`.
const defaultLaunchRelaySupervisor: LaunchRelaySupervisorFn = (targetRepoPath, hostSecretsFilePath) => {
  if (isTestFixtureRoot(targetRepoPath)) {
    return;
  }
  fs.mkdirSync(operatorDir(targetRepoPath), { recursive: true });
  const logFd = fs.openSync(path.join(operatorDir(targetRepoPath), 'negotiation-relay-auto-launch.log'), 'a');
  try {
    cp.spawn('bash', [launchNegotiationRelayScriptPath(), targetRepoPath, hostSecretsFilePath], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
    }).unref();
  } finally {
    fs.closeSync(logFd);
  }
};

// BL-381 scenario 01. Idempotent like BL-380's own provisioning step: a
// second call after a successful post is a no-op (posted: false), never a
// duplicate announcement in the topic - and never a second supervisor
// launch attempt either, since the launch only fires on a REAL first post.
export async function runPostProposal(
  targetRepoPath: string,
  hostSecretsFilePath: string,
  postFn?: TelegramPostFn,
  launchRelaySupervisor: LaunchRelaySupervisorFn = defaultLaunchRelaySupervisor
): Promise<PostProposalOutcome> {
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
  launchRelaySupervisor(targetRepoPath, hostSecretsFilePath);
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

// BL-381 QA bounce: the live trigger for `poll` - runs it forever, one
// getUpdates cycle after another. Telegram's own long-poll (POLL_TIMEOUT_SECONDS)
// already paces the happy path; a thrown failure (e.g. a network error) is
// left to propagate out of the loop entirely, same as runPoll's own
// "surface, never swallow" contract - the CALLER (main(), via
// runContainedLoop) owns restart-with-delay, mirroring telegram-front-desk-
// bot.ts's own pollLoop/runContainedLoop split. Thin by design: the one
// real per-cycle decision this file owns (runPoll) is already covered by
// its own tests above; this loop shell has no branching of its own to test,
// matching this codebase's established pollLoop/tickLoop convention.
export async function pollLoop(targetRepoPath: string, hostSecretsFilePath: string, principalUserId: string, postFn?: TelegramPostFn): Promise<never> {
  for (;;) {
    await runPoll(targetRepoPath, hostSecretsFilePath, principalUserId, postFn);
    writeNegotiationRelayPollHeartbeat(targetRepoPath);
  }
}

export type ParsedArgs =
  | { targetRepoPath: string; hostSecretsFilePath: string; action: 'post-proposal' }
  | { targetRepoPath: string; hostSecretsFilePath: string; action: 'poll'; principalUserId: string }
  | { targetRepoPath: string; hostSecretsFilePath: string; action: 'poll-loop'; principalUserId: string };

function parsePollArgs(
  targetRepoPath: string,
  hostSecretsFilePath: string,
  action: 'poll' | 'poll-loop'
): ParsedArgs | null {
  const principalUserId = process.env.TELEGRAM_PRINCIPAL_USER_ID;
  if (!principalUserId) return null;
  return { targetRepoPath, hostSecretsFilePath, action, principalUserId };
}

// Dispatch table rather than a growing if-chain: BL-381's own prior cleaner
// pass already extracted parsePollArgs once to hold CRAP <= 6, and adding
// this QA-bounce fix's third action (poll-loop) as a fourth sequential `if`
// pushed the same function back over threshold. A table entry per action
// keeps parseArgs's own complexity flat as actions are added.
const ACTION_BUILDERS: Record<string, (targetRepoPath: string, hostSecretsFilePath: string) => ParsedArgs | null> = {
  'post-proposal': (targetRepoPath, hostSecretsFilePath) => ({ targetRepoPath, hostSecretsFilePath, action: 'post-proposal' }),
  poll: (targetRepoPath, hostSecretsFilePath) => parsePollArgs(targetRepoPath, hostSecretsFilePath, 'poll'),
  'poll-loop': (targetRepoPath, hostSecretsFilePath) => parsePollArgs(targetRepoPath, hostSecretsFilePath, 'poll-loop'),
};

export function parseArgs(argv: string[]): ParsedArgs | null {
  const [targetRepoPath, hostSecretsFilePath, action] = argv;
  if (!targetRepoPath || !hostSecretsFilePath || !action) return null;
  const build = ACTION_BUILDERS[action];
  return build ? build(targetRepoPath, hostSecretsFilePath) : null;
}

function logPollLoopFault(name: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`relay-onboarding-negotiation-telegram: ${name} loop faulted (restarting): ${message}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node relay-onboarding-negotiation-telegram.js <target-repo-path> <host-secrets-file-path> post-proposal\n' +
    '       node relay-onboarding-negotiation-telegram.js <target-repo-path> <host-secrets-file-path> poll        (TELEGRAM_PRINCIPAL_USER_ID env required)\n' +
    '       node relay-onboarding-negotiation-telegram.js <target-repo-path> <host-secrets-file-path> poll-loop   (TELEGRAM_PRINCIPAL_USER_ID env required; runs forever)\n',
  async (args) => {
    if (args.action === 'poll-loop') {
      await runContainedLoop(
        'negotiation-relay-poll',
        () => pollLoop(args.targetRepoPath, args.hostSecretsFilePath, args.principalUserId),
        sleep,
        LOOP_RESTART_DELAY_MS,
        logPollLoopFault
      );
      return;
    }
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
