// BL-452/BL-455: a live pipeline-board grid - active BL tickets on the Y
// axis, pipeline roles on the X axis, a single mark at each ticket's current
// stage, grouped by epic; parked/awaiting-approval tickets are listed
// separately below the grid, and every row carries a short slug derived from
// the ticket's title. Pure row-computation + render only (no I/O; mirrors
// topicIcon.ts's own pure/adapter split, with pipelineBoardSync.ts as the I/O
// half).
import { ALL_SWARM_ROLES } from './roleTopicMapStore';

export interface PipelineBoardRow {
  id: string;
  column: string;
  epic?: string;
  slug: string;
}

export interface PipelineBoardParkedEntry {
  id: string;
  slug: string;
  status: 'parked' | 'awaiting-approval';
}

export interface PipelineBoardData {
  rows: PipelineBoardRow[];
  parked: PipelineBoardParkedEntry[];
}

export interface PipelineBoardPausedItem {
  id: string;
  humanApproval?: 'pending' | 'approved';
}

// BL-455: the join key a caller (conciergeTick.ts's syncBoardIfWired) feeds
// in per ticket id - epic/title already live on BacklogItem
// (backlogReader.ts), read from the folders the tick already loads. Neither
// field is required: a ticket id with no entry (or an entry with no title)
// still renders - just with an empty slug and in the no-epic group.
export interface PipelineBoardTicketMeta {
  epic?: string;
  title?: string;
}

export const PIPELINE_BOARD_COLUMN_ORDER: readonly string[] = ALL_SWARM_ROLES;

// Short, fixed-width column glyphs - the full role names are far too wide
// for a grid on a phone screen. Exact glyphs are a build-time/cosmetic
// detail, not a promotion gate (BL-452's own human_approval note).
const COLUMN_LABEL: Record<string, string> = {
  specifier: 'SP',
  coder: 'CO',
  cleaner: 'CL',
  architect: 'AR',
  hardender: 'HD',
  documenter: 'DC',
  QA: 'QA',
  coordinator: 'CD',
};

// BL-455: parked/awaiting-approval are no longer grid COLUMNS (they were in
// BL-452) - the glyphs move to labelling below-grid list entries instead.
const STATUS_LABEL: Record<'parked' | 'awaiting-approval', string> = {
  parked: 'PK',
  'awaiting-approval': 'AA',
};

const TICKET_HEADER = 'TICKET';
const SLUG_HEADER = 'SLUG';
const NO_EPIC_LABEL = '(no epic)';
const PARKED_SECTION_HEADER = 'PARKED:';

// A build-time detail, not a promotion gate (BL-455's own human_approval
// note) - bounds a slug to a single short, phone-width line.
export const PIPELINE_BOARD_SLUG_MAX_LENGTH = 24;

// BL-455: a short, single-line, delimiter-safe projection of a ticket's
// title - never the raw title verbatim (engineering external-text-into-
// structured-output rule: strip newlines before the value reaches any
// generated output). A missing title (no backlog item was joined for this
// id) renders as an empty slug rather than throwing - the row still shows
// the ticket's id and stage/status.
export function deriveTicketSlug(title: string | undefined): string {
  if (!title) {
    return '';
  }
  const singleLine = title.replace(/[\r\n]+/g, ' ').trim();
  return singleLine.length > PIPELINE_BOARD_SLUG_MAX_LENGTH
    ? `${singleLine.slice(0, PIPELINE_BOARD_SLUG_MAX_LENGTH - 1)}…`
    : singleLine;
}

// Sorts named epics alphabetically, with the no-epic bucket always LAST -
// deterministic regardless of role/ticket iteration order, so the
// edge-triggered rendered-text comparison in pipelineBoardSync.ts stays
// stable tick over tick (BL-455's own "fixed epic + ticket ordering, not
// hash-order" constraint).
function epicSortKey(epic: string | undefined): string {
  return epic === undefined ? `\uFFFF${NO_EPIC_LABEL}` : epic;
}

