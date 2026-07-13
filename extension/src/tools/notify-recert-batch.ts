#!/usr/bin/env node
/**
 * BL-339: announces a waiting recert batch on Telegram, once per batch,
 * with a deep link straight into the PWA's recert work (BL-256's own
 * #ticket=/#approval= scheme, never a second link mechanism). Reuses
 * computeRecertBatch (docs/recertificationStore.ts) unchanged - the SAME
 * data the PWA itself renders, so this can never disagree with what the
 * human actually sees when he follows the link.
 *
 * Usage: node notify-recert-batch.js
 *
 * Runnable from the repo root or any .worktrees/<role>/ checkout, same
 * project-root resolution as suite-duration-line.ts. Headless: reads
 * TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID from the process environment (the
 * SAME two the front-desk bot itself uses), never a VS Code secret store.
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeRecertBatch } from '../docs/recertificationStore';
import { readPwaBaseUrl, buildRecertDeepLink } from '../metrics/pwaDeepLinks';
import { decideRecertAnnouncement, buildRecertAnnouncementText } from '../notify/recertBatchNotifier';
import { sendTelegramMessage, SendMessageResult } from '../notify/telegramClient';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';
import { atomicWrite } from '../util/atomicWrite';

interface RecertNotifyState {
  announcedIds: string[];
}

function statePath(projectRoot: string): string {
  return path.join(projectRoot, '.swarmforge', 'operator', 'recert-notify-state.json');
}

function readState(projectRoot: string): RecertNotifyState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(projectRoot), 'utf8'));
    return { announcedIds: Array.isArray(raw.announcedIds) ? raw.announcedIds : [] };
  } catch {
    return { announcedIds: [] };
  }
}

function writeState(projectRoot: string, state: RecertNotifyState): void {
  atomicWrite(statePath(projectRoot), JSON.stringify(state));
}

// BL-339 E2E test seam: when set, short-circuits the real Telegram send
// entirely and returns this JSON-decoded result instead - lets the
// acceptance suite drive the REAL caller logic (edge-triggered arming,
// delivery-based state per BL-345's own "arm on delivery, never on
// attempt" lesson) against a scripted send outcome without ever reaching
// the network. Mirrors operator_runtime.bb's own OPERATOR_ALARM_FORCE_RESULT.
async function sendAnnouncement(token: string, chatId: string, text: string): Promise<SendMessageResult> {
  const forced = process.env.TELEGRAM_NOTIFY_FORCE_RESULT;
  if (forced) {
    return JSON.parse(forced);
  }
  return sendTelegramMessage(token, chatId, text);
}

export async function main(): Promise<void> {
  const { mainWorktreePath, projectRoot } = resolveCliMainWorktreeContext();
  const batch = computeRecertBatch(mainWorktreePath);
  const batchSize = batch.batch.length;
  const currentIds = batch.batch.map((s) => s.id);
  const state = readState(projectRoot);
  const decision = decideRecertAnnouncement(currentIds, state.announcedIds);

  if (!decision.shouldAnnounce) {
    writeState(projectRoot, { announcedIds: decision.nextAnnouncedIds });
    printJsonToStdout({
      sent: false,
      batchSize,
      reason: batchSize === 0 ? 'no-batch-waiting' : 'already-announced',
    });
    return;
  }

  const deepLink = buildRecertDeepLink(readPwaBaseUrl(projectRoot));
  const text = buildRecertAnnouncementText(batchSize, deepLink);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    // Never arm on a config failure - the NEXT tick retries once
    // TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are actually configured.
    printJsonToStdout({ sent: false, batchSize, reason: 'missing-telegram-config' });
    return;
  }

  const result = await sendAnnouncement(token, chatId, text);
  // BL-345's own lesson, reapplied: arm ONLY on confirmed delivery, never
  // on a merely-attempted send - a failed send must leave the announced-
  // ids state unchanged so the next tick retries, never suppressing the
  // only warning forever behind a discarded result.
  if (result.success) {
    writeState(projectRoot, { announcedIds: decision.nextAnnouncedIds });
  }
  printJsonToStdout({ sent: result.success, batchSize, error: result.error });
}

if (require.main === module) {
  runCliMain(main);
}
