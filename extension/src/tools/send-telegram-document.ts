#!/usr/bin/env node
/**
 * BL-1509: headless CLI that posts any file to the standing Concierge
 * Telegram topic - the same topic-resolution pattern notify-dead-letters.ts
 * uses (topicForSubject over the topic map with OPERATOR_SUBJECT_ID), built
 * on telegramClient.ts's new sendDocument (the generic sibling of
 * sendVoiceNote's multipart upload).
 *
 * Usage: node send-telegram-document.js <project-root> <file> [--caption <text>]
 *
 * Reads TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID from the process environment
 * (the same two the front desk bot itself uses), honours
 * TELEGRAM_NOTIFY_FORCE_RESULT for the no-network test path (same
 * convention as notify-dead-letters.ts's own sendAnnouncement seam).
 * Exits non-zero (with a JSON reason on stdout) when the Concierge topic
 * does not exist yet, Telegram config is missing, or the send itself
 * fails - 0 only on a confirmed delivery.
 */
import * as fs from 'fs';
import * as path from 'path';
import { sendDocument, SendDocumentResult } from '../notify/telegramClient';
import { printJsonToStdout, runCliMain, makeArgsGuardedMain } from './swarm-metrics';
import { readTopicMap } from './telegram-front-desk-bot';
import { topicForSubject, OPERATOR_SUBJECT_ID } from './telegramFrontDeskBotCore';

export interface SendTelegramDocumentArgs {
  projectRoot: string;
  file: string;
  caption?: string;
}

const USAGE = 'Usage: send-telegram-document.js <project-root> <file> [--caption <text>]\n';

// Pure - no process.argv access here, same "keep main() a thin dispatcher
// over a testable pure helper" split recruiter-run.ts's own hardener pass
// established. --caption may appear anywhere after the two positionals;
// everything else is positional (project-root, file, in that order).
export function parseArgs(argv: string[]): SendTelegramDocumentArgs | null {
  const captionIndex = argv.indexOf('--caption');
  const caption = captionIndex >= 0 ? argv[captionIndex + 1] : undefined;
  if (captionIndex >= 0 && caption === undefined) {
    return null;
  }
  const positional = captionIndex >= 0 ? [...argv.slice(0, captionIndex), ...argv.slice(captionIndex + 2)] : argv;
  const [projectRoot, file] = positional;
  if (!projectRoot || !file) {
    return null;
  }
  return caption !== undefined ? { projectRoot, file, caption } : { projectRoot, file };
}

export interface SendTelegramDocumentOutcome {
  success: boolean;
  reason?: string;
}

// BL-353's own convention, reused: TELEGRAM_NOTIFY_FORCE_RESULT lets a test
// drive the whole CLI in-process with no network call, the same injected
// "send function" scenario 03 asks for - a forced result bypasses
// sendDocument (and therefore any real fetch) entirely.
async function sendAnnouncement(
  token: string,
  chatId: string,
  fileBytes: Buffer,
  filename: string,
  topicId: number,
  caption: string | undefined
): Promise<SendDocumentResult> {
  const forced = process.env.TELEGRAM_NOTIFY_FORCE_RESULT;
  if (forced) {
    return JSON.parse(forced);
  }
  return sendDocument(token, chatId, fileBytes, filename, topicId, caption);
}

// The exported, in-process-testable core: resolves the Concierge topic,
// reads the file and the front desk's own env credentials, and posts it.
// Never throws on a missing topic/config - each is a named outcome reason,
// exactly like notify-dead-letters.ts's own sendOperatorTopicMessage.
export async function sendTelegramDocumentCore(
  projectRoot: string,
  filePath: string,
  caption: string | undefined
): Promise<SendTelegramDocumentOutcome> {
  const topicId = topicForSubject(readTopicMap(projectRoot), OPERATOR_SUBJECT_ID);
  if (topicId === undefined) {
    return { success: false, reason: 'operator-topic-not-yet-created' };
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { success: false, reason: 'missing-telegram-config' };
  }
  const fileBytes = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  const result = await sendAnnouncement(token, chatId, fileBytes, filename, topicId, caption);
  return result.success ? { success: true } : { success: false, reason: result.error };
}

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const outcome = await sendTelegramDocumentCore(args.projectRoot, args.file, args.caption);
  printJsonToStdout(outcome);
  if (!outcome.success) {
    process.exitCode = 1;
  }
});

if (require.main === module) {
  runCliMain(main);
}
