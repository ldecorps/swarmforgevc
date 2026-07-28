// Pure decision logic for the Telegram ↔ Cursor SDK remote-control bridge.
// Mirrors telegramControlCore.ts: guards, command parse, chunking, and state
// shape live here with no I/O; telegram-cursor-bridge.ts wires Telegram and
// the Cursor SDK around these decisions.

import { topicForSubject } from './telegramTopicDecisions';
import { buildPhotoPromptText } from '../bridge/cursorBridgeTelegramMedia';
import { parseExpediteTicket, parseReexpediteTicket } from './telegramCursorBridgeExpedite';
import { parsePilotTicket } from './telegramCursorBridgePilot';
import { parseRedeployCommand } from './telegramCursorBridgeRedeploy';
import { parseLogCommand, type LogTarget } from './telegramCursorBridgeLogs';

export const CURSOR_BRIDGE_SUBJECT_ID = 'CURSOR_REMOTE';
export const CURSOR_BRIDGE_TOPIC_NAME = 'Cursor Remote';
export const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

export interface CursorBridgePersistedState {
  updateOffset: number;
  cursorTopicId?: number;
  agentId?: string;
}

export interface CursorBridgeInboundEvent {
  fromId: string | number;
  chatId: string | number;
  topicId: number | undefined;
  text: string;
  photoFileId?: string;
}

export type CursorBridgeDecision =
  | { action: 'ignore' }
  | { action: 'refuse' }
  | { action: 'new-session' }
  | { action: 'status' }
  | { action: 'update' }
  | { action: 'help' }
  | { action: 'expedite'; ticket: string }
  | { action: 'reexpedite'; ticket: string }
  | { action: 'pilot'; ticket: string }
  | { action: 'redeploy' }
  | { action: 'log'; target: LogTarget }
  | { action: 'prompt'; text: string; photoFileIds?: string[] }
  | { action: 'busy' };

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

export function cursorBridgeTopicIdFromMap(topicMap: Record<string, string>): number | undefined {
  return topicForSubject(topicMap, CURSOR_BRIDGE_SUBJECT_ID);
}

export function isCursorBridgeTopic(topicId: number | undefined, cursorBridgeTopicId: number | undefined): boolean {
  return cursorBridgeTopicId !== undefined && topicId === cursorBridgeTopicId;
}

// The front desk and cursor bridge share one Telegram forum chat but use
// separate topic-map files — strip any stale SUP binding on the cursor
// topic so the concierge never routes or replies there.
export function frontDeskTopicMapWithoutCursorBridge(
  topicMap: Record<string, string>,
  cursorBridgeTopicId: number | undefined
): Record<string, string> {
  if (cursorBridgeTopicId === undefined) {
    return topicMap;
  }
  const key = String(cursorBridgeTopicId);
  if (!(key in topicMap)) {
    return topicMap;
  }
  const next = { ...topicMap };
  delete next[key];
  return next;
}

export function parseCommand(text: string): 'new' | 'status' | 'help' | 'update' | undefined {
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
  return undefined;
}

function decideCommandAction(cmd: 'new' | 'status' | 'help' | 'update'): CursorBridgeDecision {
  if (cmd === 'new') {
    return { action: 'new-session' };
  }
  if (cmd === 'status') {
    return { action: 'status' };
  }
  if (cmd === 'update') {
    return { action: 'update' };
  }
  return { action: 'help' };
}

function decideOperatorCommand(text: string): CursorBridgeDecision | undefined {
  if (parseRedeployCommand(text)) {
    return { action: 'redeploy' };
  }
  const logTarget = parseLogCommand(text);
  if (logTarget) {
    return { action: 'log', target: logTarget };
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

export function isScopedToCursorTopic(
  event: Pick<CursorBridgeInboundEvent, 'chatId' | 'topicId'>,
  chatId: string | number,
  cursorTopicId: number | undefined
): boolean {
  return String(event.chatId) === String(chatId) && cursorTopicId !== undefined && event.topicId === cursorTopicId;
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
  cursorTopicId: number | undefined
): CursorBridgeDecision | undefined {
  if (!isScopedToCursorTopic(event, chatId, cursorTopicId)) {
    return { action: 'ignore' };
  }
  if (!isAuthorizedPrincipal(event.fromId, principalUserId)) {
    return { action: 'refuse' };
  }
  return undefined;
}

function decideInboundContent(event: CursorBridgeInboundEvent, trimmed: string): CursorBridgeDecision {
  if (event.photoFileId) {
    return { action: 'prompt', text: buildPhotoPromptText(event.text), photoFileIds: [event.photoFileId] };
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
  cursorTopicId: number | undefined
): CursorBridgeDecision {
  const gated = decideInboundGate(event, principalUserId, chatId, cursorTopicId);
  if (gated) {
    return gated;
  }
  const trimmed = event.text.trim();
  if (!trimmed && !event.photoFileId) {
    return { action: 'ignore' };
  }
  return decideInboundContent(event, trimmed);
}

export function gateBusy(decision: CursorBridgeDecision, busy: boolean): CursorBridgeDecision {
  if (!busy || !['prompt', 'expedite', 'reexpedite', 'pilot'].includes(decision.action)) {
    return decision;
  }
  return { action: 'busy' };
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

function buildPersistedState(record: Record<string, unknown>): CursorBridgePersistedState {
  const state: CursorBridgePersistedState = {
    updateOffset: parseNonNegativeInt(record.updateOffset, 0),
  };
  const topicId = parseOptionalTopicId(record.cursorTopicId);
  const agentId = parseOptionalNonEmptyString(record.agentId);
  if (topicId !== undefined) {
    state.cursorTopicId = topicId;
  }
  if (agentId !== undefined) {
    state.agentId = agentId;
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
  return `Cursor bridge status\nTopic: ${topic}\nAgent: ${agent}\nMode: ${mode}`;
}

export function formatHelpMessage(): string {
  return [
    'Cursor remote control',
    '',
    'Send any message or photo to run the local Cursor agent against this repo.',
    '',
    '/new — start a fresh agent session',
    '/status — show session state',
    '/update — short summary of agent / expedite / swarm activity (works while busy)',
    '/pilot [BL-xxx] — Cursor agent staffs an offline expedition (default BL-696)',
    '/expedite [BL-xxx] — run automated offline expeditor with stage updates (default BL-696)',
    '/reexpedite [BL-xxx] — checkpoint main WIP and restart a divergent expedite',
    '/redeploy — compile extension and restart this bridge',
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

export function shouldResetCursorAgentSession(message: string): boolean {
  return isActiveRunConflict(message) || isCursorAuthError(message);
}
