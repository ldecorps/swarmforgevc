import * as fs from 'fs';
import * as path from 'path';
import { CursorAgentError } from '@cursor/sdk';
import { atomicWrite } from '../util/atomicWrite';
import {
  createForumTopicWithRateLimitRetry,
  getTelegramUpdates,
  sendTelegramMessageWithRateLimitRetry,
  type TelegramUpdate,
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
import type { CursorBridgeAgentSessionDeps } from '../bridge/cursorBridgeAgentSession';

export const POLL_TIMEOUT_SECONDS = 30;
export const STATE_FILE_NAME = 'cursor-bridge-state.json';
export const TOPIC_MAP_FILE_NAME = 'cursor-bridge-topic-map.json';
export const HEARTBEAT_FILE_NAME = 'cursor-bridge-heartbeat.json';

export function writePollHeartbeat(opDir: string, nowMs = Date.now()): void {
  atomicWrite(path.join(opDir, HEARTBEAT_FILE_NAME), JSON.stringify({ lastHeartbeatMs: nowMs }));
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export function loadJsonFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function loadTopicMap(filePath: string): Record<string, string> {
  const raw = loadJsonFile(filePath);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, string>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function inboundEventOf(update: TelegramUpdate) {
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

export type PostChunksFn = (
  token: string,
  chatId: string,
  topicId: number,
  text: string,
  replyToMessageId?: number
) => Promise<void>;

export async function postChunks(
  token: string,
  chatId: string,
  topicId: number,
  text: string,
  replyToMessageId?: number,
  sendMessage: typeof sendTelegramMessageWithRateLimitRetry = sendTelegramMessageWithRateLimitRetry
): Promise<void> {
  const chunks = splitTelegramChunks(text);
  for (const chunk of chunks) {
    const result = await sendMessage(token, chatId, chunk, replyToMessageId, undefined, topicId);
    if (!result.success) {
      throw new Error(result.error ?? 'sendTelegramMessage failed');
    }
  }
}

export async function ensureCursorTopic(
  token: string,
  chatId: string,
  topicMapPath: string,
  state: CursorBridgePersistedState,
  createTopic: typeof createForumTopicWithRateLimitRetry = createForumTopicWithRateLimitRetry
): Promise<CursorBridgePersistedState> {
  if (state.cursorTopicId !== undefined) {
    return state;
  }
  const topicMap = loadTopicMap(topicMapPath);
  const action = decideEnsureCursorTopicAction(topicMap);
  if (action.kind === 'reuse') {
    return { ...state, cursorTopicId: action.topicId };
  }
  const created = await createTopic(token, chatId, CURSOR_BRIDGE_TOPIC_NAME);
  if (!created.success || created.messageThreadId === undefined) {
    throw new Error(created.error ?? 'createForumTopic failed');
  }
  const nextMap = { ...topicMap, [String(created.messageThreadId)]: 'CURSOR_REMOTE' };
  writeJsonFile(topicMapPath, nextMap);
  return { ...state, cursorTopicId: created.messageThreadId };
}

export async function promptWithHeartbeat(
  opDir: string,
  promptAgent: (prompt: string) => Promise<{ replyText: string; agentId: string }>,
  prompt: string,
  heartbeatWriter: (dir: string) => void = writePollHeartbeat,
  heartbeatIntervalMs = AGENT_RUN_HEARTBEAT_INTERVAL_MS
): Promise<string> {
  heartbeatWriter(opDir);
  const timer = setInterval(() => heartbeatWriter(opDir), heartbeatIntervalMs);
  try {
    const result = await promptAgent(prompt);
    return result.replyText;
  } finally {
    clearInterval(timer);
    heartbeatWriter(opDir);
  }
}

export type InboundDecision = ReturnType<typeof decideInboundAction>;

export interface CursorBridgeHandlerContext {
  botToken: string;
  chatId: string;
  state: CursorBridgePersistedState;
  busy: boolean;
  agentSession: CursorBridgeAgentSessionDeps;
  opDir: string;
  post: PostChunksFn;
  persistState: () => void;
  syncAgentIdFromSession: () => void;
}

export async function runPromptWithActiveRunRecovery(
  ctx: Pick<CursorBridgeHandlerContext, 'agentSession' | 'opDir' | 'syncAgentIdFromSession'>,
  prompt: string,
  resetAgent: () => Promise<void>
): Promise<string> {
  try {
    const reply = await promptWithHeartbeat(ctx.opDir, (text) => ctx.agentSession.promptAgent(text), prompt);
    ctx.syncAgentIdFromSession();
    return reply;
  } catch (err) {
    const detail = err instanceof CursorAgentError ? err.message : err instanceof Error ? err.message : String(err);
    if (!isActiveRunConflict(detail)) {
      throw err;
    }
    await resetAgent();
    const reply = await promptWithHeartbeat(ctx.opDir, (text) => ctx.agentSession.promptAgent(text), prompt);
    ctx.syncAgentIdFromSession();
    return reply;
  }
}

export async function handleInboundDecision(
  decision: InboundDecision,
  ctx: CursorBridgeHandlerContext,
  replyToMessageId: number | undefined,
  resetAgent: () => Promise<void>
): Promise<boolean> {
  const topicId = ctx.state.cursorTopicId;
  if (topicId === undefined) {
    return ctx.busy;
  }
  if (decision.action === 'ignore') {
    return ctx.busy;
  }
  if (decision.action === 'refuse') {
    await ctx.post(ctx.botToken, ctx.chatId, topicId, 'Unauthorized.', replyToMessageId);
    return ctx.busy;
  }
  if (decision.action === 'help') {
    await ctx.post(ctx.botToken, ctx.chatId, topicId, formatHelpMessage(), replyToMessageId);
    return ctx.busy;
  }
  if (decision.action === 'status') {
    await ctx.post(ctx.botToken, ctx.chatId, topicId, formatStatusMessage(ctx.state, ctx.busy), replyToMessageId);
    return ctx.busy;
  }
  if (decision.action === 'busy') {
    await ctx.post(ctx.botToken, ctx.chatId, topicId, 'Busy — wait for the current run to finish.', replyToMessageId);
    return ctx.busy;
  }
  if (decision.action === 'new-session') {
    await resetAgent();
    await ctx.post(
      ctx.botToken,
      ctx.chatId,
      topicId,
      'Started a fresh Cursor session. Send your next instruction.',
      replyToMessageId
    );
    return ctx.busy;
  }
  await ctx.post(ctx.botToken, ctx.chatId, topicId, '⏳ Working…', replyToMessageId);
  try {
    const reply = await runPromptWithActiveRunRecovery(ctx, decision.text, resetAgent);
    await ctx.post(ctx.botToken, ctx.chatId, topicId, reply, replyToMessageId);
  } catch (err) {
    const detail = err instanceof CursorAgentError ? err.message : err instanceof Error ? err.message : String(err);
    await ctx.post(ctx.botToken, ctx.chatId, topicId, `Error: ${detail}`, replyToMessageId);
  }
  return false;
}

export interface CursorBridgeLoopDeps {
  botToken: string;
  chatId: string;
  principalUserId: string;
  opDir: string;
  statePath: string;
  topicMapPath: string;
  agentSession: CursorBridgeAgentSessionDeps;
  getUpdates?: typeof getTelegramUpdates;
  pollTimeoutSeconds?: number;
  onPollFailure?: (failures: number) => Promise<void>;
  post?: PostChunksFn;
}

export async function runCursorBridgePollOnce(
  deps: CursorBridgeLoopDeps,
  state: CursorBridgePersistedState,
  busy: boolean,
  pollFailures: number
): Promise<{ state: CursorBridgePersistedState; busy: boolean; pollFailures: number }> {
  const getUpdates = deps.getUpdates ?? getTelegramUpdates;
  const timeout = deps.pollTimeoutSeconds ?? POLL_TIMEOUT_SECONDS;
  const poll = await getUpdates(deps.botToken, state.updateOffset, timeout);
  if (!poll.success) {
    const nextFailures = pollFailures + 1;
    if (deps.onPollFailure) {
      await deps.onPollFailure(nextFailures);
    } else {
      await sleep(decidePollBackoffMs(nextFailures));
    }
    return { state, busy, pollFailures: nextFailures };
  }

  let nextState = { ...state, updateOffset: nextUpdateOffset(poll.updates, state.updateOffset) };
  writeJsonFile(deps.statePath, nextState);
  writePollHeartbeat(deps.opDir);

  let nextBusy = busy;
  const persistState = () => writeJsonFile(deps.statePath, nextState);
  const syncAgentIdFromSession = () => {
    nextState = { ...nextState, agentId: deps.agentSession.readAgentId() };
  };
  const resetAgent = async () => {
    await deps.agentSession.resetSession();
    syncAgentIdFromSession();
    persistState();
  };
  const post: PostChunksFn =
    deps.post ?? ((token, chatId, topicId, text, replyToMessageId) =>
      postChunks(token, chatId, topicId, text, replyToMessageId));

  for (const update of poll.updates) {
    const inbound = inboundEventOf(update);
    if (!inbound) {
      continue;
    }
    const rawDecision = decideInboundAction(inbound, deps.principalUserId, deps.chatId, nextState.cursorTopicId);
    const decision = gateBusy(rawDecision, nextBusy);
    if (decision.action === 'prompt') {
      nextBusy = true;
    }
    nextBusy = await handleInboundDecision(
      decision,
      {
        botToken: deps.botToken,
        chatId: deps.chatId,
        state: nextState,
        busy: nextBusy,
        agentSession: deps.agentSession,
        opDir: deps.opDir,
        post,
        persistState,
        syncAgentIdFromSession,
      },
      update.message?.message_id,
      resetAgent
    );
  }

  return { state: nextState, busy: nextBusy, pollFailures: 0 };
}

export async function bootstrapCursorBridgeState(
  repoRoot: string,
  botToken: string,
  chatId: string,
  statePath: string,
  topicMapPath: string
): Promise<CursorBridgePersistedState> {
  const opDir = path.join(repoRoot, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  let state = parseCursorBridgeState(loadJsonFile(statePath));
  state = await ensureCursorTopic(botToken, chatId, topicMapPath, state);
  writeJsonFile(statePath, state);
  return state;
}
