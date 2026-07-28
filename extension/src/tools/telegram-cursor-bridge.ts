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
import { Agent, CursorAgentError, type SDKAgent, type SDKMessage } from '@cursor/sdk';
import {
  createForumTopicWithRateLimitRetry,
  getTelegramUpdates,
  sendTelegramMessageWithRateLimitRetry,
  TelegramUpdate,
} from '../notify/telegramClient';
import { nextUpdateOffset } from './telegramTopicDecisions';
import {
  collectAssistantTextFromMessages,
  CURSOR_BRIDGE_TOPIC_NAME,
  decideEnsureCursorTopicAction,
  decideInboundAction,
  decidePollBackoffMs,
  formatHelpMessage,
  formatStatusMessage,
  gateBusy,
  parseCursorBridgeState,
  splitTelegramChunks,
  type CursorBridgePersistedState,
} from './telegramCursorBridgeCore';

const POLL_TIMEOUT_SECONDS = 30;
const STATE_FILE_NAME = 'cursor-bridge-state.json';
const TOPIC_MAP_FILE_NAME = 'cursor-bridge-topic-map.json';

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

function agentOptions(repoRoot: string, apiKey: string | undefined, modelId: string) {
  return {
    ...(apiKey ? { apiKey } : {}),
    model: { id: modelId },
    local: { cwd: repoRoot, settingSources: [] },
  };
}

async function openAgent(
  repoRoot: string,
  apiKey: string | undefined,
  modelId: string,
  agentId: string | undefined
): Promise<SDKAgent> {
  if (agentId) {
    return Agent.resume(agentId, agentOptions(repoRoot, apiKey, modelId));
  }
  return Agent.create(agentOptions(repoRoot, apiKey, modelId));
}

async function runPrompt(agent: SDKAgent, prompt: string): Promise<string> {
  const run = await agent.send(prompt);
  const messages: SDKMessage[] = [];
  for await (const event of run.stream()) {
    messages.push(event);
  }
  const result = await run.wait();
  if (result.status === 'error') {
    throw new Error(`Cursor run failed: ${result.id}`);
  }
  const text = collectAssistantTextFromMessages(messages).trim();
  return text.length > 0 ? text : '(no text reply)';
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
  const apiKey = process.env.CURSOR_API_KEY;
  const modelId = process.env.CURSOR_BRIDGE_MODEL ?? 'composer-2.5';

  let state = parseCursorBridgeState(loadJsonFile(statePath));
  state = await ensureCursorTopic(botToken, chatId, topicMapPath, state);
  writeJsonFile(statePath, state);

  let agent: SDKAgent | undefined;
  let busy = false;
  let pollFailures = 0;

  const persistState = () => writeJsonFile(statePath, state);

  const resetAgent = async () => {
    if (agent) {
      await agent.close();
      agent = undefined;
    }
    state = { ...state, agentId: undefined };
    persistState();
  };

  const ensureAgent = async () => {
    if (!agent) {
      agent = await openAgent(repoRoot, apiKey, modelId, state.agentId);
      state = { ...state, agentId: agent.agentId };
      persistState();
    }
    return agent;
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
      const liveAgent = await ensureAgent();
      const reply = await runPrompt(liveAgent, decision.text);
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
