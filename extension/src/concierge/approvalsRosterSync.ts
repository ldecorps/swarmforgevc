// BL-434: the adapter-injected I/O half of the Approvals topic's live roster
// - posts/edits a SINGLE Telegram message in place, change-gated on the
// rendered TEXT (never on a pending-set diff), the same "durable last-
// rendered marker" posture pipelineBoardSync.ts already models for the
// Pipeline Board. Mirrors that module's split almost exactly: a small named
// adapters interface, a thin apply step, a topic id created ONCE then
// reused.
import { ApprovalsRosterTicket, renderApprovalsRoster } from './approvalsRoster';

export interface ApprovalsRosterAdapters {
  ensureApprovalsTopic: () => Promise<number | undefined>;
  postMessage: (topicId: number, text: string) => Promise<number | undefined>;
  editMessage: (topicId: number, messageId: number, text: string) => Promise<boolean>;
}

export interface ApprovalsRosterState {
  topicId?: number;
  messageId?: number;
  renderedText?: string;
}

export type ApprovalsRosterSyncOutcome = 'posted' | 'edited' | 'skipped-unchanged' | 'failed-no-topic' | 'failed-post' | 'failed-edit';

export interface ApprovalsRosterSyncResult {
  // Only a SUCCESSFUL post/edit may advance renderedText/messageId - a
  // failure is naturally retried against the same stale text next tick
  // rather than silently marked caught-up (mirrors PipelineBoardSyncResult's
  // own contract).
  state: ApprovalsRosterState;
  outcome: ApprovalsRosterSyncOutcome;
}

// The topic id is created ONCE then reused - split out purely to keep
// syncApprovalsRoster's own CRAP under threshold (same reasoning as
// pipelineBoardSync.ts's resolveBoardTopicId).
function resolveApprovalsTopicId(prevState: ApprovalsRosterState | undefined, adapters: ApprovalsRosterAdapters): Promise<number | undefined> {
  return Promise.resolve(prevState?.topicId ?? adapters.ensureApprovalsTopic());
}

async function postOrEditRoster(
  topicId: number,
  text: string,
  prevState: ApprovalsRosterState | undefined,
  adapters: ApprovalsRosterAdapters
): Promise<ApprovalsRosterSyncResult> {
  if (prevState?.messageId === undefined) {
    const messageId = await adapters.postMessage(topicId, text);
    if (messageId === undefined) {
      return { state: { ...prevState, topicId }, outcome: 'failed-post' };
    }
    return { state: { topicId, messageId, renderedText: text }, outcome: 'posted' };
  }

  const ok = await adapters.editMessage(topicId, prevState.messageId, text);
  if (!ok) {
    return { state: prevState, outcome: 'failed-edit' };
  }
  return { state: { topicId, messageId: prevState.messageId, renderedText: text }, outcome: 'edited' };
}

export async function syncApprovalsRoster(
  tickets: ApprovalsRosterTicket[],
  prevState: ApprovalsRosterState | undefined,
  adapters: ApprovalsRosterAdapters
): Promise<ApprovalsRosterSyncResult> {
  const text = renderApprovalsRoster(tickets);
  if (text === prevState?.renderedText) {
    return { state: prevState ?? {}, outcome: 'skipped-unchanged' };
  }

  const topicId = await resolveApprovalsTopicId(prevState, adapters);
  if (topicId === undefined) {
    return { state: prevState ?? {}, outcome: 'failed-no-topic' };
  }

  return postOrEditRoster(topicId, text, prevState, adapters);
}
