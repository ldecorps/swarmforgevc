// BL-139: ticket identity color assignment. Color represents WHICH ticket,
// not which stage holds it, so it must be a pure function of the ticket id
// alone — stable across stage transitions and independent of whatever other
// tickets happen to be active at the same time (ticket-color-01).
//
// Each entry pairs a background with a text color chosen for contrast
// against that specific background, so the pairing stays readable
// regardless of the VS Code light/dark theme (the background itself does
// not follow the theme, matching the existing stage-color-* convention in
// webviewHtml.ts).
export interface TicketColor {
  background: string;
  color: string;
}

export const PALETTE: TicketColor[] = [
  { background: '#e6194b', color: '#fff' },
  { background: '#3cb44b', color: '#000' },
  { background: '#ffe119', color: '#000' },
  { background: '#4363d8', color: '#fff' },
  { background: '#f58231', color: '#000' },
  { background: '#911eb4', color: '#fff' },
  { background: '#46f0f0', color: '#000' },
  { background: '#f032e6', color: '#000' },
  { background: '#bcf60c', color: '#000' },
  { background: '#008080', color: '#fff' },
  { background: '#9a6324', color: '#fff' },
  { background: '#808000', color: '#fff' },
];

function hashTicketId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function ticketColorFor(ticketId: string): TicketColor {
  const index = hashTicketId(ticketId) % PALETTE.length;
  return PALETTE[index];
}

function compareTicketIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export interface TicketColorSegment {
  id: string;
  color: TicketColor;
}

// Deterministic, order-independent rendering contract for the multi-ticket
// rainbow indicator (ticket-color-04/05): dedupe, sort numerically so the
// same held set always produces the same segment order, then map each id
// through the same color assignment single-ticket badges use.
export function ticketColorSegments(ticketIds: string[]): TicketColorSegment[] {
  const uniqueIds = [...new Set(ticketIds)].sort(compareTicketIds);
  return uniqueIds.map((id) => ({ id, color: ticketColorFor(id) }));
}
