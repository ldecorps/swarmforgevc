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

import { approvalAskTextShowsDecidedVerdict } from './approvalAskClosing';

export interface RecordedApprovalAsk {
  topicId: number;
  // BL-1455: written by persistClosedApprovalAskText at decision time — the
  // record stays in the store (it is the audit trail), but is no longer a
  // LIVE ask once this is true. Records written before this ticket carry no
  // `closed` field at all; `text` (also unconditionally stored) lets
  // isAskClosed fall back to BL-484's decided-verdict suffix for those.
  closed?: boolean;
  text?: string;
}

export function approvalRequestedEmittedKey(backlogId: string): string {
  return `ApprovalRequested:${backlogId}`;
}

// A closed (decided) ask is history, never a live ask — regardless of which
// topic it names. `closed` is the authoritative signal once present; a
// record with no `closed` field predates BL-1455 and is classified by
// scanning its stored text for the decision-line suffix BL-484 appends on
// close (the one-time migration fallback the ticket calls for — never the
// long-term predicate for records written from here on).
function isAskClosed(ask: RecordedApprovalAsk): boolean {
  if (ask.closed !== undefined) {
    return ask.closed;
  }
  return ask.text !== undefined && approvalAskTextShowsDecidedVerdict(ask.text);
}

// True when telegram-approval-ask-messages.json already points at a buttoned,
// UNDECIDED ask on the LIVE Approvals topic. Shared by reconcile (skip
// synthesize) and the edge-trigger guard (skip re-post after a crash between
// Telegram post + ask-store write and durable tick-state write — otherwise
// diffApprovalRequested fires again and posts an exact duplicate). A CLOSED
// ask on the live topic is never "live" here, however recent its topicId —
// see approvalAsksNeedingRepost for the repost path that replaces it.
export function approvalAskRecordedOnLiveTopic(
  backlogId: string,
  recordedAsks: Readonly<Record<string, RecordedApprovalAsk>>,
  liveApprovalsTopicId: number | undefined
): boolean {
  if (liveApprovalsTopicId === undefined) {
    return false;
  }
  const ask = recordedAsks[backlogId];
  return ask !== undefined && ask.topicId === liveApprovalsTopicId && !isAskClosed(ask);
}

// BL-1455: a CLOSED ask still sitting on the live topic (a re-pend after the
// earlier decision) must repost unconditionally — never gated on
// emittedKeys, whose key was earned by the FIRST, now-decided ask, not this
// one. Without this, a durable baseline that already lists the ticket
// pending (and the key already emitted from the first cycle) would stay
// silent forever.
function isClosedAskOnLiveTopic(
  ask: RecordedApprovalAsk | undefined,
  liveApprovalsTopicId: number
): boolean {
  return ask !== undefined && ask.topicId === liveApprovalsTopicId && isAskClosed(ask);
}

// Remint / wrong-topic ask: always re-post onto the live Approvals id, even
// if emittedKeys still carries ApprovalRequested:<id> from the dead-thread
// post.
function isAskOnWrongTopic(ask: RecordedApprovalAsk | undefined, liveApprovalsTopicId: number): boolean {
  return ask !== undefined && ask.topicId !== liveApprovalsTopicId;
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
      const ask = recordedAsks[id];
      if (isClosedAskOnLiveTopic(ask, liveApprovalsTopicId) || isAskOnWrongTopic(ask, liveApprovalsTopicId)) {
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
