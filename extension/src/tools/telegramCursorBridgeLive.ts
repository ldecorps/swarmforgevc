import * as fs from 'fs';
import * as path from 'path';
import { CursorAgentError, type SDKUserMessage } from '@cursor/sdk';
import { atomicWrite } from '../util/atomicWrite';
import {
  answerCallbackQuery,
  createForumTopicWithRateLimitRetry,
  getTelegramUpdates,
  sendTelegramMessage,
  sendTelegramPoll,
  sendTelegramMessageWithRateLimitRetry,
  type InlineKeyboardButton,
  type TelegramMessage,
  type TelegramPollAnswer,
  type TelegramPostFn,
  type TelegramUpdate,
} from '../notify/telegramClient';
import { nextUpdateOffset } from './telegramTopicDecisions';
import { drainCursorBridgeInboundUpdates } from './cursorBridgeInboundQueue';
import {
  CURSOR_BRIDGE_TOPIC_NAME,
  BUBBLE_SUBJECT_ID,
  BUBBLE_TOPIC_NAME,
  AGENT_RUN_HEARTBEAT_INTERVAL_MS,
  decideEnsureCursorTopicAction,
  decideEnsureBubbleTopicAction,
  decideInboundAction,
  decidePollBackoffMs,
  formatHelpMessage,
  formatStatusMessage,
  gateBusy,
  isAuthorizedPrincipal,
  shouldResetCursorAgentSession,
  shouldUseCursorBridgeInboundQueue,
  parseCursorBridgeState,
  type CursorBridgeQueuedPrompt,
  type CursorBridgePersistedState,
  type CursorBridgeChoicePoll,
  type CursorBridgeInboundEvent,
} from './telegramCursorBridgeCore';
import {
  formatOperatorConfirmPrompt,
  formatOperatorStopModePrompt,
  operatorConfirmButtons,
  operatorStopModeButtons,
  type PendingOperatorConfirm,
} from './telegramCursorOperatorCore';
import {
  executeOperatorVerb,
  executeStopMode,
  writeOperatorBounceSentinel,
  runOperatorStop,
} from './telegramCursorOperatorExec';
import { syncCursorBridgeLivenessStatus } from './telegramCursorBridgeLiveness';
import {
  probeSwarmLiveness,
  isSwarmLive,
  formatSwarmLiveRefuse,
  formatFullPackRefuse,
  fullPackPipelineRolesUp,
  stopAndRunButtons,
  awaitSwarmDrain,
  awaitPipelineEmpty,
} from './telegramCursorOperatorLiveness';
import {
  readOperatorPolicy,
  isHolidayQuietToday,
  formatHolidayRefuse,
  runAnywayButtons,
  isHolidayBlockedVerb,
} from './telegramCursorOperatorPolicy';
import {
  readOperatorBatch,
  writeOperatorBatch,
  clearOperatorBatch,
  isOperatorBatchInFlight,
  isBatchExclusiveVerb,
  formatBatchBusyRefuse,
  advanceOperatorBatch,
} from './telegramCursorOperatorBatch';
import type { CursorBridgeAgentSessionDeps } from '../bridge/cursorBridgeAgentSession';
import { withPromptProgress } from '../bridge/cursorBridgeAgentSession';
import {
  buildPhotoPromptText,
  downloadTelegramPhotoAsSdkImage,
  largestTelegramPhotoFileId,
} from '../bridge/cursorBridgeTelegramMedia';
import { detectProgressLocale } from '../bridge/progressLocale';
import {
  markdownToTelegramHtml,
  shouldRetryTelegramPostAsPlainText,
  splitTelegramHtmlChunks,
  telegramHtmlToPlainText,
} from '../bridge/cursorBridgeTelegramHtml';
import { createThrottledProgressReporter } from '../bridge/cursorBridgeProgress';
import {
  beginActiveRun,
  endActiveRun,
  isActiveRunInFlight,
  recordActiveRunProgress,
} from '../bridge/cursorBridgeRunTracker';
import { collectUpdateSnapshot, formatUpdateMessage } from './telegramCursorBridgeUpdate';
import {
  formatExpediteFailureMessage,
  formatExpediteStartMessage,
  formatReexpediteStartMessage,
  readExpediteLock,
  startExpediteRun,
  startReexpediteRun,
} from './telegramCursorBridgeExpedite';
import {
  composePilotExpeditorPrompt,
  composeHydratePrompt,
  formatPilotBlockedByExpediteMessage,
  formatPilotBlockedBySwarmLiveMessage,
  formatPilotStartMessage,
  gatePilotAgainstExpediteLock,
  landSleepButtons,
} from './telegramCursorBridgePilot';
import {
  formatRedeployFailureMessage,
  formatRedeployStartMessage,
  readRedeployLock,
  startRedeployRun,
} from './telegramCursorBridgeRedeploy';
import {
  formatMiniAppRedeployFailureMessage,
  formatMiniAppRedeployStartMessage,
  readMiniAppRedeployLock,
  startMiniAppRedeployRun,
} from './telegramCursorBridgeMiniAppRedeploy';
import { formatLogTelegramMessage } from './telegramCursorBridgeLogs';

export const TELEGRAM_PROGRESS_MIN_INTERVAL_MS = 12_000;
export const BUSY_POLL_TIMEOUT_SECONDS = 2;

export const POLL_TIMEOUT_SECONDS = 30;
export const STATE_FILE_NAME = 'cursor-bridge-state.json';
export const TOPIC_MAP_FILE_NAME = 'cursor-bridge-topic-map.json';
export const HEARTBEAT_FILE_NAME = 'cursor-bridge-heartbeat.json';
export const MAX_QUEUED_PROMPTS = 50;
export const QUEUE_POLL_MAX_OPTIONS = 8;
export const BRIDGE_READY_MESSAGE = 'Bridge ready — accepting prompts.';

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

function inboundSenderOf(message: TelegramMessage) {
  const fromId = message.from?.id;
  const chatId = message.chat?.id;
  if (fromId === undefined || chatId === undefined) {
    return undefined;
  }
  return { fromId, chatId };
}

function inboundTextOf(message: TelegramMessage): string {
  return message.text ?? message.caption ?? '';
}

function inboundPhotoFields(photoFileId: string | undefined) {
  return photoFileId ? { photoFileId } : {};
}

export function inboundEventOf(update: TelegramUpdate):
  | (CursorBridgeInboundEvent & { messageId?: number })
  | undefined {
  const callback = update.callback_query;
  if (callback) {
    const fromId = callback.from?.id;
    const message = callback.message;
    const chatId = message?.chat?.id;
    const data = callback.data;
    if (fromId === undefined || chatId === undefined || !data) {
      return undefined;
    }
    return {
      kind: 'callback',
      fromId,
      chatId,
      topicId: message?.message_thread_id,
      text: '',
      callbackData: data,
      callbackQueryId: callback.id,
      messageId: message?.message_id,
    };
  }
  const message = update.message;
  if (!message) {
    return undefined;
  }
  const sender = inboundSenderOf(message);
  const photoFileId = largestTelegramPhotoFileId(message.photo);
  const text = inboundTextOf(message);
  if (!sender || (!text && !photoFileId)) {
    return undefined;
  }
  return {
    kind: 'text',
    fromId: sender.fromId,
    chatId: sender.chatId,
    topicId: message.message_thread_id,
    text,
    messageId: message.message_id,
    ...inboundPhotoFields(photoFileId),
  };
}

