// BL-703: pure queue selection for /autopilot and /land (dry + execute).

export interface OperatorQueueTicket {
  id: string;
  title?: string;
  type?: string;
  severity?: string;
  priority?: number;
  humanApproval?: 'pending' | 'approved';
  acceptance?: string;
  /** Folder bucket: active | paused | hold | done */
  folder: string;
}

export function isAlreadySpecced(ticket: OperatorQueueTicket): boolean {
  if (ticket.humanApproval === 'pending') {
    return false;
  }
  return typeof ticket.acceptance === 'string' && ticket.acceptance.trim().length > 0;
}

/** BL-698 pin: high/critical severity OR type defect; never epics; live paused|active only. */
export function selectAutopilotQueue(tickets: OperatorQueueTicket[]): OperatorQueueTicket[] {
  const live = tickets.filter((t) => t.folder === 'active' || t.folder === 'paused');
  const selected = live.filter((t) => {
    if ((t.type ?? '').toLowerCase() === 'epic') {
      return false;
    }
    if (!isAlreadySpecced(t)) {
      return false;
    }
    const sev = (t.severity ?? '').toLowerCase();
    const isHigh = sev === 'high' || sev === 'critical';
    const isDefect = (t.type ?? '').toLowerCase() === 'defect';
    return isHigh || isDefect;
  });
  return sortByPriorityThenId(selected);
}

/**
 * BL-698 pin: in-flight = active folder, or ticket id owning a parcel.
 * Paused-only tickets are never selected.
 */
export function selectLandQueue(
  tickets: OperatorQueueTicket[],
  parcelTicketIds: string[] = []
): OperatorQueueTicket[] {
  const parcelSet = new Set(parcelTicketIds.map((id) => id.toUpperCase()));
  const selected = tickets.filter((t) => {
    if ((t.type ?? '').toLowerCase() === 'epic') {
      return false;
    }
    if (t.folder === 'active') {
      return true;
    }
    return parcelSet.has(t.id.toUpperCase());
  });
  return sortByPriorityThenId(selected);
}

function sortByPriorityThenId(tickets: OperatorQueueTicket[]): OperatorQueueTicket[] {
  return [...tickets].sort((a, b) => {
    const pa = a.priority ?? Number.POSITIVE_INFINITY;
    const pb = b.priority ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) {
      return pa - pb;
    }
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

export function formatDryRunList(label: string, tickets: OperatorQueueTicket[]): string {
  if (tickets.length === 0) {
    return `${label}: (empty)`;
  }
  const lines = tickets.map((t, i) => {
    const title = (t.title ?? '').trim() || '(no title)';
    const pri = t.priority !== undefined ? ` p${t.priority}` : '';
    return `${i + 1}. ${t.id}${pri} — ${title}`;
  });
  return [`${label} (${tickets.length}):`, ...lines].join('\n');
}
