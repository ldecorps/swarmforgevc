#!/usr/bin/env node
/**
 * Telegram ↔ Cursor SDK remote control for the local repo.
 *
 * Polls Telegram for principal messages in the standing "Cursor Remote"
 * forum topic, forwards them to a durable local Cursor agent (Agent.create /
 * Agent.resume + send), and posts replies back. Pure decisions live in
 * telegramCursorBridgeCore.ts; this file is the thin live wrapper.
 *
 * Usage: node telegram-cursor-bridge.js <repo-root>
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_PRINCIPAL_USER_ID
 *   CURSOR_API_KEY                         Cursor SDK credential
 *   CURSOR_BRIDGE_MODEL                    optional, default composer-2.5
 */
import * as fs from 'fs';
import * as path from 'path';
import { CursorAgentError } from '@cursor/sdk';
import { atomicWrite } from '../util/atomicWrite';
import { createLiveCursorBridgeAgentSession } from '../bridge/cursorBridgeAgentSession';
import {
  createForumTopicWithRateLimitRetry,
  getTelegramUpdates,
  sendTelegramMessageWithRateLimitRetry,
  TelegramUpdate,
} from '../notify/telegramClient';
import { nextUpdateOffset } from './telegramTopicDecisions';
import {
  CURSOR_BRIDGE_TOPIC_NAME,
  AGENT_RUN_HEARTBEAT_INTERVAL_MS,
  decideEnsureCursorTopicAction,
  decideInboundAction,
  decidePollBackoffMs,
  formatHelpMessage,
  formatStatusMessage,
  gateBusy,
  isActiveRunConflict,
  parseCursorBridgeState,
  splitTelegramChunks,
  type CursorBridgePersistedState,
} from './telegramCursorBridgeCore';

const POLL_TIMEOUT_SECONDS = 30;
const STATE_FILE_NAME = 'cursor-bridge-state.json';
const TOPIC_MAP_FILE_NAME = 'cursor-bridge-topic-map.json';
const HEARTBEAT_FILE_NAME = 'cursor-bridge-heartbeat.json';

