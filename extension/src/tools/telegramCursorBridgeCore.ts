// Pure decision logic for the Telegram ↔ Cursor SDK remote-control bridge.
// Mirrors telegramControlCore.ts: guards, command parse, chunking, and state
// shape live here with no I/O; telegram-cursor-bridge.ts wires Telegram and
// the Cursor SDK around these decisions.

import { topicForSubject } from './telegramTopicDecisions';
import { buildPhotoPromptText } from '../bridge/cursorBridgeTelegramMedia';
import { parseExpediteTicket, parseReexpediteTicket } from './telegramCursorBridgeExpedite';
import { parsePilotTicket, parsePilotSafeCommand } from './telegramCursorBridgePilot';
import { parseRedeployCommand } from './telegramCursorBridgeRedeploy';
import { parseMiniAppRedeployCommand } from './telegramCursorBridgeMiniAppRedeploy';
import { parseLogCommand, type LogTarget } from './telegramCursorBridgeLogs';
import {
  decideOperatorConfirmCallback,
  decideOperatorVerbConfirm,
  decideOperatorSpecialCallback,
  operatorDangerTier,
  type PendingOperatorConfirm,
} from './telegramCursorOperatorCore';

export const CURSOR_BRIDGE_SUBJECT_ID = 'CURSOR_REMOTE';
export const CURSOR_BRIDGE_TOPIC_NAME = 'Cursor Remote';
/** Standing Telegram topic for Float Companion / Let's Talk discussion mirror. */
export const BUBBLE_SUBJECT_ID = 'BUBBLE';
export const BUBBLE_TOPIC_NAME = 'Bubble';
export const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

export interface CursorBridgeQueuedPrompt {
  id: string;
  text: string;
  photoFileIds?: string[];
  replyToMessageId?: number;
  originTopicId?: number;
  createdAtMs: number;
}

export interface CursorBridgeQueuedPromptPoll {
  pollId: string;
  itemIds: string[];
  clearAllOptionIndex?: number;
}

export type QueuedPollAnswerAction =
  | { kind: 'ignore' }
  | { kind: 'clear-all' }
  | { kind: 'select'; itemId: string };

/**
 * BL-811 D1: a vote retraction sends option_ids: [], so selectedIndex is
 * undefined. A poll persisted by a pre-hotfix build has no
 * clearAllOptionIndex field either (also undefined) - clearAllOptionIndex
 * must be a real number match, never an undefined === undefined coincidence,
 * or a retraction against a legacy poll silently wipes the whole queue.
 */
export function decideQueuedPollAnswerAction(
  pendingPoll: CursorBridgeQueuedPromptPoll,
  selectedIndex: number | undefined
): QueuedPollAnswerAction {
  if (typeof selectedIndex === 'number' && selectedIndex >= 0 && selectedIndex < pendingPoll.itemIds.length) {
    return { kind: 'select', itemId: pendingPoll.itemIds[selectedIndex] };
  }
  if (typeof pendingPoll.clearAllOptionIndex === 'number' && selectedIndex === pendingPoll.clearAllOptionIndex) {
    return { kind: 'clear-all' };
  }
  return { kind: 'ignore' };
}

export interface CursorBridgeChoicePoll {
  pollId: string;
  question: string;
  options: string[];
  createdAtMs: number;
  originTopicId?: number;
}

export interface CursorBridgeLivenessStatusState {
  topicId?: number;
  messageId?: number;
  renderedText?: string;
}

export interface CursorBridgePersistedState {
  updateOffset: number;
  cursorTopicId?: number;
  /** Standing Bubble topic — Let's Talk / companion discussion mirror (not Cursor Remote). */
  bubbleTopicId?: number;
  agentId?: string;
  pendingPrompts?: CursorBridgeQueuedPrompt[];
  pendingPromptPoll?: CursorBridgeQueuedPromptPoll;
  /** BL-894: the most recently replaced queue poll's id, so a vote arriving after it was superseded gets told so instead of vanishing in silence. */
  supersededPromptPollId?: string;
  pendingChoicePolls?: CursorBridgeChoicePoll[];
  /** Edit-in-place Host liveness line identity. */
  livenessStatus?: CursorBridgeLivenessStatusState;
  /**
   * BL-767: per-topic "N waiting" edit-in-place cue identity, keyed by
   * topic id (stringified — JSON object keys), for every topic OTHER than
   * cursorTopicId that currently holds (or recently held) queued work.
   */
  queuedWorkLivenessStatus?: Record<string, CursorBridgeLivenessStatusState>;
}

