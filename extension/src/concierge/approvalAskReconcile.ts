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
      const ask = recordedAsks[id];
      if (ask !== undefined && ask.topicId === liveApprovalsTopicId) {
        return false;
      }
      // Remint / wrong-topic ask: always re-post onto the live Approvals id,
      // even if emittedKeys still carries ApprovalRequested:<id> from the
      // dead-thread post.
      if (ask !== undefined && ask.topicId !== liveApprovalsTopicId) {
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
