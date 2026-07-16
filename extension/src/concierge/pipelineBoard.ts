// BL-452: a live pipeline-board grid - active/paused BL tickets on the Y
// axis, pipeline roles (plus the parked/awaiting-approval status columns)
// on the X axis, a single mark at each ticket's current stage. Pure
// row-computation + render only (no I/O; mirrors topicIcon.ts's own
// pure/adapter split, with pipelineBoardSync.ts as the I/O half).
import { ALL_SWARM_ROLES } from './roleTopicMapStore';

export interface PipelineBoardRow {
  id: string;
  column: string;
}

export interface PipelineBoardPausedItem {
  id: string;
  humanApproval?: 'pending' | 'approved';
}

// The two status columns a PAUSED ticket lands in - distinct from
// ALL_SWARM_ROLES (a role a ticket is actively HELD by). 'awaiting-approval'
// mirrors topicIcon.ts's own paused-scoped fifth state (BL-424): a paused
// ticket blocked only on the human's own approval is actionable by him right
// now, distinct from any other paused hold (dependency, overlap, deliberate
// park).
const PIPELINE_BOARD_STATUS_COLUMNS = ['parked', 'awaiting-approval'] as const;

export const PIPELINE_BOARD_COLUMN_ORDER: readonly string[] = [...ALL_SWARM_ROLES, ...PIPELINE_BOARD_STATUS_COLUMNS];

// Short, fixed-width column glyphs - the full role names (e.g.
// "awaiting-approval", "coordinator") are far too wide for a 10-column grid
// on a phone screen. Exact glyphs are a build-time/cosmetic detail, not a
// promotion gate (BL-452's own human_approval note).
const COLUMN_LABEL: Record<string, string> = {
  specifier: 'SP',
  coder: 'CO',
  cleaner: 'CL',
  architect: 'AR',
  hardender: 'HD',
  documenter: 'DC',
  QA: 'QA',
  coordinator: 'CD',
  parked: 'PK',
  'awaiting-approval': 'AA',
};

const TICKET_HEADER = 'TICKET';

// Every role-held ticket first (in PIPELINE_BOARD_COLUMN_ORDER's own role
// order, never object-key order, so the grid always groups top-of-pipeline
// to bottom the same way regardless of the adapter's own iteration order),
// then every paused ticket - parked, or awaiting-approval when the human's
// own approval is the specific thing blocking it. An active ticket currently
// held by no role (should not happen in steady state - see the ticket's own
// "no empty rows" constraint) is simply not a row: this function only ever
// creates a row it can assign a real column to.
export function computePipelineBoardRows(
  roleHeldTickets: Record<string, string[]>,
  paused: PipelineBoardPausedItem[]
): PipelineBoardRow[] {
  const rows: PipelineBoardRow[] = [];
  for (const role of ALL_SWARM_ROLES) {
    for (const id of roleHeldTickets[role] ?? []) {
      rows.push({ id, column: role });
    }
  }
  for (const item of paused) {
    rows.push({ id: item.id, column: item.humanApproval === 'pending' ? 'awaiting-approval' : 'parked' });
  }
  return rows;
}

function idColumnWidth(rows: PipelineBoardRow[]): number {
  return Math.max(TICKET_HEADER.length, ...rows.map((r) => r.id.length));
}

function renderHeader(idWidth: number): string {
  const cells = PIPELINE_BOARD_COLUMN_ORDER.map((c) => COLUMN_LABEL[c]);
  return [TICKET_HEADER.padEnd(idWidth), ...cells].join(' ');
}

function renderDataRow(idWidth: number, row: PipelineBoardRow): string {
  const cells = PIPELINE_BOARD_COLUMN_ORDER.map((c) => (c === row.column ? 'X' : '.').padStart(COLUMN_LABEL[c].length));
  return [row.id.padEnd(idWidth), ...cells].join(' ');
}

export function renderPipelineBoard(rows: PipelineBoardRow[]): string {
  const idWidth = idColumnWidth(rows);
  return [renderHeader(idWidth), ...rows.map((row) => renderDataRow(idWidth, row))].join('\n');
}

// Telegram's own HTML parse_mode requires only these three characters
// escaped inside a <pre> block (unlike MarkdownV2's much larger escape set) -
// ticket ids and column glyphs never carry them in practice, but the wrap
// must not corrupt the markup if they ever did.
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function wrapPipelineBoardHtml(text: string): string {
  return `<pre>${escapeHtml(text)}</pre>`;
}