function writePollHeartbeat(opDir: string): void {
  atomicWrite(path.join(opDir, HEARTBEAT_FILE_NAME), JSON.stringify({ lastHeartbeatMs: Date.now() }));
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function loadJsonFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function loadTopicMap(filePath: string): Record<string, string> {
  const raw = loadJsonFile(filePath);
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  return raw as Record<string, string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inboundEventOf(update: TelegramUpdate) {
  const message = update.message;
  if (!message?.text || message.from?.id === undefined || message.chat?.id === undefined) {
    return undefined;
  }
  return {
    fromId: message.from.id,
    chatId: message.chat.id,
    topicId: message.message_thread_id,
    text: message.text,
  };
}

async function postChunks(
  token: string,
  chatId: string,
  topicId: number,
  text: string,
  replyToMessageId?: number
): Promise<void> {
  const chunks = splitTelegramChunks(text);
  for (const chunk of chunks) {
    const result = await sendTelegramMessageWithRateLimitRetry(token, chatId, chunk, replyToMessageId, undefined, topicId);
    if (!result.success) {
      throw new Error(result.error ?? 'sendTelegramMessage failed');
    }
  }
}

async function ensureCursorTopic(
  token: string,
  chatId: string,
  topicMapPath: string,
  state: CursorBridgePersistedState
): Promise<CursorBridgePersistedState> {
  if (state.cursorTopicId !== undefined) {
    return state;
  }
  const topicMap = loadTopicMap(topicMapPath);
  const action = decideEnsureCursorTopicAction(topicMap);
  if (action.kind === 'reuse') {
    return { ...state, cursorTopicId: action.topicId };
  }
  const created = await createForumTopicWithRateLimitRetry(token, chatId, CURSOR_BRIDGE_TOPIC_NAME);
  if (!created.success || created.messageThreadId === undefined) {
    throw new Error(created.error ?? 'createForumTopic failed');
  }
  const nextMap = { ...topicMap, [String(created.messageThreadId)]: 'CURSOR_REMOTE' };
  writeJsonFile(topicMapPath, nextMap);
  return { ...state, cursorTopicId: created.messageThreadId };
}

async function promptWithHeartbeat(
  opDir: string,
  promptAgent: (prompt: string) => Promise<{ replyText: string; agentId: string }>,
  prompt: string
): Promise<string> {
  writePollHeartbeat(opDir);
  const timer = setInterval(() => writePollHeartbeat(opDir), AGENT_RUN_HEARTBEAT_INTERVAL_MS);
  try {
    const result = await promptAgent(prompt);
    return result.replyText;
  } finally {
    clearInterval(timer);
    writePollHeartbeat(opDir);
  }
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
  const opDir = path.join(repoRoot, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });

  const statePath = path.join(opDir, STATE_FILE_NAME);
  const topicMapPath = path.join(opDir, TOPIC_MAP_FILE_NAME);

  const botToken = requiredEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requiredEnv('TELEGRAM_CHAT_ID');
  const principalUserId = requiredEnv('TELEGRAM_PRINCIPAL_USER_ID');

  const agentSession = createLiveCursorBridgeAgentSession(repoRoot);

  let state = parseCursorBridgeState(loadJsonFile(statePath));
  state = await ensureCursorTopic(botToken, chatId, topicMapPath, state);
  writeJsonFile(statePath, state);

  let busy = false;
  let pollFailures = 0;

  const persistState = () => writeJsonFile(statePath, state);

  const syncAgentIdFromSession = () => {
    state = { ...state, agentId: agentSession.readAgentId() };
  };

  const resetAgent = async () => {
    await agentSession.resetSession();
    syncAgentIdFromSession();
    persistState();
  };

  const runPromptWithActiveRunRecovery = async (prompt: string): Promise<string> => {
    try {
      const reply = await promptWithHeartbeat(opDir, (text) => agentSession.promptAgent(text), prompt);
      syncAgentIdFromSession();
      return reply;
    } catch (err) {
      const detail = err instanceof CursorAgentError ? err.message : err instanceof Error ? err.message : String(err);
      if (!isActiveRunConflict(detail)) {
        throw err;
      }
      await resetAgent();
      const reply = await promptWithHeartbeat(opDir, (text) => agentSession.promptAgent(text), prompt);
      syncAgentIdFromSession();
      return reply;
    }
  };

  const handleDecision = async (
    decision: ReturnType<typeof decideInboundAction>,
    replyToMessageId?: number
  ): Promise<void> => {
    const topicId = state.cursorTopicId;
    if (topicId === undefined) {
      return;
    }
    if (decision.action === 'ignore') {
      return;
    }
    if (decision.action === 'refuse') {
      await postChunks(botToken, chatId, topicId, 'Unauthorized.', replyToMessageId);
      return;
    }
    if (decision.action === 'help') {
      await postChunks(botToken, chatId, topicId, formatHelpMessage(), replyToMessageId);
      return;
    }
    if (decision.action === 'status') {
      await postChunks(botToken, chatId, topicId, formatStatusMessage(state, busy), replyToMessageId);
      return;
    }
    if (decision.action === 'busy') {
      await postChunks(botToken, chatId, topicId, 'Busy — wait for the current run to finish.', replyToMessageId);
      return;
    }
    if (decision.action === 'new-session') {
      await resetAgent();
      await postChunks(botToken, chatId, topicId, 'Started a fresh Cursor session. Send your next instruction.', replyToMessageId);
      return;
    }
    busy = true;
    await postChunks(botToken, chatId, topicId, '⏳ Working…', replyToMessageId);
    try {
      const reply = await runPromptWithActiveRunRecovery(decision.text);
      await postChunks(botToken, chatId, topicId, reply, replyToMessageId);
    } catch (err) {
      const detail = err instanceof CursorAgentError ? err.message : err instanceof Error ? err.message : String(err);
      await postChunks(botToken, chatId, topicId, `Error: ${detail}`, replyToMessageId);
    } finally {
      busy = false;
    }
  };

  const bootPrompt = process.env.CURSOR_BRIDGE_BOOT_PROMPT?.trim();
  if (bootPrompt && state.cursorTopicId !== undefined) {
    await postChunks(botToken, chatId, state.cursorTopicId, `Boot test prompt: ${bootPrompt}`);
    await handleDecision({ action: 'prompt', text: bootPrompt });
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const poll = await getTelegramUpdates(botToken, state.updateOffset, POLL_TIMEOUT_SECONDS);
    if (!poll.success) {
      pollFailures += 1;
      await sleep(decidePollBackoffMs(pollFailures));
      continue;
    }
    pollFailures = 0;
    state = { ...state, updateOffset: nextUpdateOffset(poll.updates, state.updateOffset) };
    persistState();
    writePollHeartbeat(opDir);

    for (const update of poll.updates) {
      const inbound = inboundEventOf(update);
      if (!inbound) {
        continue;
      }
      const rawDecision = decideInboundAction(inbound, principalUserId, chatId, state.cursorTopicId);
      const decision = gateBusy(rawDecision, busy);
      await handleDecision(decision, update.message?.message_id);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
