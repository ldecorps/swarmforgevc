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
import { withPromptProgress } from '../bridge/cursorBridgeAgentSession';
import { createThrottledProgressReporter } from '../bridge/cursorBridgeProgress';
import {
  formatExpediteFailureMessage,
  formatExpediteStartMessage,
  formatReexpediteStartMessage,
  readExpediteLock,
  startExpediteRun,
  startReexpediteRun,
} from './telegramCursorBridgeExpedite';
import {
  formatRedeployFailureMessage,
  formatRedeployStartMessage,
  readRedeployLock,
  startRedeployRun,
} from './telegramCursorBridgeRedeploy';
import { formatLogTelegramMessage } from './telegramCursorBridgeLogs';

export const TELEGRAM_PROGRESS_MIN_INTERVAL_MS = 12_000;

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

const JSON_PARSE_FAILED = Symbol('json-parse-failed');

export function parseJsonOrUndefined(raw: string): unknown | typeof JSON_PARSE_FAILED {
  try {
    return JSON.parse(raw);
  } catch {
    return JSON_PARSE_FAILED;
  }
}

export function loadJsonFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const parsed = parseJsonOrUndefined(fs.readFileSync(filePath, 'utf8'));
  if (parsed === JSON_PARSE_FAILED) {
    return undefined;
  }
  return parsed;
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
    messageId: message.message_id,
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

function reuseCursorTopicFromMap(state: CursorBridgePersistedState, topicId: number): CursorBridgePersistedState {
  return { ...state, cursorTopicId: topicId };
}

async function createCursorRemoteTopic(
  token: string,
  chatId: string,
  topicMapPath: string,
  topicMap: Record<string, string>,
  state: CursorBridgePersistedState,
  createTopic: typeof createForumTopicWithRateLimitRetry
): Promise<CursorBridgePersistedState> {
  const created = await createTopic(token, chatId, CURSOR_BRIDGE_TOPIC_NAME);
  if (!created.success || created.messageThreadId === undefined) {
    throw new Error(created.error ?? 'createForumTopic failed');
  }
  const nextMap = { ...topicMap, [String(created.messageThreadId)]: 'CURSOR_REMOTE' };
  writeJsonFile(topicMapPath, nextMap);
  return { ...state, cursorTopicId: created.messageThreadId };
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
    return reuseCursorTopicFromMap(state, action.topicId);
  }
  return createCursorRemoteTopic(token, chatId, topicMapPath, topicMap, state, createTopic);
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
  repoRoot: string;
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
  resetAgent: () => Promise<void>,
  onProgress?: (line: string) => void | Promise<void>
): Promise<string> {
  const runOnce = async (_text: string): Promise<{ replyText: string; agentId: string }> =>
    withPromptProgress(onProgress, async () => {
      const result = await ctx.agentSession.promptAgent(prompt);
      ctx.syncAgentIdFromSession();
      return result;
    });
  try {
    return await promptWithHeartbeat(ctx.opDir, runOnce, prompt);
  } catch (err) {
    const detail = err instanceof CursorAgentError ? err.message : err instanceof Error ? err.message : String(err);
    if (!isActiveRunConflict(detail)) {
      throw err;
    }
    await resetAgent();
    return await promptWithHeartbeat(ctx.opDir, runOnce, prompt);
  }
}

async function postInboundReply(
  ctx: CursorBridgeHandlerContext,
  topicId: number,
  text: string,
  replyToMessageId: number | undefined
): Promise<void> {
  await ctx.post(ctx.botToken, ctx.chatId, topicId, text, replyToMessageId);
}

async function handleSimpleInboundAction(
  ctx: CursorBridgeHandlerContext,
  topicId: number,
  text: string,
  replyToMessageId: number | undefined
): Promise<boolean> {
  await postInboundReply(ctx, topicId, text, replyToMessageId);
  return ctx.busy;
}

async function handlePromptInboundAction(
  ctx: CursorBridgeHandlerContext,
  topicId: number,
  prompt: string,
  replyToMessageId: number | undefined,
  resetAgent: () => Promise<void>
): Promise<boolean> {
  if (ctx.busy) {
    ctx.persistState();
  }
  const reportProgress = createThrottledProgressReporter(TELEGRAM_PROGRESS_MIN_INTERVAL_MS, (line) =>
    postInboundReply(ctx, topicId, line, undefined)
  );
  await postInboundReply(ctx, topicId, '🚀 Agent started…', undefined);
  try {
    const reply = await runPromptWithActiveRunRecovery(ctx, prompt, resetAgent, reportProgress);
    await postInboundReply(ctx, topicId, reply, replyToMessageId);
  } catch (err) {
    const detail = err instanceof CursorAgentError ? err.message : err instanceof Error ? err.message : String(err);
    await postInboundReply(ctx, topicId, `Error: ${detail}`, replyToMessageId);
  }
  return false;
}

type InboundActionHandler = (
  ctx: CursorBridgeHandlerContext,
  topicId: number,
  replyToMessageId: number | undefined,
  resetAgent: () => Promise<void>
) => Promise<boolean>;

