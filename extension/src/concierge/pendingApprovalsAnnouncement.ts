// BL-649: swarm-start doorbell — POST a new Approvals topic message listing
// pending human_approval tickets (never an edit-in-place roster change).

export const ANNOUNCEMENT_REANNOUNCE_MS = 24 * 60 * 60 * 1000;
const TITLE_MAX = 80;
const CONTEXT_MAX = 200;

export interface PendingApprovalAnnouncementTicket {
  id: string;
  title?: string;
  approvalContext?: string;
  pendingSinceMs?: number;
}

export interface PendingApprovalsAnnouncementMarker {
  pendingSetIdentity: string;
  lastAnnouncedAtMs: number;
}

export interface PendingApprovalsAnnouncementAdapters {
  ensureApprovalsTopic: () => Promise<number | undefined>;
  postMessage: (topicId: number, text: string) => Promise<number | undefined>;
}

export interface PendingApprovalsAnnouncementResult {
  posted: boolean;
  messageId?: number;
  marker?: PendingApprovalsAnnouncementMarker;
}

export function pendingSetIdentity(ids: string[]): string {
  if (ids.length === 0) {
    return '';
  }
  return [...ids].sort().join(',');
}

export function shouldAnnouncePendingApprovals(
  marker: PendingApprovalsAnnouncementMarker | undefined,
  identity: string,
  hasPending: boolean,
  nowMs: number
): boolean {
  if (!hasPending || !identity) {
    return false;
  }
  if (!marker) {
    return true;
  }
  if (marker.pendingSetIdentity !== identity) {
    return true;
  }
  return nowMs - marker.lastAnnouncedAtMs >= ANNOUNCEMENT_REANNOUNCE_MS;
}

export function formatPendingAgeLabel(nowMs: number, pendingSinceMs?: number): string {
  if (pendingSinceMs === undefined || pendingSinceMs > nowMs) {
    return 'pending (age unknown)';
  }
  const deltaMs = nowMs - pendingSinceMs;
  const days = Math.floor(deltaMs / (24 * 60 * 60 * 1000));
  if (days >= 1) {
    return `pending ${days} day${days === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(deltaMs / (60 * 60 * 1000));
  if (hours >= 1) {
    return `pending ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const minutes = Math.max(1, Math.floor(deltaMs / (60 * 1000)));
  return `pending ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function lineForTicket(ticket: PendingApprovalAnnouncementTicket, nowMs: number): string {
  const titlePart = ticket.title ? truncate(ticket.title, TITLE_MAX) : 'untitled';
  const age = formatPendingAgeLabel(nowMs, ticket.pendingSinceMs);
  const header = `${ticket.id} - ${titlePart} - ${age}`;
  if (!ticket.approvalContext) {
    return header;
  }
  const snippet = truncate(ticket.approvalContext.replace(/\s+/g, ' ').trim(), CONTEXT_MAX);
  return `${header}\n> ${snippet}`;
}

/** Render announcement lines from ticket yaml fields only — never pane capture. */
export function renderPendingApprovalsAnnouncement(
  tickets: PendingApprovalAnnouncementTicket[],
  nowMs: number
): string {
  const sorted = [...tickets].sort((a, b) => a.id.localeCompare(b.id));
  const lines = sorted.map((t) => lineForTicket(t, nowMs));
  return ['📋 Pending approvals at swarm start:', '', ...lines].join('\n');
}

export async function runPendingApprovalsAnnouncement(
  tickets: PendingApprovalAnnouncementTicket[],
  marker: PendingApprovalsAnnouncementMarker | undefined,
  adapters: PendingApprovalsAnnouncementAdapters,
  nowMs: number
): Promise<PendingApprovalsAnnouncementResult> {
  const ids = tickets.map((t) => t.id);
  const identity = pendingSetIdentity(ids);
  if (!shouldAnnouncePendingApprovals(marker, identity, tickets.length > 0, nowMs)) {
    return { posted: false };
  }
  const topicId = await adapters.ensureApprovalsTopic();
  if (topicId === undefined) {
    return { posted: false };
  }
  const text = renderPendingApprovalsAnnouncement(tickets, nowMs);
  const messageId = await adapters.postMessage(topicId, text);
  if (messageId === undefined) {
    return { posted: false };
  }
  return {
    posted: true,
    messageId,
    marker: { pendingSetIdentity: identity, lastAnnouncedAtMs: nowMs },
  };
}
