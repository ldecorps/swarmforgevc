// Topic and subject resolution logic for the Telegram Front Desk Bot.
// Pure decisions for ensuring standing topics exist and routing replies to topics.
import { TelegramUpdate } from '../notify/telegramClient';
import { SWARM_LIVE_SCREEN_NAME } from '../concierge/residentPaneSpy';

// BL-353: generic getUpdates-offset utility for the poll loop.
export function nextUpdateOffset(updates: TelegramUpdate[], currentOffset: number): number {
  return updates.reduce((max, u) => Math.max(max, u.update_id + 1), currentOffset);
}

export function isFromPrincipal(update: TelegramUpdate, principalUserId: string): boolean {
  const fromId = update.message?.from?.id;
  return fromId !== undefined && String(fromId) === String(principalUserId);
}

// BL-379: filter updates to only those from the configured chat
// (getUpdates is scoped to the bot, not the chat).
export function isFromMyChat(update: TelegramUpdate, chatId: string): boolean {
  const updateChatId = update.message?.chat?.id;
  return updateChatId !== undefined && String(updateChatId) === String(chatId);
}

export function topicIdOf(update: TelegramUpdate): number | undefined {
  return update.message?.message_thread_id;
}

export function messageTextOf(update: TelegramUpdate): string | undefined {
  return update.message?.text;
}

// BL-294: reserved key for private DM subjects (no message_thread_id).
export const DEFAULT_SUBJECT_KEY = '__default__';

export function subjectForTopic(topicMap: Record<string, string>, topicId: number | undefined): string | undefined {
  return topicMap[topicId === undefined ? DEFAULT_SUBJECT_KEY : String(topicId)];
}

export function topicForSubject(topicMap: Record<string, string>, subjectId: string): number | undefined {
  const found = Object.entries(topicMap).find(([key, sid]) => sid === subjectId && key !== DEFAULT_SUBJECT_KEY);
  return found ? Number(found[0]) : undefined;
}

export function hasDefaultBinding(topicMap: Record<string, string>, subjectId: string): boolean {
  return topicMap[DEFAULT_SUBJECT_KEY] === subjectId;
}

export function resolveReplyTopicId(
  topicMap: Record<string, string>,
  backlogTopicMap: Record<string, number>,
  threadId: string
): number | undefined {
  const supTopicId = topicForSubject(topicMap, threadId);
  return supTopicId !== undefined ? supTopicId : backlogTopicMap[threadId];
}

export type ReplyDelivery =
  | { kind: 'topic'; topicId: number; alsoPointerToDefault: boolean }
  | { kind: 'default' }
  | { kind: 'undeliverable' };

export function resolveReplyDelivery(topicMap: Record<string, string>, backlogTopicMap: Record<string, number>, threadId: string): ReplyDelivery {
  const backlogTopicId = backlogTopicMap[threadId];
  if (backlogTopicId !== undefined) {
    return { kind: 'topic', topicId: backlogTopicId, alsoPointerToDefault: false };
  }
  const realTopicId = topicForSubject(topicMap, threadId);
  if (realTopicId !== undefined) {
    return { kind: 'topic', topicId: realTopicId, alsoPointerToDefault: hasDefaultBinding(topicMap, threadId) };
  }
  if (hasDefaultBinding(topicMap, threadId)) {
    return { kind: 'default' };
  }
  return { kind: 'undeliverable' };
}

export const REPLY_POINTER_TEXT = "This was answered — see the reply in this conversation's other topic.";

// Standing topic definitions and decisions.
export const OPERATOR_SUBJECT_ID = 'OPERATOR';
export const OPERATOR_TOPIC_NAME = 'Concierge';

export type EnsureOperatorTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