export interface CursorBridgeInboundEvent {
  fromId: string | number;
  chatId: string | number;
  topicId: number | undefined;
  text: string;
  photoFileId?: string;
  /** BL-702: inline Confirm / Cancel taps on Cursor Remote. */
  kind?: 'text' | 'callback';
  callbackData?: string;
  callbackQueryId?: string;
}

export type CursorBridgeDecision =
  | { action: 'ignore' }
  | { action: 'refuse' }
  | { action: 'new-session' }
  | { action: 'status' }
  | { action: 'queue' }
  | { action: 'dequeue'; position: number }
  | { action: 'update' }
  | { action: 'help' }
  | { action: 'expedite'; ticket: string }
  | { action: 'reexpedite'; ticket: string }
  | { action: 'pilot'; ticket: string }
  | { action: 'pilot-safe-start' }
  | { action: 'pilot-safe-list' }
  | { action: 'redeploy' }
  | { action: 'redeploy-miniapp' }
  | { action: 'log'; target: LogTarget }
  | { action: 'prompt'; text: string; photoFileIds?: string[] }
  | { action: 'busy' }
  | { action: 'prompt-operator-confirm'; tier: 'soft' | 'hard'; verb: string; args?: string }
  | { action: 'clear-operator-pending' }
  | { action: 'cancel-operator-pending' }
  | { action: 'execute-operator'; verb: string; args?: string }
  | { action: 'stop-and-run'; verb: string; args?: string }
  | { action: 'run-anyway'; verb: string; args?: string }
  | { action: 'land-sleep'; answer: 'yes' | 'no' }
  | { action: 'stop-mode'; mode: 'drain' | 'emergency' };

export type EnsureCursorTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