export function pendingOperatorConfirmPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', 'cursor-remote-pending-confirm.json');
}

export function readPendingOperatorConfirm(repoRoot: string): PendingOperatorConfirm {
  const filePath = pendingOperatorConfirmPath(repoRoot);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      tier?: string;
      verb?: string;
      args?: string;
    };
    if ((parsed.tier !== 'soft' && parsed.tier !== 'hard') || typeof parsed.verb !== 'string') {
      return undefined;
    }
    return {
      tier: parsed.tier,
      verb: parsed.verb,
      ...(typeof parsed.args === 'string' && parsed.args ? { args: parsed.args } : {}),
    };
  } catch {
    return undefined;
  }
}

export function writePendingOperatorConfirm(
  repoRoot: string,
  pending: PendingOperatorConfirm
): void {
  const filePath = pendingOperatorConfirmPath(repoRoot);
  if (!pending) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // absent is fine
    }
    return;
  }
  atomicWrite(filePath, JSON.stringify(pending));
}

function nextQueuedPromptId(nowMs: number, seq: number): string {
  return `qp-${nowMs}-${seq}`;
}

function queuePromptOptionLabel(prompt: CursorBridgeQueuedPrompt, index: number): string {
  const oneLine = prompt.text.replace(/\s+/g, ' ').trim();
  const maxLen = 78;
  const body = oneLine.length > maxLen ? `${oneLine.slice(0, maxLen - 1)}…` : oneLine;
  return `${index + 1}) ${body || '(empty)'}`;
}

function queuePromptSummary(state: CursorBridgePersistedState, maxItems = 5): string {
  const pending = state.pendingPrompts ?? [];
  if (pending.length === 0) {
    return 'Queue is empty.';
  }
  const lines = pending.slice(0, maxItems).map((item, idx) => `- ${idx + 1}. ${queuePromptOptionLabel(item, idx).replace(/^\d+\)\s/, '')}`);
  const hidden = pending.length - Math.min(pending.length, maxItems);
  if (hidden > 0) {
    lines.push(`- …and ${hidden} more`);
  }
  return lines.join('\n');
}

function queuePromptListForDisplay(state: CursorBridgePersistedState): string {
  const pending = state.pendingPrompts ?? [];
  if (pending.length === 0) {
    return 'Queue is empty.';
  }
  const lines = pending.map((item, idx) => `${idx + 1}. ${queuePromptOptionLabel(item, idx).replace(/^\d+\)\s/, '')}`);
  return [`Queued questions: ${pending.length}`, ...lines].join('\n');
}

function pushQueuedPrompt(
  state: CursorBridgePersistedState,
  text: string,
  photoFileIds: string[] | undefined,
  replyToMessageId: number | undefined,
  nowMs: number
): CursorBridgePersistedState {
  const previous = state.pendingPrompts ?? [];
  const id = nextQueuedPromptId(nowMs, previous.length + 1);
  const nextItem: CursorBridgeQueuedPrompt = {
    id,
    text,
    createdAtMs: nowMs,
    ...(photoFileIds && photoFileIds.length > 0 ? { photoFileIds } : {}),
    ...(typeof replyToMessageId === 'number' ? { replyToMessageId } : {}),
  };
  const next = [...previous, nextItem].slice(-MAX_QUEUED_PROMPTS);
  return { ...state, pendingPrompts: next };
}

function clearQueuedPollIfStale(state: CursorBridgePersistedState): CursorBridgePersistedState {
  const poll = state.pendingPromptPoll;
  if (!poll) {
    return state;
  }
  const known = new Set((state.pendingPrompts ?? []).map((item) => item.id));
  const anyAlive = poll.itemIds.some((id) => known.has(id));
  if (anyAlive) {
    return state;
  }
  return { ...state, pendingPromptPoll: undefined };
}

export type PostChunksFn = (
  token: string,
  chatId: string,
  topicId: number,
  text: string,
  replyToMessageId?: number
) => Promise<void>;

function sendFailure(error: string | undefined): Error {
  return new Error(error ?? 'sendTelegramMessage failed');
}

// One rendered chunk: HTML first, then plain text if Telegram refused to parse
// it, so a reply is never lost to its own formatting.
async function postRenderedChunk(
  sendMessage: typeof sendTelegramMessageWithRateLimitRetry,
  token: string,
  chatId: string,
  topicId: number,
  chunk: string,
  replyToMessageId?: number
): Promise<void> {
  const rendered = await sendMessage(token, chatId, chunk, replyToMessageId, undefined, topicId, undefined, 'HTML');
  if (rendered.success) {
    return;
  }
  if (!shouldRetryTelegramPostAsPlainText(rendered.error)) {
    throw sendFailure(rendered.error);
  }
  const plain = telegramHtmlToPlainText(chunk);
  const retry = await sendMessage(token, chatId, plain, replyToMessageId, undefined, topicId);
  if (!retry.success) {
    throw sendFailure(retry.error);
  }
}

// BL-696 amendment: an agent reply is markdown, and the Cursor Remote topic is
// read on a phone — so it goes out RENDERED (grids as monospace blocks,
// emphasis as HTML) rather than as raw pipes and asterisks.
export async function postChunks(
  token: string,
  chatId: string,
  topicId: number,
  text: string,
  replyToMessageId?: number,
  sendMessage: typeof sendTelegramMessageWithRateLimitRetry = sendTelegramMessageWithRateLimitRetry
): Promise<void> {
  for (const chunk of splitTelegramHtmlChunks(markdownToTelegramHtml(text))) {
    await postRenderedChunk(sendMessage, token, chatId, topicId, chunk, replyToMessageId);
  }
}

function reuseCursorTopicFromMap(state: CursorBridgePersistedState, topicId: number): CursorBridgePersistedState {
  return { ...state, cursorTopicId: topicId };
}

