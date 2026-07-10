// BL-256: pure "what merged / what's blocked" digest for the daily
// briefing. Reuses gitHistoryAdapter.ts's TicketLifecycleEvent (deriveTicketLifecycles)
// and ticketHoldingWindows.ts's TicketHoldingWindow (readRoleHoldingWindows) -
// this module composes those already-derived shapes into the two digest
// lists; it never re-derives lifecycle or holding-window logic itself.
import { TicketLifecycleEvent } from './gitHistoryAdapter';
import { TicketHoldingWindow } from './ticketHoldingWindows';

export interface MergedTicketEntry {
  ticketId: string;
  closeDateIso: string;
}

export interface BlockedTicketEntry {
  ticketId: string;
  role: string;
  openMs: number;
}

// A ticket a role has held open (in_process, no completed_at yet) for at
// least this long is "blocked/stalled" - no existing threshold/flag exists
// anywhere in the codebase (grep-confirmed), so this is a new, explicit,
// conservative default rather than an invented data source.
export const DEFAULT_BLOCKED_THRESHOLD_MS = 12 * 60 * 60 * 1000;

// Every ticket whose lifecycle closed at/after sinceMs - "since the last
// briefing" per the ticket's own wanted behavior. Sorted oldest-closed
// first (chronological reading order for a digest).
export function computeMergedSince(lifecycles: Map<string, TicketLifecycleEvent>, sinceMs: number): MergedTicketEntry[] {
  const out: MergedTicketEntry[] = [];
  for (const lc of lifecycles.values()) {
    if (lc.closeDateIso && Date.parse(lc.closeDateIso) >= sinceMs) {
      out.push({ ticketId: lc.ticketId, closeDateIso: lc.closeDateIso });
    }
  }
  return out.sort((a, b) => a.closeDateIso.localeCompare(b.closeDateIso));
}

// Every currently-open (endMs === null) holding window past the threshold,
// across every role - longest-open first (most attention-worthy first).
export function computeBlockedTickets(
  windowsByRole: Record<string, TicketHoldingWindow[]>,
  nowMs: number,
  thresholdMs: number = DEFAULT_BLOCKED_THRESHOLD_MS
): BlockedTicketEntry[] {
  const out: BlockedTicketEntry[] = [];
  for (const [role, windows] of Object.entries(windowsByRole)) {
    for (const w of windows) {
      if (w.endMs === null) {
        const openMs = nowMs - w.startMs;
        if (openMs >= thresholdMs) {
          out.push({ ticketId: w.ticketId, role, openMs });
        }
      }
    }
  }
  return out.sort((a, b) => b.openMs - a.openMs);
}