export interface PollBackoffConfig {
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_POLL_BACKOFF: PollBackoffConfig = {
  baseMs: 1000,
  maxMs: 60_000,
};

/** Refresh supervisor heartbeat during long Cursor agent runs (poll loop is blocked). */
export const AGENT_RUN_HEARTBEAT_INTERVAL_MS = 30_000;

type AssistantStreamMessage = {
  type?: string;
  message?: { content?: Array<{ type?: string; text?: string }> } | string;
};

export function decideEnsureCursorTopicAction(topicMap: Record<string, string>): EnsureCursorTopicAction {
  const existingTopicId = topicForSubject(topicMap, CURSOR_BRIDGE_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

export function decideEnsureBubbleTopicAction(topicMap: Record<string, string>): EnsureCursorTopicAction {
  const existingTopicId = topicForSubject(topicMap, BUBBLE_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

export function cursorBridgeTopicIdFromMap(topicMap: Record<string, string>): number | undefined {
  return topicForSubject(topicMap, CURSOR_BRIDGE_SUBJECT_ID);
}

export function bubbleTopicIdFromMap(topicMap: Record<string, string>): number | undefined {
  return topicForSubject(topicMap, BUBBLE_SUBJECT_ID);
}

/** Topics the Host / Bubble bridge owns. Live passes this bag into decideInboundAction. */
export type CursorBridgeTopicScope = {
  cursorTopicId?: number;
  bubbleTopicId?: number;
};

export function normalizeCursorBridgeTopicScope(
  topics: CursorBridgeTopicScope | number | undefined
): CursorBridgeTopicScope {
  if (topics === undefined || topics === null) {
    return {};
  }
  if (typeof topics === 'number') {
    return { cursorTopicId: topics };
  }
  return {
    ...(typeof topics.cursorTopicId === 'number' ? { cursorTopicId: topics.cursorTopicId } : {}),
    ...(typeof topics.bubbleTopicId === 'number' ? { bubbleTopicId: topics.bubbleTopicId } : {}),
  };
}

export function isCursorBridgeTopic(topicId: number | undefined, cursorBridgeTopicId: number | undefined): boolean {
  return cursorBridgeTopicId !== undefined && topicId === cursorBridgeTopicId;
}

export function isOwnedCursorBridgeTopic(
  topicId: number | undefined,
  topics: CursorBridgeTopicScope | number | undefined
): boolean {
  if (topicId === undefined) {
    return false;
  }
  const scope = normalizeCursorBridgeTopicScope(topics);
  return topicId === scope.cursorTopicId || topicId === scope.bubbleTopicId;
}

// The front desk and cursor bridge share one Telegram forum chat but use
// separate topic-map files — strip any stale SUP binding on the cursor
// topic so the concierge never routes or replies there.
export function frontDeskTopicMapWithoutCursorBridge(
  topicMap: Record<string, string>,
  cursorBridgeTopicId: number | undefined,
  extraTopicIds: Array<number | undefined> = []
): Record<string, string> {
  const stripKeys = new Set(
    [cursorBridgeTopicId, ...extraTopicIds].filter((id): id is number => typeof id === 'number').map(String)
  );
  const matchedKeys = Object.keys(topicMap).filter((key) => stripKeys.has(key));
  if (matchedKeys.length === 0) {
    return topicMap;
  }
  const next = { ...topicMap };
  for (const key of matchedKeys) {
    delete next[key];
  }
  return next;
}

export function parseCommand(text: string): 'new' | 'status' | 'help' | 'update' | 'queue' | undefined {
  const lower = text.trim().toLowerCase();
  if (lower === '/new') {
    return 'new';
  }
  if (lower === '/status') {
    return 'status';
  }
  if (lower === '/update') {
    return 'update';
  }
  if (lower === '/help') {
    return 'help';
  }
  if (lower === '/queue') {
    return 'queue';
  }
  return undefined;
}

/** CLI argv after `node` + script path (i.e. `process.argv.slice(2)`). */
export type CursorBridgeCliParse =
  | { kind: 'help' }
  | { kind: 'run'; repoRootArg: string | undefined };

/**
 * Parse Host/Cursor Remote bridge CLI args. `--help` / `-h` must never be
 * treated as a repo root — that used to start a second getUpdates poller.
 */
export function parseCursorBridgeCliArgs(argvTail: string[]): CursorBridgeCliParse {
  const args = argvTail ?? [];
  if (args.some((a) => a === '--help' || a === '-h')) {
    return { kind: 'help' };
  }
  const repoRootArg = args.find((a) => a.length > 0 && !a.startsWith('-'));
  return { kind: 'run', repoRootArg };
}

export const CURSOR_BRIDGE_CLI_USAGE =
  'Usage: node telegram-cursor-bridge.js <repo-root>\n' +
  'Telegram ↔ Cursor SDK remote control. Prefer start_cursor_bridge.sh.\n' +
  'Shared TELEGRAM_BOT_TOKEN with front desk: drains inbound queue (no getUpdates).\n';

/**
 * When the Host bridge shares the front-desk bot token it must not call
 * getUpdates. Default to inbound-queue mode unless an exclusive
 * CURSOR_BRIDGE_BOT_TOKEN is configured (or the flag explicitly forces).
 */
export function shouldUseCursorBridgeInboundQueue(env: {
  CURSOR_BRIDGE_INBOUND_QUEUE?: string;
  CURSOR_BRIDGE_BOT_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
}): boolean {
  const flag = env.CURSOR_BRIDGE_INBOUND_QUEUE?.trim();
  if (flag === '1') {
    return true;
  }
  if (flag === '0') {
    return false;
  }
  if (env.CURSOR_BRIDGE_BOT_TOKEN?.trim()) {
    return false;
  }
  return true;
}

function decideCommandAction(cmd: 'new' | 'status' | 'help' | 'update' | 'queue'): CursorBridgeDecision {
  if (cmd === 'new') {
    return { action: 'new-session' };
  }
  if (cmd === 'status') {
    return { action: 'status' };
  }
  if (cmd === 'update') {
    return { action: 'update' };
  }
  if (cmd === 'queue') {
    return { action: 'queue' };
  }
  return { action: 'help' };
}

function parseDequeuePosition(text: string): number | undefined {
  const match = text.trim().match(/^\/dequeue\s+(\d+)$/i);
  if (!match) {
    return undefined;
  }
  const position = Number.parseInt(match[1], 10);
  return Number.isFinite(position) && position > 0 ? position : undefined;
}

// BL-722 CRAP split: isolates the pilot-safe kind->action mapping so
// decideOperatorCommand's own branch count stays at the CRAP <= 6 gate.
function pilotSafeDecision(pilotSafe: NonNullable<ReturnType<typeof parsePilotSafeCommand>>): CursorBridgeDecision {
  return { action: pilotSafe.kind === 'list' ? 'pilot-safe-list' : 'pilot-safe-start' };
}

function decideOperatorCommand(text: string): CursorBridgeDecision | undefined {
  // BL-702: /redeploy is gated via operator soft confirm (not fire-and-forget).
  const logTarget = parseLogCommand(text);
  if (logTarget) {
    return { action: 'log', target: logTarget };
  }
  const pilotSafe = parsePilotSafeCommand(text);
  if (pilotSafe) {
    return pilotSafeDecision(pilotSafe);
  }
  const pilotTicket = parsePilotTicket(text);
  if (pilotTicket) {
    return { action: 'pilot', ticket: pilotTicket };
  }
  const reexpediteTicket = parseReexpediteTicket(text);
  if (reexpediteTicket) {
    return { action: 'reexpedite', ticket: reexpediteTicket };
  }
  const expediteTicket = parseExpediteTicket(text);
  return expediteTicket ? { action: 'expedite', ticket: expediteTicket } : undefined;
}

function mapOperatorConfirmDecision(
  decision: ReturnType<typeof decideOperatorVerbConfirm>
): CursorBridgeDecision | undefined {
  switch (decision.action) {
    case 'ignore':
      return undefined;
    case 'execute':
      return { action: 'execute-operator', verb: decision.verb, args: decision.args };
    case 'prompt-confirm':
      return {
        action: 'prompt-operator-confirm',
        tier: decision.tier,
        verb: decision.verb,
        args: decision.args,
      };
    case 'clear-pending':
      return { action: 'clear-operator-pending' };
    case 'cancel-pending':
      return { action: 'cancel-operator-pending' };
    default:
      return undefined;
  }
}

function decideGatedOperatorVerb(
  text: string,
  pending: PendingOperatorConfirm
): CursorBridgeDecision | undefined {
  const trimmed = text.trim();
  const base = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
  // Keep pilot/expedite/log on their existing dedicated actions.
  if (
    base === '/pilot' ||
    base === '/expedite' ||
    base === '/reexpedite' ||
    base === '/log' ||
    base === '/status' ||
    base === '/help' ||
    base === '/update' ||
    base === '/new' ||
    base === '/queue' ||
    base === '/dequeue'
  ) {
    return undefined;
  }
  // Miniapp redeploy: treat as soft /redeploy with args for confirm+exec.
  if (parseMiniAppRedeployCommand(trimmed)) {
    return mapOperatorConfirmDecision(decideOperatorVerbConfirm('/redeploy miniapp', pending));
  }
  if (parseRedeployCommand(trimmed) || operatorDangerTier(trimmed) !== undefined) {
    return mapOperatorConfirmDecision(decideOperatorVerbConfirm(trimmed, pending));
  }
  return undefined;
}

export function isScopedToCursorTopic(
  event: Pick<CursorBridgeInboundEvent, 'chatId' | 'topicId'>,
  chatId: string | number,
  cursorTopicId: CursorBridgeTopicScope | number | undefined
): boolean {
  return (
    String(event.chatId) === String(chatId) && isOwnedCursorBridgeTopic(event.topicId, cursorTopicId)
  );
}

export function isAuthorizedPrincipal(fromId: string | number, principalUserId: string | number): boolean {
  return String(fromId) === String(principalUserId);
}

// Undefined means the event cleared both gates and its CONTENT decides;
// a decision here is terminal and never reaches command parsing.
function decideInboundGate(
  event: CursorBridgeInboundEvent,
  principalUserId: string | number,
  chatId: string | number,
  cursorTopicId: CursorBridgeTopicScope | number | undefined
): CursorBridgeDecision | undefined {
  if (!isScopedToCursorTopic(event, chatId, cursorTopicId)) {
    return { action: 'ignore' };
  }
  if (!isAuthorizedPrincipal(event.fromId, principalUserId)) {
    return { action: 'refuse' };
  }
  return undefined;
}

function decideInboundContent(
  event: CursorBridgeInboundEvent,
  trimmed: string,
  pending: PendingOperatorConfirm
): CursorBridgeDecision {
  if (event.kind === 'callback' && event.callbackData) {
    const special = decideOperatorSpecialCallback(event.callbackData);
    if (special.action === 'cancel-pending') {
      return { action: 'cancel-operator-pending' };
    }
    if (special.action === 'stop-and-run') {
      return { action: 'stop-and-run', verb: special.verb, args: special.args };
    }
    if (special.action === 'run-anyway') {
      return { action: 'run-anyway', verb: special.verb, args: special.args };
    }
    if (special.action === 'land-sleep') {
      return { action: 'land-sleep', answer: special.answer };
    }
    if (special.action === 'stop-mode') {
      return { action: 'stop-mode', mode: special.mode };
    }
    const mapped = mapOperatorConfirmDecision(
      decideOperatorConfirmCallback(pending, event.callbackData)
    );
    return mapped ?? { action: 'ignore' };
  }
  if (event.photoFileId) {
    return { action: 'prompt', text: buildPhotoPromptText(event.text), photoFileIds: [event.photoFileId] };
  }
  const dequeuePosition = parseDequeuePosition(trimmed);
  if (dequeuePosition !== undefined) {
    return { action: 'dequeue', position: dequeuePosition };
  }
  const gated = decideGatedOperatorVerb(trimmed, pending);
  if (gated) {
    return gated;
  }
  const cmd = parseCommand(trimmed);
  if (cmd) {
    return decideCommandAction(cmd);
  }
  return decideOperatorCommand(trimmed) ?? { action: 'prompt', text: trimmed };
}

export function decideInboundAction(
  event: CursorBridgeInboundEvent,
  principalUserId: string | number,
  chatId: string | number,
  cursorTopicId: CursorBridgeTopicScope | number | undefined,
  pending: PendingOperatorConfirm = undefined
): CursorBridgeDecision {
  const gated = decideInboundGate(event, principalUserId, chatId, cursorTopicId);
  if (gated) {
    return gated;
  }
  if (event.kind === 'callback') {
    return decideInboundContent(event, '', pending);
  }
  const trimmed = event.text.trim();
  if (!trimmed && !event.photoFileId) {
    return { action: 'ignore' };
  }
  return decideInboundContent(event, trimmed, pending);
}

export function gateBusy(decision: CursorBridgeDecision, busy: boolean): CursorBridgeDecision {
  if (!busy) {
    return decision;
  }
  if (['prompt', 'expedite', 'reexpedite', 'pilot', 'pilot-safe-start'].includes(decision.action)) {
    return { action: 'busy' };
  }
  if (decision.action === 'execute-operator') {
    const v = decision.verb.toLowerCase();
    const args = (decision.args ?? '').toLowerCase();
    if (
      v === '/hydrate' ||
      v === '/mint' ||
      (v === '/autopilot' && !args.startsWith('dry')) ||
      (v === '/land' && !args.startsWith('dry'))
    ) {
      return { action: 'busy' };
    }
  }
  return decision;
}

export function splitTelegramChunks(text: string, maxLen: number = TELEGRAM_MESSAGE_MAX_LENGTH): string[] {
  if (text.length <= maxLen) {
    return [text];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt <= 0) {
      splitAt = maxLen;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
    if (remaining.startsWith('\n')) {
      remaining = remaining.slice(1);
    }
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

type AssistantContentBlock = { type?: string; text?: string };

export function normalizedAssistantContentBlocks(
  content: Array<AssistantContentBlock> | undefined | null
): Array<AssistantContentBlock> {
  if (content === undefined || content === null) {
    return [];
  }
  return content;
}

export function isPlainAssistantStringMessage(message: unknown): boolean {
  return Object.prototype.toString.call(message) === '[object String]';
}

export function isCursorBridgePersistedRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function appendTextBlocks(content: Array<AssistantContentBlock> | undefined): string {
  let out = '';
  for (const block of normalizedAssistantContentBlocks(content)) {
    if (block.type === 'text' && typeof block.text === 'string') {
      out += block.text;
    }
  }
  return out;
}

function textFromAssistantMessage(message: AssistantStreamMessage): string {
  if (message.type !== 'assistant') {
    return '';
  }
  if (message.message === undefined || message.message === null) {
    return '';
  }
  if (isPlainAssistantStringMessage(message.message)) {
    return '';
  }
  return appendTextBlocks(
    (message.message as { content?: Array<AssistantContentBlock> }).content
  );
}

export function collectAssistantTextFromMessages(messages: readonly unknown[]): string {
  let out = '';
  for (const raw of messages) {
    out += textFromAssistantMessage(raw as AssistantStreamMessage);
  }
  return out;
}

/**
 * BL-767 invariant #1: a deferred reply (a drained queued prompt, a
 * choice-poll answer) is posted to exactly one topic — the one it was
 * asked/posted in, or the Cursor Remote topic when no origin was recorded.
 * Single source of truth for every deferred-reply site, so they cannot
 * independently drift into "whichever topic I happen to guess" (BL-767's
 * root cause was exactly that: sites each wrote their own fallback).
 */
export function resolveDeferredReplyTopicId(
  originTopicId: number | undefined,
  cursorTopicId: number | undefined
): number | undefined {
  return originTopicId ?? cursorTopicId;
}

export function parseNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number') {
    return fallback;
  }
  if (value < 0) {
    return fallback;
  }
  return value;
}

function parseOptionalTopicId(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function parseOptionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function assignIfDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function parseLivenessStatus(value: unknown): CursorBridgeLivenessStatusState | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const result: CursorBridgeLivenessStatusState = {};
  assignIfDefined(result, 'topicId', parseOptionalTopicId(record.topicId));
  assignIfDefined(result, 'messageId', parseOptionalTopicId(record.messageId));
  assignIfDefined(result, 'renderedText', parseOptionalNonEmptyString(record.renderedText));
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseQueuedWorkLivenessStatus(value: unknown): Record<string, CursorBridgeLivenessStatusState> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const result: Record<string, CursorBridgeLivenessStatusState> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const parsed = parseLivenessStatus(entry);
    if (parsed) {
      result[key] = parsed;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  return items.length > 0 ? items : undefined;
}

function parseQueuedPrompt(value: unknown): CursorBridgeQueuedPrompt | undefined {
  if (!isCursorBridgePersistedRecord(value)) {
    return undefined;
  }
  const id = parseOptionalNonEmptyString(value.id);
  const text = parseOptionalNonEmptyString(value.text);
  const createdAtMs = parseNonNegativeInt(value.createdAtMs, -1);
  if (!id || !text || createdAtMs < 0) {
    return undefined;
  }
  const queued: CursorBridgeQueuedPrompt = { id, text, createdAtMs };
  const photoFileIds = parseOptionalStringArray(value.photoFileIds);
  if (photoFileIds) {
    queued.photoFileIds = photoFileIds;
  }
  if (typeof value.replyToMessageId === 'number') {
    queued.replyToMessageId = value.replyToMessageId;
  }
  if (typeof value.originTopicId === 'number') {
    queued.originTopicId = value.originTopicId;
  }
  return queued;
}

function parseQueuedPromptPoll(value: unknown): CursorBridgeQueuedPromptPoll | undefined {
  if (!isCursorBridgePersistedRecord(value)) {
    return undefined;
  }
  const pollId = parseOptionalNonEmptyString(value.pollId);
  const itemIds = parseOptionalStringArray(value.itemIds);
  if (!pollId || !itemIds || itemIds.length === 0) {
    return undefined;
  }
  const poll: CursorBridgeQueuedPromptPoll = { pollId, itemIds };
  if (typeof value.clearAllOptionIndex === 'number' && value.clearAllOptionIndex >= 0) {
    poll.clearAllOptionIndex = value.clearAllOptionIndex;
  }
  return poll;
}

function parseChoicePoll(value: unknown): CursorBridgeChoicePoll | undefined {
  if (!isCursorBridgePersistedRecord(value)) {
    return undefined;
  }
  const pollId = parseOptionalNonEmptyString(value.pollId);
  const question = parseOptionalNonEmptyString(value.question);
  const options = parseOptionalStringArray(value.options);
  const createdAtMs = parseNonNegativeInt(value.createdAtMs, -1);
  if (!pollId || !question || !options || options.length < 2 || createdAtMs < 0) {
    return undefined;
  }
  const poll: CursorBridgeChoicePoll = { pollId, question, options, createdAtMs };
  if (typeof value.originTopicId === 'number') {
    poll.originTopicId = value.originTopicId;
  }
  return poll;
}

function buildPersistedState(record: Record<string, unknown>): CursorBridgePersistedState {
  const state: CursorBridgePersistedState = {
    updateOffset: parseNonNegativeInt(record.updateOffset, 0),
  };
  const topicId = parseOptionalTopicId(record.cursorTopicId);
  const bubbleTopicId = parseOptionalTopicId(record.bubbleTopicId);
  const agentId = parseOptionalNonEmptyString(record.agentId);
  if (topicId !== undefined) {
    state.cursorTopicId = topicId;
  }
  if (bubbleTopicId !== undefined) {
    state.bubbleTopicId = bubbleTopicId;
  }
  if (agentId !== undefined) {
    state.agentId = agentId;
  }
  const pendingPromptsRaw = Array.isArray(record.pendingPrompts) ? record.pendingPrompts : undefined;
  if (pendingPromptsRaw) {
    const pendingPrompts = pendingPromptsRaw
      .map((entry) => parseQueuedPrompt(entry))
      .filter((entry): entry is CursorBridgeQueuedPrompt => entry !== undefined);
    if (pendingPrompts.length > 0) {
      state.pendingPrompts = pendingPrompts;
    }
  }
  const pendingPromptPoll = parseQueuedPromptPoll(record.pendingPromptPoll);
  if (pendingPromptPoll) {
    state.pendingPromptPoll = pendingPromptPoll;
  }
  const supersededPromptPollId = parseOptionalNonEmptyString(record.supersededPromptPollId);
  if (supersededPromptPollId !== undefined) {
    state.supersededPromptPollId = supersededPromptPollId;
  }
  const pendingChoicePollsRaw = Array.isArray(record.pendingChoicePolls) ? record.pendingChoicePolls : undefined;
  if (pendingChoicePollsRaw) {
    const pendingChoicePolls = pendingChoicePollsRaw
      .map((entry) => parseChoicePoll(entry))
      .filter((entry): entry is CursorBridgeChoicePoll => entry !== undefined);
    if (pendingChoicePolls.length > 0) {
      state.pendingChoicePolls = pendingChoicePolls;
    }
  }
  const livenessStatus = parseLivenessStatus(record.livenessStatus);
  if (livenessStatus) {
    state.livenessStatus = livenessStatus;
  }
  const queuedWorkLivenessStatus = parseQueuedWorkLivenessStatus(record.queuedWorkLivenessStatus);
  if (queuedWorkLivenessStatus) {
    state.queuedWorkLivenessStatus = queuedWorkLivenessStatus;
  }
  return state;
}

export function parseCursorBridgeState(raw: unknown): CursorBridgePersistedState {
  if (!isCursorBridgePersistedRecord(raw)) {
    return { updateOffset: 0 };
  }
  return buildPersistedState(raw);
}

export function formatStatusMessage(state: CursorBridgePersistedState, busy: boolean): string {
  const agent = state.agentId ?? '(none — next message starts a session)';
  const topic = state.cursorTopicId ?? '(unbound)';
  const mode = busy ? 'busy (run in flight)' : 'idle';
  const queuedCount = state.pendingPrompts?.length ?? 0;
  return `Cursor bridge status\nTopic: ${topic}\nAgent: ${agent}\nMode: ${mode}\nQueued questions: ${queuedCount}`;
}

export function formatHelpMessage(): string {
  return [
    'Cursor remote control',
    '',
    'Send any message or photo to run the local Cursor agent against this repo.',
    '',
    '/new — start a fresh agent session',
    '/status — show session state',
    '/queue — show queued questions as a poll',
    '/dequeue N — remove queued question #N',
    '/update — short summary of agent / expedite / swarm activity (works while busy)',
    '/pilot [BL-xxx] — Cursor agent staffs an offline expedition (default BL-696)',
    '/pilot safe [--list] — auto-pick (or list) the safe pilot pool: approved, low-mutation, specced defects',
    '/expedite [BL-xxx] — run automated offline expeditor with stage updates (default BL-696)',
    '/reexpedite [BL-xxx] — checkpoint main WIP and restart a divergent expedite',
    '/redeploy — soft confirm, then compile and restart this bridge (reloads swarm.env)',
    '/redeploy miniapp — soft confirm, then bounce the headless mini app bridge',
    '/pause — soft confirm; freeze new promotion until /resume (in-flight continues; useful on flaky data)',
    '/resume — soft confirm; allow promotion again',
    '/syncenv /compile /pull — soft confirm (one Confirm tap)',
    '/stop /start /restart /bounce [swarm|extension|bridge|all] /ensure — hard confirm',
    '/doctor /tunnel /conf — read-only checks',
    '/confirm-off — clear a pending Confirm',
    '/log [expedite|redeploy|bridge] — tail the active or named operator log',
    '/help — this message',
  ].join('\n');
}

export function decidePollBackoffMs(consecutiveFailures: number, config: PollBackoffConfig = DEFAULT_POLL_BACKOFF): number {
  if (consecutiveFailures <= 0) {
    return 0;
  }
  const exponent = consecutiveFailures - 1;
  return Math.min(config.baseMs * 2 ** exponent, config.maxMs);
}

/** Cursor SDK rejects send() when the resumed agent still has an in-flight run. */
export function isActiveRunConflict(message: string): boolean {
  return message.toLowerCase().includes('already has active run');
}

/** Stale session or expired credentials — reset agentId and retry with a fresh agent. */
export function isCursorAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('authentication error') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid_api_key') ||
    (lower.includes('log out') && lower.includes('log in'))
  );
}

/** Transient SDK/network faults that often leave a stale active run behind. */
export function isCursorConnectionFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('connection failed repeatedly') ||
    lower.includes('connection failed') ||
    lower.includes('fetch failed') ||
    lower.includes('[unavailable]') ||
    lower.includes('service unavailable')
  );
}

export function shouldResetCursorAgentSession(message: string): boolean {
  return isActiveRunConflict(message) || isCursorAuthError(message) || isCursorConnectionFailure(message);
}

/** Rate-limit / quota errors from the Cursor API — fail fast with a clear message, no session reset. */
export function isCursorResourceExhausted(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('resource_exhausted') || lower.includes('resource exhausted') || lower.includes('rate limit');
}
