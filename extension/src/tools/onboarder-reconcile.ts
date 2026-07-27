#!/usr/bin/env node
/**
 * BL-590: reconciles the standing Onboarding topic and writes a liveness
 * heartbeat, so onboarder_supervisor.bb (the negotiation-relay-
 * supervisor SHAPE the ticket asks for) supervises a real process without
 * opening a SECOND Telegram getUpdates poller on the primary bot's token -
 * the onboarder's actual inbound message handling already runs IN-PROCESS
 * inside the front-desk bot's own single poller (telegramFrontDeskBotCore.ts's
 * attemptOnboardingTopicDelivery), because a second poller on the SAME token
 * would 409-conflict with it (see docs/how-to/BL-439-fes-second-swarm-bringup.md's
 * own "two pollers, one token" warning - the negotiation relay avoids this
 * by using a DEDICATED per-target token, which the Onboarding topic
 * deliberately does not have; it lives in the PRIMARY group). This process
 * only ever calls OUTBOUND Telegram Bot API methods (createForumTopic),
 * which are not subject to that restriction - polling is exclusive,
 * sending is not.
 *
 * Usage:
 *   node onboarder-reconcile.js <targetPath> reconcile-once
 *   node onboarder-reconcile.js <targetPath> poll-loop
 *
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (same as every other notify CLI).
 */
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';
import { TelegramPostFn } from '../notify/telegramClient';
import { ensureOnboardingTopic } from './telegram-front-desk-bot';
import { runCliMain } from './swarm-metrics';

const RECONCILE_INTERVAL_MS = 60_000;

function heartbeatPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'onboarder-heartbeat.json');
}

// onboarder_supervisor.bb reads this SAME {lastHeartbeatMs}
// shape the negotiation relay's own poll-heartbeat.json uses (BL-381) - a
// live pid is not proof the process is still actually completing cycles.
export function writeOnboarderHeartbeat(targetPath: string, now: () => number = Date.now): void {
  atomicWrite(heartbeatPath(targetPath), JSON.stringify({ lastHeartbeatMs: now() }));
}

export async function reconcileOnce(
  targetPath: string,
  botToken: string,
  chatId: string,
  postFn?: TelegramPostFn,
  now: () => number = Date.now
): Promise<number | undefined> {
  const topicId = await ensureOnboardingTopic(targetPath, botToken, chatId, postFn);
  writeOnboarderHeartbeat(targetPath, now);
  return topicId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollLoop(targetPath: string, botToken: string, chatId: string): Promise<void> {
  for (;;) {
    await reconcileOnce(targetPath, botToken, chatId);
    await sleep(RECONCILE_INTERVAL_MS);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`onboarder-reconcile: ${name} is required`);
  }
  return value;
}

async function handleReconcileMode(targetPath: string, botToken: string, chatId: string): Promise<void> {
  const topicId = await reconcileOnce(targetPath, botToken, chatId);
  console.log(JSON.stringify({ ok: topicId !== undefined, topicId }));
  if (topicId === undefined) {
    process.exit(1);
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const [targetPath, mode] = argv;
  if (!targetPath || (mode !== 'reconcile-once' && mode !== 'poll-loop')) {
    console.error('Usage: onboarder-reconcile.js <targetPath> reconcile-once|poll-loop');
    process.exit(1);
    return;
  }
  const botToken = requireEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requireEnv('TELEGRAM_CHAT_ID');
  if (mode === 'poll-loop') {
    await pollLoop(targetPath, botToken, chatId);
    return;
  }
  await handleReconcileMode(targetPath, botToken, chatId);
}

if (require.main === module) {
  runCliMain(() => main());
}
