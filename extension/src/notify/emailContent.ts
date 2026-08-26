// Plain-text email body for BL-073's needs-human notifier: role, held ticket
// badge (BL-053 holder machinery), the detected prompt snippet, and a deep
// link to the captured claude.ai/code session — or a tile-answer fallback
// when no session URL has been captured yet.
export interface TicketBadge {
  id: string;
  summary: string;
}

export interface EmailContentParams {
  role: string;
  snippet: string;
  sessionUrl: string | null;
  ticketBadge: TicketBadge | null;
}

export function buildEmailSubject(role: string): string {
  return `SwarmForge: ${role} needs you`;
}

export function buildEmailBody(params: EmailContentParams): string {
  const lines: string[] = [`${params.role} is waiting on a response.`];

  if (params.ticketBadge) {
    lines.push(`Ticket: ${params.ticketBadge.id} — ${params.ticketBadge.summary}`);
  }

  if (params.snippet) {
    lines.push(`Prompt: ${params.snippet}`);
  }

  if (params.sessionUrl) {
    lines.push(`Open: ${params.sessionUrl}`);
  } else {
    lines.push('No session link captured — answer in the tile.');
  }

  return lines.join('\n');
}
