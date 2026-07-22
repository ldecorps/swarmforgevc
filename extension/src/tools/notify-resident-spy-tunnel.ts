#!/usr/bin/env node
/**
 * Post/edit the Resident Spy Mini App URL in the standing Telegram topic when it changes.
 *
 * Usage:
 *   node notify-resident-spy-tunnel.js --url "https://....trycloudflare.com/resident-spy?token=..." [--project-root PATH]
 *
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (same as launch_front_desk.sh).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  RESIDENT_SPY_SUBJECT_ID,
  RESIDENT_SPY_TOPIC_NAME,
  decideEnsureResidentSpyTopicAction,
  topicForSubject,
} from './telegramFrontDeskBotCore';
import { createForumTopic, editMessageText, sendTelegramMessage } from '../notify/telegramClient';
import {
  ResidentSpyTunnelNotifyState,
  syncResidentSpyTunnelUrl,
} from '../concierge/residentSpyTunnelNotify';
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

function notifyStatePath(projectRoot: string): string {
  return path.join(projectRoot, '.swarmforge', 'operator', 'resident-spy-tunnel-notify.json');
}

function readNotifyState(projectRoot: string): ResidentSpyTunnelNotifyState | undefined {
  const p = notifyStatePath(projectRoot);
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ResidentSpyTunnelNotifyState;
  } catch {
    return undefined;
  }
}

function writeNotifyState(projectRoot: string, state: ResidentSpyTunnelNotifyState): void {
  fs.mkdirSync(path.dirname(notifyStatePath(projectRoot)), { recursive: true });
  fs.writeFileSync(notifyStatePath(projectRoot), JSON.stringify(state, null, 2) + '\n');
}

function resolveRoot(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project-root') return argv[i + 1] || process.cwd();
  }
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, '.swarmforge'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export async function ensureResidentSpyTopicStandalone(
  projectRoot: string,
  botToken: string,
  chatId: string,
): Promise<number | undefined> {
  const topicMap = readTopicMap(projectRoot);
  const decision = decideEnsureResidentSpyTopicAction(topicMap);
  if (decision.kind === 'reuse') return decision.topicId;
  const created = await createForumTopic(botToken, chatId, RESIDENT_SPY_TOPIC_NAME);
  if (!created.success || created.messageThreadId === undefined) {
    return undefined;
  }
  topicMap[topicMapKey(created.messageThreadId)] = RESIDENT_SPY_SUBJECT_ID;
  writeTopicMap(projectRoot, topicMap);
  return created.messageThreadId;
}

export async function notifyResidentSpyTunnelUrl(
  projectRoot: string,
  fullUrl: string,
): Promise<{ notified: boolean; outcome: string; topicId?: number; reason?: string; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { notified: false, outcome: 'skipped', reason: 'missing-telegram-config' };
  }
  const prevState = readNotifyState(projectRoot);
  const result = await syncResidentSpyTunnelUrl(fullUrl, prevState, {
    ensureTopic: () => ensureResidentSpyTopicStandalone(projectRoot, token, chatId),
    postMessage: async (topicId, text) => {
      const sent = await sendTelegramMessage(token, chatId, text, undefined, undefined, topicId);
      return sent.success ? sent.messageId : undefined;
    },
    editMessage: async (topicId, messageId, text) => {
      const edited = await editMessageText(token, chatId, messageId, text);
      return edited.success;
    },
  });
  writeNotifyState(projectRoot, result.state);
  const notified = result.outcome === 'posted' || result.outcome === 'edited';
  return {
    notified,
    outcome: result.outcome,
    topicId: result.state.topicId ?? topicForSubject(readTopicMap(projectRoot), RESIDENT_SPY_SUBJECT_ID),
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const root = resolveRoot(argv);
  const urlIdx = argv.indexOf('--url');
  if (urlIdx < 0 || !argv[urlIdx + 1]) {
    console.error('notify-resident-spy-tunnel: --url is required');
    process.exit(1);
  }
  const fullUrl = argv[urlIdx + 1];
  const result = await notifyResidentSpyTunnelUrl(root, fullUrl);
  console.log(JSON.stringify(result));
  if (result.outcome.startsWith('failed')) process.exit(1);
}

if (require.main === module) {
  runCliMain(() => main());
}
