#!/usr/bin/env node
/**
 * BL-353: announces newly dead-lettered handoffs on Telegram, into BL-346's
 * reserved Operator topic - the headless replacement for the retired
 * legacy narrator's "dead-letter" signal (extension/src/notify/
 * telegramNarrator.ts:diffNewDeadLetters). Reuses listDeadLetters/
 * buildRoleInboxes unchanged - the SAME scan the legacy narrator itself
 * used, so this can never disagree with what actually got dead-lettered.
 *
 * Usage: node notify-dead-letters.js
 *
 * Runnable from the repo root or any .worktrees/<role>/ checkout, same
 * project-root resolution as notify-recert-batch.ts. Headless: reads
 * TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID from the process environment (the
 * SAME two the front-desk bot itself uses), never a VS Code secret store.
 */
import * as fs from 'fs';
import * as path from 'path';
import { listDeadLetters, DeadLetterInfo } from '../swarm/inboxChaser';
import { buildRoleInboxes } from '../watchdog/chaserMonitor';
import { decideDeadLetterAnnouncement, buildDeadLetterAnnouncementText } from '../notify/deadLetterNotifier';
import { sendTelegramMessage, SendMessageResult } from '../notify/telegramClient';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';
import { readTopicMap, resolveLiveRoles } from './telegram-front-desk-bot';
import { topicForSubject, OPERATOR_SUBJECT_ID } from './telegramFrontDeskBotCore';
import { atomicWrite } from '../util/atomicWrite';

interface DeadLetterNotifyState {
  announcedFilePaths: string[];
}

function statePath(projectRoot: string): string {
  return path.join(projectRoot, '.swarmforge', 'operator', 'dead-letter-notify-state.json');
}

function readState(projectRoot: string): DeadLetterNotifyState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(projectRoot), 'utf8'));
    return { announcedFilePaths: Array.isArray(raw.announcedFilePaths) ? raw.announcedFilePaths : [] };
  } catch {
    return { announcedFilePaths: [] };
  }
}

function writeState(projectRoot: string, state: DeadLetterNotifyState): void {
  atomicWrite(statePath(projectRoot), JSON.stringify(state));
}

// BL-353 E2E test seam, mirroring notify-recert-batch.ts's own
// TELEGRAM_NOTIFY_FORCE_RESULT convention exactly - no real network call
// ever happens under it.
async function sendAnnouncement(token: string, chatId: string, text: string, topicId: number): Promise<SendMessageResult> {
  const forced = process.env.TELEGRAM_NOTIFY_FORCE_RESULT;
  if (forced) {
    return JSON.parse(forced);
  }
  return sendTelegramMessage(token, chatId, text, undefined, undefined, topicId);
}

export async function main(): Promise<void> {
  const { mainWorktreePath, projectRoot } = resolveCliMainWorktreeContext();
  const rolesList = resolveLiveRoles(mainWorktreePath).map((r) => r.role);
  const deadLetters: DeadLetterInfo[] = listDeadLetters(buildRoleInboxes(mainWorktreePath, rolesList));
  const currentFilePaths = deadLetters.map((dl) => dl.filePath);
  const state = readState(projectRoot);
  const decision = decideDeadLetterAnnouncement(currentFilePaths, state.announcedFilePaths);

  if (!decision.shouldAnnounce) {
    printJsonToStdout({ sent: false, reason: 'no-new-dead-letters' });
    return;
  }

  const topicId = topicForSubject(readTopicMap(projectRoot), OPERATOR_SUBJECT_ID);
  if (topicId === undefined) {
    // Never arm on a missing-topic condition - the NEXT sweep retries once
    // the Operator topic exists (ensureOperatorTopic, BL-346).
    printJsonToStdout({ sent: false, reason: 'operator-topic-not-yet-created' });
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    printJsonToStdout({ sent: false, reason: 'missing-telegram-config' });
    return;
  }

  const previouslyAnnounced = new Set(state.announcedFilePaths);
  const newDeadLetters = deadLetters.filter((dl) => !previouslyAnnounced.has(dl.filePath));
  const text = buildDeadLetterAnnouncementText(newDeadLetters);
  const result = await sendAnnouncement(token, chatId, text, topicId);
  // BL-345's own lesson, reapplied: arm ONLY on confirmed delivery, never
  // on a merely-attempted send.
  if (result.success) {
    writeState(projectRoot, { announcedFilePaths: decision.nextAnnouncedIds });
  }
  printJsonToStdout({ sent: result.success, newCount: newDeadLetters.length, error: result.error });
}

if (require.main === module) {
  runCliMain(main);
}
