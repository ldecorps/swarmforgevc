#!/usr/bin/env node
/**
 * BL-281: the Telegram Front Desk Bot - a thin adapter that is a CLIENT of
 * the bridge (bridgeServer.ts), never coupled to the Operator runtime
 * directly ("every hop is mediated by the bridge"). Owns everything
 * Telegram-specific: polling getUpdates, the topic<->SUP-### mapping, and
 * the principal-only inbound filter (BL-239/240's own posture, reused).
 * POSTs an already-resolved {subjectId, channel, text} to the bridge's
 * authed /telegram-inbound route (async - fires and moves on, never
 * RPC), and separately subscribes to the bridge's SSE stream for
 * telegram-reply events, posting each into its mapped topic.
 *
 * All per-update/per-reply DECISIONS live in telegramFrontDeskBotCore.ts
 * (pure/adapter-injected, unit-tested); this file is the thin,
 * untested-boundary process that wires the real network/fs adapters in
 * and runs forever - the same "testable core, thin live wrapper" split
 * launch_operator.sh/operator_runtime.bb already use.
 *
 * Topic/subject CREATION is OUT OF SCOPE for this slice - see
 * telegramFrontDeskBotCore.ts's own docstring.
 *
 * Usage: node telegram-front-desk-bot.js <bridge-url> <target-path>
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   Telegram Bot API credentials
 *   TELEGRAM_PRINCIPAL_USER_ID             the one authorized sender
 *   BRIDGE_TOKEN                            bridge bearer token (read)
 *   BRIDGE_CONTROL_TOKEN                    bridge X-Control-Token (write)
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTelegramUpdates, sendTelegramMessage, TelegramUpdate } from '../notify/telegramClient';
import { nextUpdateOffset } from '../notify/telegramInboundRelay';
import { pollAndForward, PollAdapters, subjectForTopic, topicForSubject } from './telegramFrontDeskBotCore';
import { runCliMain } from './swarm-metrics';

const POLL_TIMEOUT_SECONDS = 25;

function topicMapPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'telegram-topic-map.json');
}

// {topicId: subjectId} - bot-owned, machine-local (gitignored under
// .swarmforge/), never committed. Populated out-of-band for this slice
// (see the "topic/subject creation is out of scope" note above).
function readTopicMap(targetPath: string): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(topicMapPath(targetPath), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set in the environment`);
  }
  return value;
}

async function postToBridge(bridgeUrl: string, controlToken: string, subjectId: string, text: string): Promise<boolean> {
  const res = await fetch(`${bridgeUrl}/telegram-inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${controlToken}`, 'x-control-token': controlToken },
    body: JSON.stringify({ subjectId, channel: 'telegram', text }),
  });
  return res.ok;
}

function buildPollAdapters(botToken: string, targetPath: string, bridgeUrl: string, controlToken: string): PollAdapters {
  return {
    getUpdates: (offset) => getTelegramUpdates(botToken, offset, POLL_TIMEOUT_SECONDS),
    postToBridge: (subjectId, text) => postToBridge(bridgeUrl, controlToken, subjectId, text),
    subjectForTopic: (topicId) => subjectForTopic(readTopicMap(targetPath), topicId),
    nextOffset: nextUpdateOffset,
  };
}

// Polls forever, one batch at a time - each cycle's decision goes through
// pollAndForward (adapter-injected, unit-tested); this loop only owns the
// offset threaded across cycles and never stopping.
async function pollLoop(botToken: string, principalUserId: string, targetPath: string, bridgeUrl: string, controlToken: string): Promise<void> {
  const adapters = buildPollAdapters(botToken, targetPath, bridgeUrl, controlToken);
  let offset = 0;
  for (;;) {
    const result = await pollAndForward(offset, principalUserId, adapters);
    offset = result.nextOffset;
  }
}

// Parses one complete "event: ...\ndata: ...\n\n" SSE record out of an
// accumulated buffer, mirroring holisticUiHtml.ts's own client-side SSE
// parser but extended to read the named `event:` line (that page's own
// stream is unnamed data-only). Returns the record's {event, data} and
// the remaining buffer, or null if no complete record is buffered yet.
export function parseNextSseRecord(buffer: string): { event: string | undefined; data: string; rest: string } | null {
  const boundary = buffer.indexOf('\n\n');
  if (boundary === -1) {
    return null;
  }
  const record = buffer.slice(0, boundary);
  const rest = buffer.slice(boundary + 2);
  const eventLine = record.split('\n').find((l) => l.startsWith('event: '));
  const dataLine = record.split('\n').find((l) => l.startsWith('data: '));
  return { event: eventLine?.slice('event: '.length), data: dataLine?.slice('data: '.length) ?? '', rest };
}

// Subscribes to the bridge's SSE stream forever, relaying every named
// telegram-reply event into its mapped Telegram topic (telegram-topic-03).
// An unmapped threadId (should not happen for a reply to a real dispatch,
// but never throws) is dropped, same "no silent mis-route" posture as the
// poll side.
async function subscribeReplies(botToken: string, chatId: string, targetPath: string, bridgeUrl: string, bridgeToken: string): Promise<void> {
  const res = await fetch(`${bridgeUrl}/events`, { headers: { authorization: `Bearer ${bridgeToken}` } });
  if (!res.body) {
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    let parsed = parseNextSseRecord(buffer);
    while (parsed) {
      buffer = parsed.rest;
      if (parsed.event === 'telegram-reply' && parsed.data) {
        const { threadId, text } = JSON.parse(parsed.data) as { threadId: string; text: string };
        const topicId = topicForSubject(readTopicMap(targetPath), threadId);
        if (topicId !== undefined) {
          await sendTelegramMessage(botToken, chatId, text, undefined, undefined, topicId);
        }
      }
      parsed = parseNextSseRecord(buffer);
    }
  }
}

export async function main(): Promise<void> {
  const [bridgeUrl, targetPath] = process.argv.slice(2);
  if (!bridgeUrl || !targetPath) {
    process.stderr.write('Usage: telegram-front-desk-bot.js <bridge-url> <target-path>\n');
    process.exitCode = 1;
    return;
  }
  const botToken = requiredEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requiredEnv('TELEGRAM_CHAT_ID');
  const principalUserId = requiredEnv('TELEGRAM_PRINCIPAL_USER_ID');
  const bridgeToken = requiredEnv('BRIDGE_TOKEN');
  const controlToken = requiredEnv('BRIDGE_CONTROL_TOKEN');

  await Promise.all([
    pollLoop(botToken, principalUserId, targetPath, bridgeUrl, controlToken),
    subscribeReplies(botToken, chatId, targetPath, bridgeUrl, bridgeToken),
  ]);
}

if (require.main === module) {
  runCliMain(main);
}