// Every role-held ticket first (in PIPELINE_BOARD_COLUMN_ORDER's own role
// order, never object-key order), then grouped by epic via a STABLE sort
// (Array#sort is spec-guaranteed stable in Node), so ties within the same
// epic keep their original role-order. A ticket held by no role never
// becomes a row (see this module's own "no empty rows" constraint,
// upstream in BL-455's ticket).
//
// Paused tickets never enter the grid at all (BL-455 rule 2): each becomes
// a below-grid PipelineBoardParkedEntry instead, sorted by id so the list
// is deterministic too. A paused ticket with humanApproval 'pending' is
// 'awaiting-approval'; every other paused ticket (absent, or 'approved') is
// plain 'parked' - unchanged from BL-452's own column-assignment rule, just
// relocated off the grid.
export function computePipelineBoard(
  roleHeldTickets: Record<string, string[]>,
  paused: PipelineBoardPausedItem[],
  ticketMeta: Record<string, PipelineBoardTicketMeta>
): PipelineBoardData {
  const rawRows: PipelineBoardRow[] = [];
  for (const role of ALL_SWARM_ROLES) {
    for (const id of roleHeldTickets[role] ?? []) {
      const meta = ticketMeta[id];
      rawRows.push({ id, column: role, epic: meta?.epic, slug: deriveTicketSlug(meta?.title) });
    }
  }
  const rows = [...rawRows].sort((a, b) => epicSortKey(a.epic).localeCompare(epicSortKey(b.epic)));

  const parked = [...paused]
    .map(
      (item): PipelineBoardParkedEntry => ({
        id: item.id,
        slug: deriveTicketSlug(ticketMeta[item.id]?.title),
        status: item.humanApproval === 'pending' ? 'awaiting-approval' : 'parked',
      })
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  return { rows, parked };
}

function idColumnWidth(rows: PipelineBoardRow[]): number {
  return Math.max(TICKET_HEADER.length, ...rows.map((r) => r.id.length));
}

function slugColumnWidth(rows: PipelineBoardRow[]): number {
  return Math.max(SLUG_HEADER.length, ...rows.map((r) => r.slug.length));
}

function renderHeader(idWidth: number, slugWidth: number): string {
  const cells = PIPELINE_BOARD_COLUMN_ORDER.map((c) => COLUMN_LABEL[c]);
  return [TICKET_HEADER.padEnd(idWidth), SLUG_HEADER.padEnd(slugWidth), ...cells].join(' ');
}

function renderDataRow(idWidth: number, slugWidth: number, row: PipelineBoardRow): string {
  const cells = PIPELINE_BOARD_COLUMN_ORDER.map((c) => (c === row.column ? 'X' : '.').padStart(COLUMN_LABEL[c].length));
  return [row.id.padEnd(idWidth), row.slug.padEnd(slugWidth), ...cells].join(' ');
}

function renderEpicHeading(epic: string | undefined): string {
  return `-- ${epic ?? NO_EPIC_LABEL} --`;
}

// Interleaves an epic-group heading before the first row of each epic -
// rows already arrive epic-grouped via computePipelineBoard's own stable
// sort, so this is a pure formatting pass, never a re-sort.
function renderGridLines(rows: PipelineBoardRow[], idWidth: number, slugWidth: number): string[] {
  const lines: string[] = [];
  let started = false;
  let currentEpic: string | undefined;
  for (const row of rows) {
    if (!started || row.epic !== currentEpic) {
      lines.push(renderEpicHeading(row.epic));
      currentEpic = row.epic;
      started = true;
    }
    lines.push(renderDataRow(idWidth, slugWidth, row));
  }
  return lines;
}

// Omitted entirely when there is nothing parked (BL-455: "every active
// ticket lands in exactly one place" - an empty parked list is a normal
// steady state, not a section worth rendering).
function renderParkedSection(parked: PipelineBoardParkedEntry[]): string[] {
  if (parked.length === 0) {
    return [];
  }
  const lines: string[] = ['', PARKED_SECTION_HEADER];
  for (const entry of parked) {
    lines.push(`  ${STATUS_LABEL[entry.status]} ${entry.id} ${entry.slug}`.trimEnd());
  }
  return lines;
}

export function renderPipelineBoard(data: PipelineBoardData): string {
  const idWidth = idColumnWidth(data.rows);
  const slugWidth = slugColumnWidth(data.rows);
  const lines = [
    renderHeader(idWidth, slugWidth),
    ...renderGridLines(data.rows, idWidth, slugWidth),
    ...renderParkedSection(data.parked),
  ];
  return lines.join('\n');
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
