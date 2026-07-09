import * as path from 'path';
import { extractTicketId, readHandoffHeaderRecordsFlat, readHandoffHeaderRecordsWithBatches } from './swarmMetrics';

// BL-100 cost-02: per-ticket token attribution needs each role's actual
// ticket-holding windows (dequeued_at -> completed_at), not just the
// aggregate busy fraction swarmMetrics.ts's computeBusyness already
// provides. deriveHoldingWindows is pure over already-read handoff header
// records; readRoleHoldingWindows is the thin fs adapter.

export interface TicketHoldingWindow {
  ticketId: string;
  startMs: number;
  /** null means still open (in_process) at read time. */
  endMs: number | null;
}

// Parses an ISO timestamp header, or null if absent/unparsable - the one
// shared shape both startMs (required) and endMs (optional) need.
function parseMsOrNull(iso: string | undefined): number | null {
  if (!iso) {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// Derives one holding window from a header record, or null if it names no
// ticket or has no valid start time. Split out of deriveHoldingWindows so
// each function stays under the CRAP<=6 gate.
function deriveOneHoldingWindow(headers: Record<string, string>): TicketHoldingWindow | null {
  if (!headers.task) {
    return null;
  }
  const ticketId = extractTicketId(headers.task);
  if (!ticketId) {
    return null;
  }
  const startMs = parseMsOrNull(headers.dequeued_at);
  if (startMs === null) {
    return null;
  }
  return { ticketId, startMs, endMs: parseMsOrNull(headers.completed_at) };
}

export function deriveHoldingWindows(headerRecords: Array<Record<string, string>>): TicketHoldingWindow[] {
  return headerRecords
    .map(deriveOneHoldingWindow)
    .filter((w): w is TicketHoldingWindow => w !== null);
}

// Absent handoff directories (role never ran here) read as zero windows,
// never an error (cost-07). completed/ stays a flat read (no batch role has
// ever needed batch-completed ticket-holding attribution); in_process may
// hold direct .handoff files or batch subdirectories containing them.
export function readRoleHoldingWindows(worktreePath: string): TicketHoldingWindow[] {
  const completedDir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'completed');
  const inProcessDir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  const headerRecords = [
    ...readHandoffHeaderRecordsFlat(completedDir),
    ...readHandoffHeaderRecordsWithBatches(inProcessDir),
  ];
  return deriveHoldingWindows(headerRecords);
}
