// Pure decision logic for the Telegram ↔ Cursor SDK remote-control bridge.
// Mirrors telegramControlCore.ts: guards, command parse, chunking, and state
// shape live here with no I/O; telegram-cursor-bridge.ts wires Telegram and
// the Cursor SDK around these decisions.

import { topicForSubject } from './telegramTopicDecisions';

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
}

export type CursorBridgeDecision =
  | { action: 'ignore' }
  | { action: 'refuse' }
  | { action: 'new-session' }
  | { action: 'status' }
  | { action: 'help' }
  | { action: 'prompt'; text: string }
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

type AssistantStreamMessage = {
  type?: string;
  message?: { content?: Array<{ type?: string; text?: string }> } | string;
};

export function decideEnsureCursorTopicAction(topicMap: Record<string, string>): EnsureCursorTopicAction {
  const existingTopicId = topicForSubject(topicMap, CURSOR_BRIDGE_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

function parseCommand(text: string): 'new' | 'status' | 'help' | undefined {
  const lower = text.trim().toLowerCase();
  if (lower === '/new') {
    return 'new';
  }
  if (lower === '/status') {
    return 'status';
  }
  if (lower === '/help') {
    return 'help';
  }
  return undefined;
}

function decideCommandAction(cmd: 'new' | 'status' | 'help'): CursorBridgeDecision {
  if (cmd === 'new') {
    return { action: 'new-session' };
  }
  if (cmd === 'status') {
    return { action: 'status' };
  }
  return { action: 'help' };
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

export function decideInboundAction(
  event: CursorBridgeInboundEvent,
  principalUserId: string | number,
  chatId: string | number,
  cursorTopicId: number | undefined
): CursorBridgeDecision {
  if (!isScopedToCursorTopic(event, chatId, cursorTopicId)) {
    return { action: 'ignore' };
  }
  if (!isAuthorizedPrincipal(event.fromId, principalUserId)) {
    return { action: 'refuse' };
  }
  const trimmed = event.text.trim();
  if (!trimmed) {
    return { action: 'ignore' };
  }
  const cmd = parseCommand(trimmed);
  if (cmd) {
    return decideCommandAction(cmd);
  }
  return { action: 'prompt', text: trimmed };
}

export function gateBusy(decision: CursorBridgeDecision, busy: boolean): CursorBridgeDecision {
  if (!busy || decision.action !== 'prompt') {
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

function appendTextBlocks(content: Array<{ type?: string; text?: string }> | undefined): string {
  let out = '';
  for (const block of content ?? []) {
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
  if (!message.message || typeof message.message === 'string') {
    return '';
  }
  return appendTextBlocks(message.message.content);
}

export function collectAssistantTextFromMessages(messages: readonly unknown[]): string {
  let out = '';
  for (const raw of messages) {
    out += textFromAssistantMessage(raw as AssistantStreamMessage);
  }
  return out;
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && value >= 0 ? value : fallback;
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
  if (!raw || typeof raw !== 'object') {
    return { updateOffset: 0 };
  }
  return buildPersistedState(raw as Record<string, unknown>);
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
    'Send any message to run the local Cursor agent against this repo.',
    '',
    '/new — start a fresh agent session',
    '/status — show session state',
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