const INBOUND_ACTION_HANDLERS: Partial<Record<InboundDecision['action'], InboundActionHandler>> = {
  refuse: (ctx, topicId, replyTo) => handleSimpleInboundAction(ctx, topicId, 'Unauthorized.', replyTo),
  help: (ctx, topicId, replyTo) => handleSimpleInboundAction(ctx, topicId, formatHelpMessage(), replyTo),
  status: (ctx, topicId, replyTo) => {
    let text = formatStatusMessage(ctx.state, ctx.busy);
    const expediteLock = readExpediteLock(ctx.repoRoot);
    if (expediteLock) {
      text += `\nExpedite: ${expediteLock.ticket} running (pid ${expediteLock.pid})`;
    }
    const redeployLock = readRedeployLock(ctx.repoRoot);
    if (redeployLock) {
      text += `\nRedeploy: running (pid ${redeployLock.pid})`;
    }
    return handleSimpleInboundAction(ctx, topicId, text, replyTo);
  },
  busy: (ctx, topicId, replyTo) =>
    handleSimpleInboundAction(ctx, topicId, 'Busy — wait for the current run to finish.', replyTo),
  ignore: () => {
    throw new Error('ignore action must short-circuit before handlers');
  },
  'new-session': async (ctx, topicId, replyTo, resetAgent) => {
    await resetAgent();
    return handleSimpleInboundAction(
      ctx,
      topicId,
      'Started a fresh Cursor session. Send your next instruction.',
      replyTo
    );
  },
  redeploy: async (ctx, topicId, replyTo) => {
    const result = startRedeployRun(ctx.repoRoot);
    const text = result.ok ? formatRedeployStartMessage(result) : formatRedeployFailureMessage(result);
    await postInboundReply(ctx, topicId, text, replyTo);
    return false;
  },
};

export async function handleInboundDecision(
  decision: InboundDecision,
  ctx: CursorBridgeHandlerContext,
  replyToMessageId: number | undefined,
  resetAgent: () => Promise<void>
): Promise<boolean> {
  const topicId = ctx.state.cursorTopicId;
  if (decision.action === 'ignore') {
    return ctx.busy;
  }
  if (topicId === undefined) {
    return ctx.busy;
  }
  const handler = INBOUND_ACTION_HANDLERS[decision.action];
  if (handler) {
    return handler(ctx, topicId, replyToMessageId, resetAgent);
  }
  if (decision.action === 'prompt') {
    return handlePromptInboundAction(ctx, topicId, decision.text, replyToMessageId, resetAgent);
  }
  if (decision.action === 'expedite') {
    const result = startExpediteRun(ctx.repoRoot, decision.ticket);
    const text = result.ok ? formatExpediteStartMessage(result) : formatExpediteFailureMessage(result);
    await postInboundReply(ctx, topicId, text, replyToMessageId);
    return false;
  }
  if (decision.action === 'reexpedite') {
    const result = startReexpediteRun(ctx.repoRoot, decision.ticket);
    const text = result.ok ? formatReexpediteStartMessage(result) : formatExpediteFailureMessage(result);
    await postInboundReply(ctx, topicId, text, replyToMessageId);
    return false;
  }
  if (decision.action === 'log') {
    const text = formatLogTelegramMessage(ctx.repoRoot, decision.target);
    await postInboundReply(ctx, topicId, text, undefined);
    return false;
  }
  return ctx.busy;
}

export interface CursorBridgeLoopDeps {
  repoRoot: string;
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

async function handleFailedPoll(
  deps: CursorBridgeLoopDeps,
  pollFailures: number
): Promise<void> {
  const nextFailures = pollFailures + 1;
  if (deps.onPollFailure) {
    await deps.onPollFailure(nextFailures);
    return;
  }
  await sleep(decidePollBackoffMs(nextFailures));
}

function makePollHandlerContext(
  deps: CursorBridgeLoopDeps,
  holder: { state: CursorBridgePersistedState }
) {
  const persistState = () => writeJsonFile(deps.statePath, holder.state);
  const syncAgentIdFromSession = () => {
    holder.state = { ...holder.state, agentId: deps.agentSession.readAgentId() };
  };
  const resetAgent = async () => {
    await deps.agentSession.resetSession();
    syncAgentIdFromSession();
    persistState();
  };
  const post: PostChunksFn =
    deps.post ?? ((token, chatId, topicId, text, replyToMessageId) =>
      postChunks(token, chatId, topicId, text, replyToMessageId));
  return { persistState, syncAgentIdFromSession, resetAgent, post };
}

async function processInboundUpdates(
  deps: CursorBridgeLoopDeps,
  updates: TelegramUpdate[],
  holder: { state: CursorBridgePersistedState; busy: boolean },
  handlerCtx: ReturnType<typeof makePollHandlerContext>
): Promise<void> {
  for (const update of updates) {
    const inbound = inboundEventOf(update);
    if (!inbound) {
      continue;
    }
    const rawDecision = decideInboundAction(inbound, deps.principalUserId, deps.chatId, holder.state.cursorTopicId);
    const decision = gateBusy(rawDecision, holder.busy);
    const ctxBusy = decision.action === 'prompt' ? true : holder.busy;
    holder.busy = await handleInboundDecision(
      decision,
      {
        repoRoot: deps.repoRoot,
        botToken: deps.botToken,
        chatId: deps.chatId,
        state: holder.state,
        busy: ctxBusy,
        agentSession: deps.agentSession,
        opDir: deps.opDir,
        post: handlerCtx.post,
        persistState: handlerCtx.persistState,
        syncAgentIdFromSession: handlerCtx.syncAgentIdFromSession,
      },
      inbound.messageId,
      handlerCtx.resetAgent
    );
  }
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
    await handleFailedPoll(deps, pollFailures);
    return { state, busy, pollFailures: pollFailures + 1 };
  }