export function decideEnsureOperatorTopicAction(topicMap: Record<string, string>): EnsureOperatorTopicAction {
  const existingTopicId = topicForSubject(topicMap, OPERATOR_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

export type StandingTopicTitleSyncAction = 'update' | 'unchanged';

export function decideStandingTopicTitleSync(recordedTitle: string | undefined, desiredTitle: string): StandingTopicTitleSyncAction {
  return recordedTitle === desiredTitle ? 'unchanged' : 'update';
}

export const APPROVALS_SUBJECT_ID = 'APPROVALS';
export const APPROVALS_TOPIC_NAME = 'Approvals';

export type EnsureApprovalsTopicAction =
  | { kind: 'reuse'; topicId: number }
  | { kind: 'rebind'; topicId: number }
  | { kind: 'create' };

export function decideEnsureApprovalsTopicAction(
  topicMap: Record<string, string>,
  lastKnownTopicId?: number,
  liveTopicIdsNamedApprovals?: number[]
): EnsureApprovalsTopicAction {
  const named = (liveTopicIdsNamedApprovals ?? [])
    .filter((id) => typeof id === 'number' && Number.isFinite(id))
    .sort((a, b) => a - b);
  if (named.length > 0) {
    const oldest = named[0];
    const existingTopicId = topicForSubject(topicMap, APPROVALS_SUBJECT_ID);
    if (existingTopicId === oldest) {
      return { kind: 'reuse', topicId: oldest };
    }
    return { kind: 'rebind', topicId: oldest };
  }
  const existingTopicId = topicForSubject(topicMap, APPROVALS_SUBJECT_ID);
  if (existingTopicId !== undefined) {
    return { kind: 'reuse', topicId: existingTopicId };
  }
  if (lastKnownTopicId !== undefined) {
    return { kind: 'rebind', topicId: lastKnownTopicId };
  }
  return { kind: 'create' };
}

export const RECERT_SUBJECT_ID = 'RECERT';
export const RECERT_TOPIC_NAME = 'Recert';

export type EnsureRecertTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

export function decideEnsureRecertTopicAction(topicMap: Record<string, string>): EnsureRecertTopicAction {
  const existingTopicId = topicForSubject(topicMap, RECERT_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

export const AGENT_QUESTIONS_SUBJECT_ID = 'AGENT_QUESTIONS';
export const AGENT_QUESTIONS_TOPIC_NAME = 'Agent Questions';

export type EnsureAgentQuestionsTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

export function decideEnsureAgentQuestionsTopicAction(topicMap: Record<string, string>): EnsureAgentQuestionsTopicAction {
  const existingTopicId = topicForSubject(topicMap, AGENT_QUESTIONS_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

export const BACKLOG_SUBJECT_ID = 'BACKLOG';
export const BACKLOG_TOPIC_NAME = 'Backlog';

export type EnsureBacklogTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

export function decideEnsureBacklogTopicAction(topicMap: Record<string, string>): EnsureBacklogTopicAction {
  const existingTopicId = topicForSubject(topicMap, BACKLOG_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

export const CONTROL_SUBJECT_ID = 'CONTROL';
export const CONTROL_TOPIC_NAME = 'Control';

export type EnsureControlTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

export function decideEnsureControlTopicAction(topicMap: Record<string, string>): EnsureControlTopicAction {
  const existingTopicId = topicForSubject(topicMap, CONTROL_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

export const BABYSITTER_SUBJECT_ID = 'BABYSITTER';
export const BABYSITTER_TOPIC_NAME = 'Babysitter';

export type EnsureBabysitterTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

export function decideEnsureBabysitterTopicAction(topicMap: Record<string, string>): EnsureBabysitterTopicAction {
  const existingTopicId = topicForSubject(topicMap, BABYSITTER_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

export const RESIDENT_SPY_SUBJECT_ID = 'RESIDENT_SPY';
export const RESIDENT_SPY_TOPIC_NAME = SWARM_LIVE_SCREEN_NAME;

export type EnsureResidentSpyTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

export function decideEnsureResidentSpyTopicAction(topicMap: Record<string, string>): EnsureResidentSpyTopicAction {
  const existingTopicId = topicForSubject(topicMap, RESIDENT_SPY_SUBJECT_ID);
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}

export type EnsureRoleTopicAction = { kind: 'reuse'; topicId: number } | { kind: 'create' };

export function decideEnsureRoleTopicAction(roleTopicMap: Record<string, number>, role: string): EnsureRoleTopicAction {
  const existingTopicId = roleTopicMap[role];
  return existingTopicId !== undefined ? { kind: 'reuse', topicId: existingTopicId } : { kind: 'create' };
}