function reuseBubbleTopicFromMap(state: CursorBridgePersistedState, topicId: number): CursorBridgePersistedState {
  return { ...state, bubbleTopicId: topicId };
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

async function createBubbleTopic(
  token: string,
  chatId: string,
  topicMapPath: string,
  topicMap: Record<string, string>,
  state: CursorBridgePersistedState,
  createTopic: typeof createForumTopicWithRateLimitRetry
): Promise<CursorBridgePersistedState> {
  const created = await createTopic(token, chatId, BUBBLE_TOPIC_NAME);
  if (!created.success || created.messageThreadId === undefined) {
    throw new Error(created.error ?? 'createForumTopic failed');
  }
  const nextMap = { ...topicMap, [String(created.messageThreadId)]: BUBBLE_SUBJECT_ID };
  writeJsonFile(topicMapPath, nextMap);
  return { ...state, bubbleTopicId: created.messageThreadId };
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

export async function ensureBubbleTopic(
  token: string,
  chatId: string,
  topicMapPath: string,
  state: CursorBridgePersistedState,
  createTopic: typeof createForumTopicWithRateLimitRetry = createForumTopicWithRateLimitRetry
): Promise<CursorBridgePersistedState> {
  if (state.bubbleTopicId !== undefined) {
    return state;
  }
  const topicMap = loadTopicMap(topicMapPath);
  const action = decideEnsureBubbleTopicAction(topicMap);
  if (action.kind === 'reuse') {
    return reuseBubbleTopicFromMap(state, action.topicId);
  }
  return createBubbleTopic(token, chatId, topicMapPath, topicMap, state, createTopic);
}

export async function promptWithHeartbeat(
  opDir: string,
  promptAgent: (prompt: string | SDKUserMessage) => Promise<{ replyText: string; agentId: string }>,
  prompt: string | SDKUserMessage,
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
  /** BL-704: principal id for /oncall me. */
  principalUserId?: string;
  state: CursorBridgePersistedState;
  busy: boolean;
  agentSession: CursorBridgeAgentSessionDeps;
  opDir: string;
  post: PostChunksFn;
  persistState: () => void;
  syncAgentIdFromSession: () => void;
  /** Telegram transport seam for the liveness cue — never a real network call under test. */
  telegramPostFn?: TelegramPostFn;
}

export async function runPromptWithActiveRunRecovery(
  ctx: Pick<CursorBridgeHandlerContext, 'agentSession' | 'opDir' | 'syncAgentIdFromSession'>,
  prompt: string | SDKUserMessage,
  resetAgent: () => Promise<void>,
  onProgress?: (line: string) => void | Promise<void>
): Promise<string> {
  const runOnce = async (_text: string | SDKUserMessage): Promise<{ replyText: string; agentId: string }> =>
    withPromptProgress(onProgress, async () => {
      const result = await ctx.agentSession.promptAgent(prompt);
      ctx.syncAgentIdFromSession();
      return result;
    });
  try {
    return await promptWithHeartbeat(ctx.opDir, runOnce, prompt);
  } catch (err) {
    const detail = err instanceof CursorAgentError ? err.message : err instanceof Error ? err.message : String(err);
    if (!shouldResetCursorAgentSession(detail)) {
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

export function previewPromptForActiveRun(prompt: string | SDKUserMessage): string {
  if (typeof prompt === 'string') {
    return prompt;
  }
  const photoSuffix = prompt.images && prompt.images.length > 0 ? ` (+${prompt.images.length} photo)` : '';
  return `${prompt.text}${photoSuffix}`;
}

async function buildPhotoPromptMessage(
  ctx: CursorBridgeHandlerContext,
  text: string,
  photoFileIds: string[]
): Promise<SDKUserMessage> {
  const images = [];
  for (const fileId of photoFileIds) {
    images.push(await downloadTelegramPhotoAsSdkImage(ctx.botToken, fileId));
  }
  return { text: buildPhotoPromptText(text), images };
}

type ResolvedPrompt = { ok: true; message: string | SDKUserMessage } | { ok: false };

// A photo download that fails is reported in-topic and ends the turn; the
// caller must not start an agent run on a prompt whose image never arrived.
async function resolvePromptOrReport(
  ctx: CursorBridgeHandlerContext,
  topicId: number,
  promptText: string,
  replyToMessageId: number | undefined,
  photoFileIds: string[] | undefined
): Promise<ResolvedPrompt> {
  if (!photoFileIds || photoFileIds.length === 0) {
    return { ok: true, message: promptText };
  }
  try {
    await postInboundReply(ctx, topicId, '📷 Downloading photo…', undefined);
    return { ok: true, message: await buildPhotoPromptMessage(ctx, promptText, photoFileIds) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await postInboundReply(ctx, topicId, `Error: ${detail}`, replyToMessageId);
    return { ok: false };
  }
}

async function handlePromptInboundAction(
  ctx: CursorBridgeHandlerContext,
  topicId: number,
  promptText: string,
  replyToMessageId: number | undefined,
  resetAgent: () => Promise<void>,
  photoFileIds?: string[]
): Promise<boolean> {
  if (ctx.busy) {
    ctx.persistState();
  }
  const resolved = await resolvePromptOrReport(ctx, topicId, promptText, replyToMessageId, photoFileIds);
  if (!resolved.ok) {
    return ctx.busy;
  }
  const promptMessage = resolved.message;
  const localeSource = typeof promptMessage === 'string' ? promptMessage : promptMessage.text;
  beginActiveRun(
    previewPromptForActiveRun(promptMessage),
    detectProgressLocale(localeSource)
  );
  const reportProgress = createThrottledProgressReporter(TELEGRAM_PROGRESS_MIN_INTERVAL_MS, (line) => {
    recordActiveRunProgress(line);
    return postInboundReply(ctx, topicId, line, undefined);
  });
  void (async () => {
    try {
      const started =
        typeof promptMessage === 'string'
          ? '🚀 Agent started…'
          : '🚀 Agent started with photo…';
      await postInboundReply(ctx, topicId, started, undefined);
      const reply = await runPromptWithActiveRunRecovery(ctx, promptMessage, resetAgent, reportProgress);
      await postInboundReply(ctx, topicId, reply, replyToMessageId);
    } catch (err) {
      const detail = err instanceof CursorAgentError ? err.message : err instanceof Error ? err.message : String(err);
      await postInboundReply(ctx, topicId, `Error: ${detail}`, replyToMessageId);
    } finally {
      endActiveRun();
      await syncCursorBridgeLivenessStatus({
        botToken: ctx.botToken,
        chatId: ctx.chatId,
        state: ctx.state,
        busy: false,
        persistState: ctx.persistState,
        telegramPostFn: ctx.telegramPostFn,
      });
      await continueOperatorBatchAfterPrompt(ctx, topicId, resetAgent);
    }
  })();
  await syncCursorBridgeLivenessStatus({
    botToken: ctx.botToken,
    chatId: ctx.chatId,
    state: ctx.state,
    busy: true,
    persistState: ctx.persistState,
    telegramPostFn: ctx.telegramPostFn,
  });
  return true;
}

/** After a Cursor prompt finishes, advance autopilot/land and maybe ask land-sleep. */
async function continueOperatorBatchAfterPrompt(
  ctx: CursorBridgeHandlerContext,
  topicId: number,
  resetAgent: () => Promise<void>
): Promise<void> {
  const advanced = advanceOperatorBatch(ctx.repoRoot);
  if (advanced.nextTicket) {
    await postInboundReply(
      ctx,
      topicId,
      `Batch next: /pilot ${advanced.nextTicket}`,
      undefined
    );
    await handlePilotInboundAction(ctx, topicId, advanced.nextTicket, undefined, resetAgent, {
      skipSwarmLiveGate: true,
      skipHolidayGate: true,
      skipBatchGate: true,
    });
    return;
  }
  if (advanced.askLandSleep) {
    await postButtonReply(
      ctx,
      topicId,
      'Land queue clear. Drain-stop the swarm now?',
      landSleepButtons() as InlineKeyboardButton[][],
      undefined
    );
  }
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
    let text = formatStatusMessage(ctx.state, ctx.busy || isActiveRunInFlight());
    if ((ctx.state.pendingPrompts?.length ?? 0) > 0) {
      text += `\n\nQueued prompts:\n${queuePromptSummary(ctx.state)}`;
    }
    const expediteLock = readExpediteLock(ctx.repoRoot);
    if (expediteLock) {
      text += `\nExpedite: ${expediteLock.ticket} running (pid ${expediteLock.pid})`;
    }
    const redeployLock = readRedeployLock(ctx.repoRoot);
    if (redeployLock) {
      text += `\nRedeploy: running (pid ${redeployLock.pid})`;
    }
    const miniAppRedeployLock = readMiniAppRedeployLock(ctx.repoRoot);
    if (miniAppRedeployLock) {
      text += `\nMini app redeploy: running (pid ${miniAppRedeployLock.pid})`;
    }
    return handleSimpleInboundAction(ctx, topicId, text, replyTo);
  },
  update: (ctx, topicId) => {
    const text = formatUpdateMessage(
      collectUpdateSnapshot(ctx.repoRoot, ctx.busy || isActiveRunInFlight())
    );
    return handleSimpleInboundAction(ctx, topicId, text, undefined);
  },
  queue: (ctx, topicId, replyTo) =>
    handleSimpleInboundAction(ctx, topicId, queuePromptListForDisplay(ctx.state), replyTo),
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
    // Legacy decision shape; BL-702 routes /redeploy through execute-operator.
    const result = startRedeployRun(ctx.repoRoot);
    const text = result.ok ? formatRedeployStartMessage(result) : formatRedeployFailureMessage(result);
    await postInboundReply(ctx, topicId, text, replyTo);
    return false;
  },
  'redeploy-miniapp': async (ctx, topicId, replyTo) => {
    const result = startMiniAppRedeployRun(ctx.repoRoot);
    const text = result.ok ? formatMiniAppRedeployStartMessage(result) : formatMiniAppRedeployFailureMessage(result);
    await postInboundReply(ctx, topicId, text, replyTo);
    return false;
  },
};

async function postOperatorConfirmPrompt(
  ctx: CursorBridgeHandlerContext,
  topicId: number,
  tier: 'soft' | 'hard',
  verb: string,
  args: string | undefined,
  replyToMessageId: number | undefined
): Promise<void> {
  const text = formatOperatorConfirmPrompt(tier, verb, args);
  const buttons = operatorConfirmButtons() as InlineKeyboardButton[][];
  const sent = await sendTelegramMessage(
    ctx.botToken,
    ctx.chatId,
    text,
    replyToMessageId,
    undefined,
    topicId,
    buttons
  );
  if (!sent.success) {
    await postInboundReply(ctx, topicId, `${text}\n(Confirm buttons failed to send — use /confirm-off to cancel.)`, replyToMessageId);
  }
}

async function postButtonReply(
  ctx: CursorBridgeHandlerContext,
  topicId: number,
  text: string,
  buttons: InlineKeyboardButton[][],
  replyToMessageId: number | undefined
): Promise<void> {
  const sent = await sendTelegramMessage(
    ctx.botToken,
    ctx.chatId,
    text,
    replyToMessageId,
    undefined,
    topicId,
    buttons
  );
  if (!sent.success) {
    await postInboundReply(ctx, topicId, text, replyToMessageId);
  }
}

async function followOperatorExecuteResult(
  result: ReturnType<typeof executeOperatorVerb>,
  ctx: CursorBridgeHandlerContext,
  topicId: number,
  replyToMessageId: number | undefined,
  resetAgent: () => Promise<void>
): Promise<boolean> {
  await postInboundReply(ctx, topicId, result.text, replyToMessageId);
  if (result.awaitPipelineDrain) {
    const { outcome } = await awaitPipelineEmpty(ctx.repoRoot);
    const text =
      outcome === 'drained'
        ? 'drain-swarm: pipeline empty.'
        : 'drain-swarm: drain window elapsed with work still in flight (no kill).';
    await postInboundReply(ctx, topicId, text, replyToMessageId);
    return ctx.busy;
  }
  if (result.awaitDrainThenKill) {
    const { outcome } = await awaitPipelineEmpty(ctx.repoRoot);
    if (outcome === 'forced') {
      await postInboundReply(
        ctx,
        topicId,
        'Drain window elapsed with work still in flight - forcing teardown.',
        replyToMessageId
      );
    }
    const stopText = runOperatorStop(ctx.repoRoot);
    await postInboundReply(ctx, topicId, `Stop complete: ${outcome}.\n${stopText}`, replyToMessageId);
    return ctx.busy;
  }
  if (result.hydrateTarget && result.hydrateMode) {
    writeOperatorBatch(ctx.repoRoot, {
      mode: 'hydrate',
      queue: [],
      index: 0,
      hydrateTarget: result.hydrateTarget,
      hydrateMode: result.hydrateMode,
      startedAtMs: Date.now(),
    });
    return handlePromptInboundAction(
      ctx,
      topicId,
      composeHydratePrompt(result.hydrateTarget, result.hydrateMode),
      replyToMessageId,
      resetAgent
    );
  }
  if (result.pilotQueue && result.pilotQueue.length > 0) {
    const mode = result.askLandSleep ? 'land' : 'autopilot';
    writeOperatorBatch(ctx.repoRoot, {
      mode,
      queue: result.pilotQueue,
      index: 0,
      askLandSleep: result.askLandSleep,
      startedAtMs: Date.now(),
    });
    const first = result.pilotQueue[0];
    return handlePilotInboundAction(ctx, topicId, first, replyToMessageId, resetAgent, {
      skipBatchGate: true,
    });
  }
  if (result.askLandSleep) {
    await postButtonReply(
      ctx,
      topicId,
      'Land queue clear. Drain-stop the swarm now?',
      landSleepButtons() as InlineKeyboardButton[][],
      replyToMessageId
    );
  }
  return false;
}

async function handleOperatorGateDecision(
  decision: InboundDecision,
  ctx: CursorBridgeHandlerContext,
  topicId: number,
  replyToMessageId: number | undefined,
  resetAgent: () => Promise<void>
): Promise<boolean | undefined> {
  if (decision.action === 'prompt-operator-confirm') {
    const holiday = isHolidayQuietToday(readOperatorPolicy(ctx.repoRoot));
    if (holiday && isHolidayBlockedVerb(decision.verb)) {
      const cmd = decision.args ? `${decision.verb} ${decision.args}` : decision.verb;
      await postButtonReply(
        ctx,
        topicId,
        formatHolidayRefuse(holiday, cmd),
        runAnywayButtons(decision.verb, decision.args) as InlineKeyboardButton[][],
        replyToMessageId
      );
      return ctx.busy;
    }
    const confirmVerb = decision.verb.toLowerCase();
    if (confirmVerb === '/hydrate' || confirmVerb === '/mint') {
      const up = fullPackPipelineRolesUp(probeSwarmLiveness(ctx.repoRoot));
      if (up.length > 0) {
        await postInboundReply(ctx, topicId, formatFullPackRefuse(up, decision.verb), replyToMessageId);
        return ctx.busy;
      }
    }
    writePendingOperatorConfirm(ctx.repoRoot, {
      tier: decision.tier,
      verb: decision.verb,
      ...(decision.args ? { args: decision.args } : {}),
    });
    if (confirmVerb === '/stop') {
      await postButtonReply(
        ctx,
        topicId,
        formatOperatorStopModePrompt(),
        operatorStopModeButtons() as InlineKeyboardButton[][],
        replyToMessageId
      );
      return ctx.busy;
    }
    await postOperatorConfirmPrompt(
      ctx,
      topicId,
      decision.tier,
      decision.verb,
      decision.args,
      replyToMessageId
    );
    return ctx.busy;
  }
  if (decision.action === 'clear-operator-pending' || decision.action === 'cancel-operator-pending') {
    writePendingOperatorConfirm(ctx.repoRoot, undefined);
    const text =
      decision.action === 'clear-operator-pending'
        ? 'Pending confirm cleared (/confirm-off).'
        : 'Confirm cancelled.';
    await postInboundReply(ctx, topicId, text, replyToMessageId);
    return ctx.busy;
  }
  if (decision.action === 'execute-operator') {
    writePendingOperatorConfirm(ctx.repoRoot, undefined);
    const v = decision.verb.toLowerCase();
    const argsLower = (decision.args ?? '').toLowerCase();
    const exclusive =
      isBatchExclusiveVerb(decision.verb) &&
      !(v === '/autopilot' && argsLower.startsWith('dry')) &&
      !(v === '/land' && argsLower.startsWith('dry'));
    if (exclusive && isOperatorBatchInFlight(ctx.repoRoot)) {
      const batch = readOperatorBatch(ctx.repoRoot)!;
      await postInboundReply(ctx, topicId, formatBatchBusyRefuse(batch, decision.verb), replyToMessageId);
      return ctx.busy;
    }
    const snap = probeSwarmLiveness(ctx.repoRoot);
    if ((v === '/autopilot' || v === '/land') && !argsLower.startsWith('dry') && isSwarmLive(snap)) {
      await postButtonReply(
        ctx,
        topicId,
        formatSwarmLiveRefuse(snap, decision.verb),
        stopAndRunButtons(decision.verb, decision.args) as InlineKeyboardButton[][],
        replyToMessageId
      );
      return ctx.busy;
    }
    if (v === '/hydrate' || v === '/mint') {
      const up = fullPackPipelineRolesUp(snap);
      if (up.length > 0) {
        await postInboundReply(ctx, topicId, formatFullPackRefuse(up, decision.verb), replyToMessageId);
        return ctx.busy;
      }
    }
    const result = executeOperatorVerb(ctx.repoRoot, decision.verb, decision.args, {
      principalId: ctx.principalUserId,
    });
    return followOperatorExecuteResult(result, ctx, topicId, replyToMessageId, resetAgent);
  }
  if (decision.action === 'stop-and-run') {
    const stopText = runOperatorStop(ctx.repoRoot);
    await postInboundReply(
      ctx,
      topicId,
      `Stop & run: ${stopText}\nWaiting for swarm to go down…`,
      replyToMessageId
    );
    const drained = await awaitSwarmDrain(ctx.repoRoot, { timeoutMs: 90_000, pollMs: 1_000 });
    if (!drained.cleared) {
      await postInboundReply(
        ctx,
        topicId,
        'Stop & run: swarm still live after timeout — re-send the verb when clear, or /stop again.',
        replyToMessageId
      );
      return ctx.busy;
    }
    if (decision.verb === '/pilot') {
      const ticket = (decision.args ?? '').trim() || 'BL-696';
      return handlePilotInboundAction(ctx, topicId, ticket, replyToMessageId, resetAgent, {
        skipSwarmLiveGate: true,
      });
    }
    const result = executeOperatorVerb(ctx.repoRoot, decision.verb, decision.args, {
      principalId: ctx.principalUserId,
    });
    return followOperatorExecuteResult(result, ctx, topicId, replyToMessageId, resetAgent);
  }
  if (decision.action === 'run-anyway') {
    if (decision.verb === '/pilot') {
      const ticket = (decision.args ?? '').trim() || 'BL-696';
      return handlePilotInboundAction(ctx, topicId, ticket, replyToMessageId, resetAgent, {
        skipHolidayGate: true,
      });
    }
    if (decision.verb === '/expedite' || decision.verb === '/reexpedite') {
      const ticket = (decision.args ?? '').trim();
      if (!ticket) {
        await postInboundReply(ctx, topicId, `${decision.verb}: need a BL-xxx ticket.`, replyToMessageId);
        return ctx.busy;
      }
      const fake: ExpediteInboundDecision = {
        action: decision.verb === '/reexpedite' ? 'reexpedite' : 'expedite',
        ticket,
      };
      const result = startInboundExpedite(fake, ctx.repoRoot);
      await postInboundReply(ctx, topicId, formatInboundExpediteResult(fake, result), replyToMessageId);
      return false;
    }
    const result = executeOperatorVerb(ctx.repoRoot, decision.verb, decision.args, {
      principalId: ctx.principalUserId,
    });
    return followOperatorExecuteResult(result, ctx, topicId, replyToMessageId, resetAgent);
  }
  if (decision.action === 'land-sleep') {
    clearOperatorBatch(ctx.repoRoot);
    if (decision.answer === 'yes') {
      writeOperatorBounceSentinel(ctx.repoRoot, 'swarm');
      await postInboundReply(ctx, topicId, 'land: drain-stop requested (bounce sentinel written).', replyToMessageId);
    } else {
      await postInboundReply(ctx, topicId, 'land: leaving swarm up.', replyToMessageId);
    }
    return ctx.busy;
  }
  if (decision.action === 'stop-mode') {
    const pending = readPendingOperatorConfirm(ctx.repoRoot);
    if (!pending || pending.verb.toLowerCase() !== '/stop') {
      await postInboundReply(ctx, topicId, 'Stop mode ignored — no pending /stop.', replyToMessageId);
      return ctx.busy;
    }
    writePendingOperatorConfirm(ctx.repoRoot, undefined);
    const result = executeStopMode(ctx.repoRoot, decision.mode);
    return followOperatorExecuteResult(result, ctx, topicId, replyToMessageId, resetAgent);
  }
  return undefined;
}

async function handleDequeueInboundAction(
  ctx: CursorBridgeHandlerContext,
  topicId: number,
  position: number,
  replyToMessageId: number | undefined
): Promise<boolean> {
  const pending = ctx.state.pendingPrompts ?? [];
  if (pending.length === 0) {
    await postInboundReply(ctx, topicId, 'Queue is empty.', replyToMessageId);
    return ctx.busy;
  }
  const idx = position - 1;
  if (idx < 0 || idx >= pending.length) {
    await postInboundReply(ctx, topicId, `Invalid queue index ${position}. Use /queue to list available items.`, replyToMessageId);
    return ctx.busy;
  }
  const removed = pending[idx];
  const nextPending = pending.filter((_, itemIdx) => itemIdx !== idx);
  const currentPoll = ctx.state.pendingPromptPoll;
  const pollStillValid =
    currentPoll &&
    !currentPoll.itemIds.includes(removed.id) &&
    currentPoll.itemIds.some((id) => nextPending.some((item) => item.id === id));
  ctx.state.pendingPrompts = nextPending;
  ctx.state.pendingPromptPoll = pollStillValid ? currentPoll : undefined;
  ctx.persistState();
  await postInboundReply(ctx, topicId, `Dequeued #${position}: ${removed.text}`, replyToMessageId);
  return ctx.busy;
}

type ExpediteInboundDecision = Extract<InboundDecision, { action: 'expedite' | 'reexpedite' }>;

function startInboundExpedite(decision: ExpediteInboundDecision, repoRoot: string) {
  return decision.action === 'expedite'
    ? startExpediteRun(repoRoot, decision.ticket)
    : startReexpediteRun(repoRoot, decision.ticket);
}

function formatInboundExpediteResult(decision: ExpediteInboundDecision, result: ReturnType<typeof startExpediteRun>): string {
  if (!result.ok) {
    return formatExpediteFailureMessage(result);
  }
  return decision.action === 'expedite'
    ? formatExpediteStartMessage(result)
    : formatReexpediteStartMessage(result);
}

async function handleOperationalInboundAction(
  decision: InboundDecision,
  ctx: CursorBridgeHandlerContext,
  topicId: number,
  replyToMessageId: number | undefined
): Promise<boolean> {
  if (decision.action === 'expedite' || decision.action === 'reexpedite') {
    const holiday = isHolidayQuietToday(readOperatorPolicy(ctx.repoRoot));
    if (holiday) {
      await postButtonReply(
        ctx,
        topicId,
        formatHolidayRefuse(holiday, `/${decision.action} ${decision.ticket}`),
        runAnywayButtons(`/${decision.action}`, decision.ticket) as InlineKeyboardButton[][],
        replyToMessageId
      );
      return ctx.busy;
    }
    if (isOperatorBatchInFlight(ctx.repoRoot)) {
      const batch = readOperatorBatch(ctx.repoRoot)!;
      await postInboundReply(
        ctx,
        topicId,
        formatBatchBusyRefuse(batch, `/${decision.action}`),
        replyToMessageId
      );
      return ctx.busy;
    }
    const result = startInboundExpedite(decision, ctx.repoRoot);
    const text = formatInboundExpediteResult(decision, result);
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

async function handlePilotInboundAction(
  ctx: CursorBridgeHandlerContext,
  topicId: number,
  ticket: string,
  replyToMessageId: number | undefined,
  resetAgent: () => Promise<void>,
  opts?: { skipSwarmLiveGate?: boolean; skipHolidayGate?: boolean; skipBatchGate?: boolean }
): Promise<boolean> {
  if (!opts?.skipBatchGate && isOperatorBatchInFlight(ctx.repoRoot)) {
    const batch = readOperatorBatch(ctx.repoRoot)!;
    await postInboundReply(ctx, topicId, formatBatchBusyRefuse(batch, `/pilot ${ticket}`), replyToMessageId);
    return ctx.busy;
  }
  if (!opts?.skipHolidayGate) {
    const holiday = isHolidayQuietToday(readOperatorPolicy(ctx.repoRoot));
    if (holiday) {
      await postButtonReply(
        ctx,
        topicId,
        formatHolidayRefuse(holiday, `/pilot ${ticket}`),
        runAnywayButtons('/pilot', ticket) as InlineKeyboardButton[][],
        replyToMessageId
      );
      return ctx.busy;
    }
  }
  if (!opts?.skipSwarmLiveGate) {
    const snap = probeSwarmLiveness(ctx.repoRoot);
    if (isSwarmLive(snap)) {
      const detail = snap.roles.map((r) => r.role).join(', ');
      await postButtonReply(
        ctx,
        topicId,
        formatPilotBlockedBySwarmLiveMessage(ticket, detail),
        stopAndRunButtons('/pilot', ticket) as InlineKeyboardButton[][],
        replyToMessageId
      );
      return ctx.busy;
    }
  }
  const gate = gatePilotAgainstExpediteLock(ctx.repoRoot);
  if (!gate.ok) {
    await postInboundReply(
      ctx,
      topicId,
      formatPilotBlockedByExpediteMessage(ticket, gate.detail),
      replyToMessageId
    );
    return ctx.busy;
  }
  await postInboundReply(ctx, topicId, formatPilotStartMessage(ticket), replyToMessageId);
  return handlePromptInboundAction(ctx, topicId, composePilotExpeditorPrompt(ticket), replyToMessageId, resetAgent);
}

export async function handleInboundDecision(
  decision: InboundDecision,
  ctx: CursorBridgeHandlerContext,
  replyToMessageId: number | undefined,
  resetAgent: () => Promise<void>,
  replyTopicId?: number
): Promise<boolean> {
  const topicId = replyTopicId ?? ctx.state.cursorTopicId;
  if (decision.action === 'ignore') {
    return ctx.busy;
  }
  if (topicId === undefined) {
    return ctx.busy;
  }
  const operatorHandled = await handleOperatorGateDecision(decision, ctx, topicId, replyToMessageId, resetAgent);
  if (operatorHandled !== undefined) {
    return operatorHandled;
  }
  const handler = INBOUND_ACTION_HANDLERS[decision.action];
  if (handler) {
    return handler(ctx, topicId, replyToMessageId, resetAgent);
  }
  if (decision.action === 'prompt') {
    return handlePromptInboundAction(
      ctx,
      topicId,
      decision.text,
      replyToMessageId,
      resetAgent,
      decision.photoFileIds
    );
  }
  if (decision.action === 'pilot') {
    return handlePilotInboundAction(ctx, topicId, decision.ticket, replyToMessageId, resetAgent);
  }
  if (decision.action === 'dequeue') {
    return handleDequeueInboundAction(ctx, topicId, decision.position, replyToMessageId);
  }
  return handleOperationalInboundAction(decision, ctx, topicId, replyToMessageId);
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
  /**
   * When true (shared-token / dual-poller mode), drain `.swarmforge/operator/cursor-bridge-inbound.jsonl`
   * written by the front desk instead of calling Telegram getUpdates.
   */
  useInboundQueue?: boolean;
  /** Idle wait when the inbound queue is empty (default 1000ms). */
  inboundQueueIdleMs?: number;
  onPollFailure?: (failures: number) => Promise<void>;
  post?: PostChunksFn;
  /** Telegram transport seam for the liveness cue — never a real network call under test. */
  telegramPostFn?: TelegramPostFn;
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

function hasQueueablePromptDecision(decision: InboundDecision): decision is Extract<InboundDecision, { action: 'prompt' }> {
  return decision.action === 'prompt';
}

async function postQueueSelectionPoll(
  deps: CursorBridgeLoopDeps,
  holder: { state: CursorBridgePersistedState },
  post: PostChunksFn
): Promise<void> {
  const topicId = holder.state.cursorTopicId;
  const pending = holder.state.pendingPrompts ?? [];
  if (topicId === undefined || pending.length === 0 || holder.state.pendingPromptPoll) {
    return;
  }
  const items = pending.slice(0, QUEUE_POLL_MAX_OPTIONS);
  const question =
    pending.length > QUEUE_POLL_MAX_OPTIONS
      ? `Bridge ready: choose next queued question (${pending.length} total, showing first ${QUEUE_POLL_MAX_OPTIONS})`
      : `Bridge ready: choose next queued question (${pending.length} queued)`;
  const options = items.map((item, idx) => queuePromptOptionLabel(item, idx));
  const sent = await sendTelegramPoll(deps.botToken, deps.chatId, question, options, topicId);
  if (!sent.success || !sent.pollId) {
    await post(deps.botToken, deps.chatId, topicId, `Queue pending (${pending.length}) but poll failed.\n${queuePromptSummary(holder.state)}`);
    return;
  }
  holder.state = {
    ...holder.state,
    pendingPromptPoll: {
      pollId: sent.pollId,
      itemIds: items.map((item) => item.id),
    },
  };
  writeJsonFile(deps.statePath, holder.state);
}

async function processQueuedPollAnswer(
  deps: CursorBridgeLoopDeps,
  holder: { state: CursorBridgePersistedState; busy: boolean },
  pollAnswer: TelegramPollAnswer,
  handlerCtx: ReturnType<typeof makePollHandlerContext>
): Promise<void> {
  const pendingPoll = holder.state.pendingPromptPoll;
  if (!pendingPoll || pollAnswer.poll_id !== pendingPoll.pollId) {
    return;
  }
  if (!isAuthorizedPrincipal(pollAnswer.user?.id ?? '', deps.principalUserId)) {
    return;
  }
  const selectedIndex = pollAnswer.option_ids?.[0];
  if (typeof selectedIndex !== 'number' || selectedIndex < 0 || selectedIndex >= pendingPoll.itemIds.length) {
    return;
  }
  const selectedId = pendingPoll.itemIds[selectedIndex];
  const pending = holder.state.pendingPrompts ?? [];
  const selected = pending.find((item) => item.id === selectedId);
  holder.state = { ...holder.state, pendingPromptPoll: undefined };
  if (!selected) {
    writeJsonFile(deps.statePath, holder.state);
    return;
  }
  if (holder.busy || isActiveRunInFlight()) {
    writeJsonFile(deps.statePath, holder.state);
    return;
  }
  holder.state = {
    ...holder.state,
    pendingPrompts: pending.filter((item) => item.id !== selected.id),
  };
  writeJsonFile(deps.statePath, holder.state);
  holder.busy = await handleInboundDecision(
    { action: 'prompt', text: selected.text, ...(selected.photoFileIds ? { photoFileIds: selected.photoFileIds } : {}) },
    {
      repoRoot: deps.repoRoot,
      botToken: deps.botToken,
      chatId: deps.chatId,
      state: holder.state,
      busy: true,
      agentSession: deps.agentSession,
      opDir: deps.opDir,
      post: handlerCtx.post,
      persistState: handlerCtx.persistState,
      syncAgentIdFromSession: handlerCtx.syncAgentIdFromSession,
      telegramPostFn: deps.telegramPostFn,
    },
    selected.replyToMessageId,
    handlerCtx.resetAgent
  );
}

function choicePromptFromPoll(poll: CursorBridgeChoicePoll, selectedIndex: number): string {
  const selected = poll.options[selectedIndex];
  return [
    `For your question: ${poll.question}`,
    `I choose option ${selectedIndex + 1}: ${selected}`,
    'Proceed using this choice.',
  ].join('\n');
}

async function processChoicePollAnswer(
  deps: CursorBridgeLoopDeps,
  holder: { state: CursorBridgePersistedState; busy: boolean },
  pollAnswer: TelegramPollAnswer,
  handlerCtx: ReturnType<typeof makePollHandlerContext>
): Promise<void> {
  const polls = holder.state.pendingChoicePolls ?? [];
  const poll = polls.find((item) => item.pollId === pollAnswer.poll_id);
  if (!poll) {
    return;
  }
  if (!isAuthorizedPrincipal(pollAnswer.user?.id ?? '', deps.principalUserId)) {
    return;
  }
  const selectedIndex = pollAnswer.option_ids?.[0];
  if (typeof selectedIndex !== 'number' || selectedIndex < 0 || selectedIndex >= poll.options.length) {
    return;
  }
  holder.state = {
    ...holder.state,
    pendingChoicePolls: polls.filter((item) => item.pollId !== poll.pollId),
  };
  writeJsonFile(deps.statePath, holder.state);
  if (holder.busy || isActiveRunInFlight()) {
    holder.state = clearQueuedPollIfStale(
      pushQueuedPrompt(holder.state, choicePromptFromPoll(poll, selectedIndex), undefined, undefined, Date.now())
    );
    writeJsonFile(deps.statePath, holder.state);
    return;
  }
  holder.busy = await handleInboundDecision(
    { action: 'prompt', text: choicePromptFromPoll(poll, selectedIndex) },
    {
      repoRoot: deps.repoRoot,
      botToken: deps.botToken,
      chatId: deps.chatId,
      state: holder.state,
      busy: true,
      agentSession: deps.agentSession,
      opDir: deps.opDir,
      post: handlerCtx.post,
      persistState: handlerCtx.persistState,
      syncAgentIdFromSession: handlerCtx.syncAgentIdFromSession,
      telegramPostFn: deps.telegramPostFn,
    },
    undefined,
    handlerCtx.resetAgent,
    holder.state.bubbleTopicId ?? holder.state.cursorTopicId
  );
}

async function processInboundUpdates(
  deps: CursorBridgeLoopDeps,
  updates: TelegramUpdate[],
  holder: { state: CursorBridgePersistedState; busy: boolean },
  handlerCtx: ReturnType<typeof makePollHandlerContext>
): Promise<void> {
  for (const update of updates) {
    if (update.poll_answer) {
      await processQueuedPollAnswer(deps, holder, update.poll_answer, handlerCtx);
      await processChoicePollAnswer(deps, holder, update.poll_answer, handlerCtx);
      continue;
    }
    const inbound = inboundEventOf(update);
    if (!inbound) {
      continue;
    }
    const pending = readPendingOperatorConfirm(deps.repoRoot);
    const rawDecision = decideInboundAction(
      inbound,
      deps.principalUserId,
      deps.chatId,
      {
        cursorTopicId: holder.state.cursorTopicId,
        bubbleTopicId: holder.state.bubbleTopicId,
      },
      pending
    );
    if (inbound.kind === 'callback' && inbound.callbackQueryId) {
      await answerCallbackQuery(deps.botToken, inbound.callbackQueryId);
    }
    const bridgeBusy = holder.busy || isActiveRunInFlight();
    if (bridgeBusy && hasQueueablePromptDecision(rawDecision)) {
      holder.state = clearQueuedPollIfStale(
        pushQueuedPrompt(holder.state, rawDecision.text, rawDecision.photoFileIds, inbound.messageId, Date.now())
      );
      writeJsonFile(deps.statePath, holder.state);
      const queueAckTopicId = inbound.topicId ?? holder.state.cursorTopicId;
      if (queueAckTopicId !== undefined) {
        await handlerCtx.post(
          deps.botToken,
          deps.chatId,
          queueAckTopicId,
          `Busy — question queued (${holder.state.pendingPrompts?.length ?? 0} waiting). I will ask you to pick one when ready.`,
          inbound.messageId
        );
      }
      await syncCursorBridgeLivenessStatus({
        botToken: deps.botToken,
        chatId: deps.chatId,
        state: holder.state,
        busy: true,
        persistState: () => writeJsonFile(deps.statePath, holder.state),
        telegramPostFn: deps.telegramPostFn,
      });
      continue;
    }
    const decision = gateBusy(rawDecision, bridgeBusy);
    const ctxBusy = decision.action === 'prompt' ? true : holder.busy;
    holder.busy = await handleInboundDecision(
      decision,
      {
        repoRoot: deps.repoRoot,
        botToken: deps.botToken,
        chatId: deps.chatId,
        principalUserId: deps.principalUserId,
        state: holder.state,
        busy: ctxBusy,
        agentSession: deps.agentSession,
        opDir: deps.opDir,
        post: handlerCtx.post,
        persistState: handlerCtx.persistState,
        syncAgentIdFromSession: handlerCtx.syncAgentIdFromSession,
        telegramPostFn: deps.telegramPostFn,
      },
      inbound.messageId,
      handlerCtx.resetAgent,
      inbound.topicId
    );
  }
  holder.state = clearQueuedPollIfStale(holder.state);
  if (!holder.busy && !isActiveRunInFlight()) {
    await postQueueSelectionPoll(deps, holder, handlerCtx.post);
  }
  await syncCursorBridgeLivenessStatus({
    botToken: deps.botToken,
    chatId: deps.chatId,
    state: holder.state,
    busy: holder.busy || isActiveRunInFlight(),
    persistState: () => writeJsonFile(deps.statePath, holder.state),
    telegramPostFn: deps.telegramPostFn,
  });
}

export async function runCursorBridgePollOnce(
  deps: CursorBridgeLoopDeps,
  state: CursorBridgePersistedState,
  busy: boolean,
  pollFailures: number
): Promise<{ state: CursorBridgePersistedState; busy: boolean; pollFailures: number }> {
  let updates: TelegramUpdate[];
  let nextOffset = state.updateOffset;

  if (deps.useInboundQueue) {
    const drained = drainCursorBridgeInboundUpdates(deps.opDir);
    updates = drained as TelegramUpdate[];
    if (updates.length === 0) {
      await sleep(deps.inboundQueueIdleMs ?? 1000);
    } else {
      const maxId = Math.max(...updates.map((u) => u.update_id));
      nextOffset = Math.max(state.updateOffset, maxId + 1);
    }
  } else {
    const getUpdates = deps.getUpdates ?? getTelegramUpdates;
    const timeout =
      busy || isActiveRunInFlight()
        ? BUSY_POLL_TIMEOUT_SECONDS
        : (deps.pollTimeoutSeconds ?? POLL_TIMEOUT_SECONDS);
    const poll = await getUpdates(deps.botToken, state.updateOffset, timeout);
    if (!poll.success) {
      await handleFailedPoll(deps, pollFailures);
      return { state, busy, pollFailures: pollFailures + 1 };
    }
    updates = poll.updates;
    nextOffset = nextUpdateOffset(poll.updates, state.updateOffset);
  }

  const freshest = parseCursorBridgeState(loadJsonFile(deps.statePath));
  const holder = {
    state: {
      ...state,
      ...(freshest.pendingChoicePolls ? { pendingChoicePolls: freshest.pendingChoicePolls } : {}),
      updateOffset: nextOffset,
    },
    busy,
  };
  writeJsonFile(deps.statePath, holder.state);
  writePollHeartbeat(deps.opDir);

  await processInboundUpdates(deps, updates, holder, makePollHandlerContext(deps, holder));

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
  /** Telegram transport seam for the liveness cue — never a real network call under test. */
  telegramPostFn?: TelegramPostFn;
}

export async function runCursorBridgeBootIfConfigured(
  env: Pick<CursorBridgeCliEnv, 'bootPrompt' | 'botToken' | 'chatId' | 'post' | 'telegramPostFn'>,
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
      telegramPostFn: env.telegramPostFn,
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
    if (!isActiveRunInFlight()) {
      busy = false;
    }
    const next = await runCursorBridgePollOnce(loopDeps, state, busy, pollFailures);
    state = next.state;
    busy = next.busy || isActiveRunInFlight();
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
  const post = env.post ?? postChunks;

  // One startup signal per process spawn so Telegram users know a bounce completed.
  if (state.cursorTopicId !== undefined) {
    try {
      await post(env.botToken, env.chatId, state.cursorTopicId, BRIDGE_READY_MESSAGE);
    } catch {
      // Startup announce is best-effort; keep the bridge running if Telegram is transiently unavailable.
    }
    try {
      await syncCursorBridgeLivenessStatus({
        botToken: env.botToken,
        chatId: env.chatId,
        state,
        busy: false,
        persistState: () => writeJsonFile(statePath, state),
        telegramPostFn: env.telegramPostFn,
      });
    } catch {
      // Liveness line is best-effort at boot.
    }
  }

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
    // Shared-token mode: front desk owns getUpdates; we drain its inbound queue.
    // Default is queue when CURSOR_BRIDGE_BOT_TOKEN is unset — never steal updates
    // if someone launches the CLI without start_cursor_bridge.sh.
    useInboundQueue: shouldUseCursorBridgeInboundQueue(process.env),
    telegramPostFn: env.telegramPostFn,
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
  state = await ensureBubbleTopic(botToken, chatId, topicMapPath, state);
  writeJsonFile(statePath, state);
  return state;
}