  const holder = {
    state: { ...state, updateOffset: nextUpdateOffset(poll.updates, state.updateOffset) },
    busy,
  };
  writeJsonFile(deps.statePath, holder.state);
  writePollHeartbeat(deps.opDir);

  await processInboundUpdates(deps, poll.updates, holder, makePollHandlerContext(deps, holder));

  return { state: holder.state, busy: holder.busy, pollFailures: 0 };
}

export interface CursorBridgeCliEnv {
  repoRoot: string;
  botToken: string;
  chatId: string;
  principalUserId: string;
  bootPrompt?: string;
  shouldContinue?: () => boolean;
  loopOverrides?: Partial<CursorBridgeLoopDeps>;
  post?: PostChunksFn;
}

export async function runCursorBridgeBootIfConfigured(
  env: Pick<CursorBridgeCliEnv, 'bootPrompt' | 'botToken' | 'chatId' | 'post'>,
  ctx: {
    repoRoot: string;
    state: CursorBridgePersistedState;
    busy: boolean;
    agentSession: CursorBridgeAgentSessionDeps;
    opDir: string;
    persistState: () => void;
    syncAgentIdFromSession: () => void;
    resetAgent: () => Promise<void>;
  }
): Promise<boolean> {
  if (!env.bootPrompt || ctx.state.cursorTopicId === undefined) {
    return ctx.busy;
  }
  const post = env.post ?? postChunks;
  await post(env.botToken, env.chatId, ctx.state.cursorTopicId, `Boot test prompt: ${env.bootPrompt}`);
  return handleInboundDecision(
    { action: 'prompt', text: env.bootPrompt },
    {
      repoRoot: ctx.repoRoot,
      botToken: env.botToken,
      chatId: env.chatId,
      state: ctx.state,
      busy: ctx.busy,
      agentSession: ctx.agentSession,
      opDir: ctx.opDir,
      post,
      persistState: ctx.persistState,
      syncAgentIdFromSession: ctx.syncAgentIdFromSession,
    },
    undefined,
    ctx.resetAgent
  );
}

export async function runCursorBridgeLoop(
  loopDeps: CursorBridgeLoopDeps,
  initial: { state: CursorBridgePersistedState; busy: boolean; pollFailures: number },
  shouldContinue: () => boolean
): Promise<{ state: CursorBridgePersistedState; busy: boolean; pollFailures: number }> {
  let state = initial.state;
  let busy = initial.busy;
  let pollFailures = initial.pollFailures;
  while (shouldContinue()) {
    const next = await runCursorBridgePollOnce(loopDeps, state, busy, pollFailures);
    state = next.state;
    busy = next.busy;
    pollFailures = next.pollFailures;
  }
  return { state, busy, pollFailures };
}

export async function runCursorBridgeApp(
  env: CursorBridgeCliEnv,
  agentSession: CursorBridgeAgentSessionDeps
): Promise<void> {
  const opDir = path.join(env.repoRoot, '.swarmforge', 'operator');
  const statePath = path.join(opDir, STATE_FILE_NAME);
  const topicMapPath = path.join(opDir, TOPIC_MAP_FILE_NAME);

  let state = await bootstrapCursorBridgeState(env.repoRoot, env.botToken, env.chatId, statePath, topicMapPath);
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

  busy = await runCursorBridgeBootIfConfigured(env, {
    repoRoot: env.repoRoot,
    state,
    busy,
    agentSession,
    opDir,
    persistState,
    syncAgentIdFromSession,
    resetAgent,
  });

  const loopDeps: CursorBridgeLoopDeps = {
    repoRoot: env.repoRoot,
    botToken: env.botToken,
    chatId: env.chatId,
    principalUserId: env.principalUserId,
    opDir,
    statePath,
    topicMapPath,
    agentSession,
    ...env.loopOverrides,
  };

  const loopResult = await runCursorBridgeLoop(
    loopDeps,
    { state, busy, pollFailures },
    env.shouldContinue ?? (() => true)
  );
  state = loopResult.state;
  busy = loopResult.busy;
  pollFailures = loopResult.pollFailures;
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
