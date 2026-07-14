// BL-331: slice 3 of archive-then-delete - deletes a done ticket's
// Telegram topic only ever after its content is VERIFIED serialised into
// the repo (BL-329's own durable record), mirroring BL-299's own "close
// only follows a successful post, never an attempted one" ordering
// discipline for the far less reversible delete verb. Lives in
// src/concierge/ alongside topicReconciliation.ts, which this module's
// sweep parallels (same "state-based sweep over done tickets only" shape,
// same "never creates/touches a topic it has no business touching" care).
import { BacklogFolderItem } from './conciergeTick';
import { TopicRecord, hasCompletionRecord } from './blTopicStore';
import { BacklogTopicMap, completionSummaryText } from './topicRouter';

// A ticket's topic is only ever considered for deletion once this many ms
// have elapsed since its VERIFIED completion - overridable for tests/
// staging via env, same env-var-with-numeric-default shape as
// conciergeTickIntervalMs (telegram-front-desk-bot.ts).
const DEFAULT_RETENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function topicRetentionWindowMs(rawEnv: string | undefined = process.env.TOPIC_RETENTION_WINDOW_MS): number {
  const parsed = rawEnv ? Number(rawEnv) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_WINDOW_MS;
}

function completionEvent(ticketId: string) {
  return { type: 'TaskCompleted' as const, backlogId: ticketId, payload: {} };
}

// The verified completion message's OWN timestamp is the ticket's
// completedAt for retention purposes - never a filesystem mtime (a fresh
// checkout/`git clean` resets mtimes to checkout time, not when the
// ticket actually completed) and never a second, parallel "completed at"
// field this ticket would have to invent and keep in sync with BL-299's
// own close.
function verifiedCompletedAtMs(record: TopicRecord, completionText: string): number | undefined {
  return record.messages.find((m) => m.type === 'outbound' && m.text === completionText)?.ts;
}

export type TopicDeletionDecision =
  | { action: 'delete'; topicId: number }
  | { action: 'keep'; reason: 'no-topic' | 'unverified' | 'retention-window' };

// Pure: given one done ticket, the current topic mapping, and its OWN
// serialised record, decides whether the topic is safe to delete right
// now. "keep" is the default for every unresolved case; "delete" is the
// one narrow path that survives every check, in order:
//   1. no topic ever mapped -> nothing to delete (a no-op, mirrors
//      reconciliation's own "never creates a topic just to close it").
//   2. the record has no verified completion message -> UNVERIFIED, keep
//      (never delete on an attempted-but-unconfirmed archive - ticket
//      scope items 2-4).
//   3. inside the retention window -> keep (still glanceable in the app -
//      ticket scope item 6).
export function decideTopicDeletion(
  ticket: BacklogFolderItem,
  topicMap: BacklogTopicMap,
  record: TopicRecord,
  nowMs: number,
  retentionWindowMs: number
): TopicDeletionDecision {
  const topicId = topicMap[ticket.id];
  if (topicId === undefined) {
    return { action: 'keep', reason: 'no-topic' };
  }
  const completionText = completionSummaryText(completionEvent(ticket.id), ticket.title);
  if (!hasCompletionRecord(record, completionText)) {
    return { action: 'keep', reason: 'unverified' };
  }
  const completedAt = verifiedCompletedAtMs(record, completionText);
  if (completedAt === undefined || nowMs - completedAt < retentionWindowMs) {
    return { action: 'keep', reason: 'retention-window' };
  }
  return { action: 'delete', topicId };
}

export interface TopicDeletionAdapters {
  getTopicMap: () => BacklogTopicMap;
  readRecord: (ticketId: string) => TopicRecord;
  deleteTopic: (topicId: number) => Promise<boolean>;
  // BL-331 scope item 5: drops the mapping so nothing later posts into a
  // dead thread id - the reverse of routeAdapters.recordTopicId, never
  // shared with it (that one only ever adds/overwrites).
  dropTopicMapping: (backlogId: string) => void;
  // Adapter-injected, LOUD-by-default surfacing for the one anomalous
  // case worth alerting on (a topic old enough to sweep but still
  // unverified) - mirrors blTopicStore.ts's own CommitFailureReporter
  // convention (adapter-injected so a test can assert the failure was
  // reported without polluting real stderr). Never called for the
  // ordinary "still inside the retention window" wait state.
  reportUnverifiedDeletion: (ticketId: string) => void;
}

export interface TopicDeletionResult {
  // backlogIds actually deleted THIS sweep - a kept-for-any-reason ticket
  // is never listed here.
  deleted: string[];
}

// Adapter-injected sweep over done tickets only (same structural
// guarantee as reconcileTopicLifecycle - an active/paused ticket is never
// even offered to this function). Each ticket's decision is independent;
// a delete that fails (deleteTopic resolves false) leaves the mapping and
// record untouched - retried on the next sweep, never partially applied.
export async function sweepTopicDeletions(
  doneTickets: BacklogFolderItem[],
  adapters: TopicDeletionAdapters,
  nowMs: number,
  retentionWindowMs: number
): Promise<TopicDeletionResult> {
  const deleted: string[] = [];
  const topicMap = adapters.getTopicMap();
  for (const ticket of doneTickets) {
    const record = adapters.readRecord(ticket.id);
    const decision = decideTopicDeletion(ticket, topicMap, record, nowMs, retentionWindowMs);
    if (decision.action === 'keep') {
      if (decision.reason === 'unverified') {
        adapters.reportUnverifiedDeletion(ticket.id);
      }
      continue;
    }
    const ok = await adapters.deleteTopic(decision.topicId);
    if (ok) {
      adapters.dropTopicMapping(ticket.id);
      deleted.push(ticket.id);
    }
  }
  return { deleted };
}
