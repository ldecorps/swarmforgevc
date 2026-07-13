// BL-330: the topic lifecycle SAFETY NET beneath conciergeTick.ts's own
// diff-based path. diffTaskCompleted only ever emits a transition the bot
// was alive to WITNESS (prev-done vs curr-done) - a completion that
// happened while the bot was down, crash-looping, or running a stale
// build (BL-328's own proven failure mode) is missed FOREVER, since there
// is no catch-up pass. This reconciles from CURRENT STATE instead: for
// every DONE ticket, is its topic already brought to the completed state -
// and if not, bring it there NOW, however late.
//
// Deliberately reuses routeEvent's own existing TaskCompleted path
// (routeCompletionEvent, BL-299) rather than a second notify mechanism -
// the ticket's own scope item 4 forbids a parallel one. The only NEW thing
// here is the DETECTION (state comparison instead of event diffing) and
// the idempotency check (backed by BL-329's own durable record, not a new
// marker file).
import { BacklogFolderItem } from './conciergeTick';
import { RouteAdapters, BacklogTopicMap, routeEvent, completionSummaryText } from './topicRouter';

export interface ReconcileAdapters {
  getTopicMap: () => BacklogTopicMap;
  // True when this ticket's topic has already been brought to its
  // completed state (a completion summary matching summaryText already
  // recorded) - the idempotency guard scenario 03 requires.
  isAlreadyReconciled: (backlogId: string, summaryText: string) => boolean;
  routeAdapters: RouteAdapters;
}

export interface ReconcileResult {
  // backlogIds actually brought to their completed state THIS sweep - an
  // already-reconciled or never-topic-mapped ticket is never listed here.
  reconciled: string[];
}

// Callers pass ONLY done tickets (folders.done) - an active/paused ticket
// is never even offered to this function, a structural guarantee that it
// is left alone (scenario 04), not a runtime status check that could drift.
export async function reconcileTopicLifecycle(doneTickets: BacklogFolderItem[], adapters: ReconcileAdapters): Promise<ReconcileResult> {
  const reconciled: string[] = [];
  for (const ticket of doneTickets) {
    const topicId = adapters.getTopicMap()[ticket.id];
    if (topicId === undefined) {
      continue; // never had a topic at all - nothing to reconcile
    }
    const event = { type: 'TaskCompleted' as const, backlogId: ticket.id, payload: {} };
    const summaryText = completionSummaryText(event, ticket.title);
    if (adapters.isAlreadyReconciled(ticket.id, summaryText)) {
      continue; // already brought to completed state - idempotent no-op
    }
    const result = await routeEvent(event, ticket.title, adapters.routeAdapters);
    if (result.posted) {
      reconciled.push(ticket.id);
    }
  }
  return { reconciled };
}
