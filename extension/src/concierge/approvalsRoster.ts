// BL-434: pure render logic for the standing Approvals topic's live
// roster/index - lists every ticket currently awaiting approval
// (conciergeTick.ts's own pendingApprovalFor set), one line per ticket.
// Mirrors pipelineBoard.ts's own pure render/adapter split, with
// approvalsRosterSync.ts as the I/O half (edit-in-place, change-gated on
// this function's own rendered text).

export interface ApprovalsRosterTicket {
  id: string;
  title?: string;
}

const NO_PENDING_TEXT = 'No tickets are currently awaiting approval.';
const ROSTER_HEADER = 'Awaiting approval:';

// Sorted by id - deterministic regardless of pendingApprovalFor's own
// iteration order, so the edge-triggered rendered-text comparison in
// approvalsRosterSync.ts stays stable tick over tick (mirrors
// pipelineBoard.ts's own fixed-ordering rationale).
export function renderApprovalsRoster(tickets: ApprovalsRosterTicket[]): string {
  if (tickets.length === 0) {
    return NO_PENDING_TEXT;
  }
  const sorted = [...tickets].sort((a, b) => a.id.localeCompare(b.id));
  const lines = sorted.map((t) => (t.title ? `${t.id} - ${t.title}` : t.id));
  return [ROSTER_HEADER, ...lines].join('\n');
}
