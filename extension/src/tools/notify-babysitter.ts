#!/usr/bin/env node
/**
 * Ensure the standing Babysitter Telegram topic and/or post a message to it.
 *
 * Usage:
 *   node ensure-babysitter-topic.js [--project-root PATH]
 *   node notify-babysitter.js --text "..." [--project-root PATH]
 *
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (same as other notify CLIs).
 * TELEGRAM_NOTIFY_FORCE_RESULT=ok|fail for tests (no network).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  BABYSITTER_SUBJECT_ID,
  decideEnsureBabysitterTopicAction,
  topicForSubject,
} from './telegramFrontDeskBotCore';
import { createForumTopic, sendTelegramMessage } from '../notify/telegramClient';
import { runCliMain } from './swarm-metrics';

function readTopicMap(projectRoot: string): Record<string, string> {
  const p = path.join(projectRoot, '.swarmforge', 'operator', 'telegram-topic-map.json');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeTopicMap(projectRoot: string, map: Record<string, string>): void {
  const dir = path.join(projectRoot, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'telegram-topic-map.json'), JSON.stringify(map, null, 0) + '\n');
}

function topicMapKey(id: number): string {
  return String(id);
}

function resolveRoot(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project-root') return argv[i + 1] || process.cwd();
  }
  // walk up from cwd looking for .swarmforge
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, '.swarmforge'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export async function ensureBabysitterTopicStandalone(
  projectRoot: string,
  botToken: string,
  chatId: string,
): Promise<number | undefined> {
  const topicMap = readTopicMap(projectRoot);
  const decision = decideEnsureBabysitterTopicAction(topicMap);
  if (decision.kind === 'reuse') return decision.topicId;
  const created = await createForumTopic(botToken, chatId, 'Babysitter');
  if (!created.success || created.messageThreadId === undefined) {
    return undefined;
  }
  topicMap[topicMapKey(created.messageThreadId)] = BABYSITTER_SUBJECT_ID;
  writeTopicMap(projectRoot, topicMap);
  return created.messageThreadId;
}

export async function notifyBabysitter(
  projectRoot: string,
  text: string,
): Promise<{ sent: boolean; topicId?: number; reason?: string; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { sent: false, reason: 'missing-telegram-config' };
  }
  let topicId = topicForSubject(readTopicMap(projectRoot), BABYSITTER_SUBJECT_ID);
  if (topicId === undefined) {
    topicId = await ensureBabysitterTopicStandalone(projectRoot, token, chatId);
  }
  if (topicId === undefined) {
    return { sent: false, reason: 'babysitter-topic-not-yet-created' };
  }
  const forced = process.env.TELEGRAM_NOTIFY_FORCE_RESULT;
  if (forced === 'ok') return { sent: true, topicId };
  if (forced === 'fail') return { sent: false, topicId, error: 'forced-fail' };
  const result = await sendTelegramMessage(token, chatId, text, undefined, undefined, topicId);
  return { sent: result.success, topicId, error: result.error };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const root = resolveRoot(argv);
  const textIdx = argv.indexOf('--text');
  if (textIdx >= 0) {
    const text = argv[textIdx + 1];
    if (!text) {
      console.error('notify-babysitter: --text requires a value');
      process.exit(1);
    }
    const result = await notifyBabysitter(root, text);
    console.log(JSON.stringify(result));
    if (!result.sent) process.exit(1);
    return;
  }
  // ensure-only mode
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log(JSON.stringify({ ok: false, reason: 'missing-telegram-config' }));
    process.exit(1);
  }
  const topicId = await ensureBabysitterTopicStandalone(root, token, chatId);
  console.log(JSON.stringify({ ok: topicId !== undefined, topicId, subject: BABYSITTER_SUBJECT_ID }));
  if (topicId === undefined) process.exit(1);
}

if (require.main === module) {
  runCliMain(() => main());
}
