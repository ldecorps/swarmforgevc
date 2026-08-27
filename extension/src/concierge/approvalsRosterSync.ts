// BL-434: the adapter-injected I/O half of the Approvals topic's live roster
// - posts/edits a SINGLE Telegram message in place, change-gated on the
// rendered TEXT (never on a pending-set diff), the same "durable last-
// rendered marker" posture pipelineBoardSync.ts already models for the
// Pipeline Board. Mirrors that module's split almost exactly: a small named
// adapters interface, a thin apply step, a topic id created ONCE then
// reused. The create-once/post-or-edit control flow itself lives in
// editInPlaceMessageSync.ts, shared with pipelineBoardSync.ts (cleaner,
// BL-434 pass: the two were duplicating it byte-for-byte).
import { ApprovalsRosterTicket, renderApprovalsRoster } from './approvalsRoster';
import { EditInPlaceMessageResult, EditInPlaceMessageState, syncEditInPlaceMessage } from './editInPlaceMessageSync';

export interface ApprovalsRosterAdapters {
  ensureApprovalsTopic: () => Promise<number | undefined>;
  postMessage: (topicId: number, text: string) => Promise<number | undefined>;
  editMessage: (topicId: number, messageId: number, text: string) => Promise<boolean>;
}

export type ApprovalsRosterState = EditInPlaceMessageState;
export type ApprovalsRosterSyncResult = EditInPlaceMessageResult;

export async function syncApprovalsRoster(
  tickets: ApprovalsRosterTicket[],
  prevState: ApprovalsRosterState | undefined,
  adapters: ApprovalsRosterAdapters
): Promise<ApprovalsRosterSyncResult> {
  const text = renderApprovalsRoster(tickets);
  return syncEditInPlaceMessage(text, prevState, { ensureTopic: adapters.ensureApprovalsTopic, postMessage: adapters.postMessage, editMessage: adapters.editMessage });
}
