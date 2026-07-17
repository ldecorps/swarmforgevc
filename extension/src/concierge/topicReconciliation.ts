// BL-330: the topic lifecycle SAFETY NET beneath conciergeTick.ts's own
// diff-based path. diffTaskCompleted only ever emits a transition the bot
// was alive to WITNESS (prev-done vs curr-done) - a completion that
// happened while the bot was down, crash-looping, or running a stale
// build (BL-328's own proven failure mode) is missed FOREVER, since there
// is no catch-up pass. This reconciles from CURRENT STATE instead: for
// every DONE ticket, does its edit-in-place status message already reflect
// 'done' - and if not, bring it there NOW, however late.
//
// Deliberately reuses routeEvent's own existing ticket-status path (BL-493)
// rather than a second notify mechanism - the ticket's own scope item 4
// forbids a parallel one. The only NEW thing here is the DETECTION (state
// comparison instead of event diffing) and the idempotency check (backed by
// BL-329's own durable record, not a new marker file).
import { BacklogFolderItem, epicTitleFor } from './conciergeTick';
import { EpicDefinition } from './epicProgress';
import { RouteAdapters, BacklogTopicMap, TicketRouteContext, routeEvent } from './topicRouter';
import { buildTicketStatusText } from './ticketStatusMessage';

export interface ReconcileAdapters {
  getTopicMap: () => BacklogTopicMap;
  // True when this ticket's status message has already been brought to its
  // completed state (a 'done' status text matching summaryText already
  // recorded) - the idempotency guard scenario 03 requires.
  isAlreadyReconciled: (backlogId: string, summaryText: string) => boolean;
  routeAdapters: RouteAdapters;
}

export interface ReconcileResult {
  // backlogIds actually brought to their completed state THIS sweep - an
  // already-reconciled ticket is never listed here.
  reconciled: string[];
}

// Callers pass ONLY done tickets (folders.done) - an active/paused ticket
// is never even offered to this function, a structural guarantee that it
// is left alone (scenario 04), not a runtime status check that could drift.
// BL-493: no per-ticket topic exists to gate on anymore (getTopicMap's old
// per-ticket lookup is retained on the interface for now, unused here) -
// the ticket's status message targets its epic topic (epic-bound) or the
// standing Backlog topic (epic-less, BL-492), both SHARED, standing
// infrastructure rather than a disposable per-ticket topic, so there is no
// "never create a topic just to close it" concern left to guard against; a
// ticket whose completion (or even its very first status message) was
// entirely missed while the bot was offline still gets it posted now.
// BL-493 architect bounce (2026-07-17): epicDefinitions is REQUIRED so an
// epic-bound ticket's TicketRouteContext carries the epic's real TITLE
// (epicTitleFor, conciergeTick.ts) - never its raw id stood in as a
// title. That mismatch is invisible while the epic's topic already exists
// (ensureEpicTopicId's reuse branch never touches the name), but names the
// live Telegram topic "EPIC — <id>" the moment reconciliation is the FIRST
// path to create it - exactly BL-330's own reason to exist: a ticket whose
// completion happened while the bot was down, possibly before its epic's
// topic was ever created through the live tick at all. Callers pass the
// SAME epicDefinitionsFor(folders) the live tick already computes once per
// tick - never a second, second-guessing computation here.
export async function reconcileTopicLifecycle(
  doneTickets: BacklogFolderItem[],
  epicDefinitions: Record<string, EpicDefinition>,
  adapters: ReconcileAdapters
): Promise<ReconcileResult> {
  const reconciled: string[] = [];
  for (const ticket of doneTickets) {
    const summaryText = buildTicketStatusText(ticket.id, ticket.title, 'done');
    if (adapters.isAlreadyReconciled(ticket.id, summaryText)) {
      continue; // already brought to completed state - idempotent no-op
    }
    const event = { type: 'TaskCompleted' as const, backlogId: ticket.id, payload: {} };
    const ticketContext: TicketRouteContext = { epic: ticket.epic, epicTitle: epicTitleFor(ticket.epic, epicDefinitions), iconState: 'done' };
    const result = await routeEvent(event, ticket.title, adapters.routeAdapters, ticketContext);
    if (result.posted) {
      reconciled.push(ticket.id);
    }
  }
  return { reconciled };
}
