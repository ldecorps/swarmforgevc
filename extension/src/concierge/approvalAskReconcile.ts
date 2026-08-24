// Pure: which pending-approval tickets still need a buttoned ApprovalRequested
// ask on the LIVE Approvals topic. Complements diffApprovalRequested's
// edge-trigger (not-pending → pending): that alone goes dark when
// pendingApproval is already in the persisted tick baseline but no ask was
// ever recorded (failed post then manual/baseline advance, remint that left
// the ask on a dead topic id, or a wiped telegram-approval-ask-messages.json).
//
// The Approvals roster (approvalsRosterSync.ts) is a SEPARATE surface — a
// text index. This module is about the per-ticket ask with
// Approve/Amend/Reject/Expedite buttons (topicRouter.routeApprovalRequestedEvent).

export interface RecordedApprovalAsk {
  topicId: number;
}

export function approvalRequestedEmittedKey(backlogId: string): string {
  return `ApprovalRequested:${backlogId}`;
}

// True when telegram-approval-ask-messages.json already points at a buttoned
// ask on the LIVE Approvals topic. Shared by reconcile (skip synthesize) and
// the edge-trigger guard (skip re-post after a crash between Telegram post +
// ask-store write and durable tick-state write — otherwise
// diffApprovalRequested fires again and posts an exact duplicate).
export function approvalAskRecordedOnLiveTopic(
  backlogId: string,
  recordedAsks: Readonly<Record<string, RecordedApprovalAsk>>,
  liveApprovalsTopicId: number | undefined
): boolean {
  if (liveApprovalsTopicId === undefined) {
    return false;
  }
  const ask = recordedAsks[backlogId];
  return ask !== undefined && ask.topicId === liveApprovalsTopicId;
}

// Returns backlog ids that should synthesize an ApprovalRequested this tick.
// Deterministic sort so tick routing order stays stable.
export function approvalAsksNeedingRepost(
  pendingIds: readonly string[],
  recordedAsks: Readonly<Record<string, RecordedApprovalAsk>>,
  liveApprovalsTopicId: number | undefined,
  emittedKeys: ReadonlySet<string> = new Set()
): string[] {
  if (liveApprovalsTopicId === undefined) {
    return [];
  }
  return pendingIds
    .filter((id) => {
      if (approvalAskRecordedOnLiveTopic(id, recordedAsks, liveApprovalsTopicId)) {
        return false;
      }
      // Remint / wrong-topic ask: any recorded ask that is not on the live
      // topic (live match already returned above) always re-posts, even if
      // emittedKeys still carries ApprovalRequested:<id> from the dead thread.
      if (recordedAsks[id] !== undefined) {
        return true;
      }
      // No recorded ask: only re-fire when the edge-trigger also would not
      // (emittedKeys lacks the key). If the key is present, a prior tick
      // already counted a successful ask via the sendMessage fallback path
      // that never wrote telegram-approval-ask-messages.json — do not loop.
      return !emittedKeys.has(approvalRequestedEmittedKey(id));
    })
    .slice()
    .sort((a, b) => a.localeCompare(b));
}
