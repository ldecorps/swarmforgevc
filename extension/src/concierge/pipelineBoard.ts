// BL-452/BL-455/BL-465: a live pipeline-board grid - active BL tickets on
// the Y axis, pipeline roles on the X axis, a single mark at each ticket's
// current stage, grouped by epic; parked/awaiting-approval/paused/
// root-intake/recently-closed items are listed separately below the grid,
// each entry leading with a short kebab slug, plus a tappable GitHub link
// list keyed by ticket id (Telegram cannot render links inside the grid's
// own <pre> block). Pure row-computation + render only (no I/O; mirrors
// topicIcon.ts's own pure/adapter split, with pipelineBoardSync.ts as the
// I/O half).
import { ALL_SWARM_ROLES } from './roleTopicMapStore';

export interface PipelineBoardRow {
  id: string;
  column: string;
  epic?: string;
  // BL-465: the grid's OWN slug column shows a SHORT (2-3 word) kebab slug
  // only - the grid has no title column to widen (its width is spent on
  // the 8 stage columns). Distinct from PipelineBoardParkedEntry/
  // PipelineBoardListEntry's own `slug` below, which carries MORE text.
  slug: string;
}

// BL-465: shared shape for every below-grid list line (parked, root-intake,
// recently-closed) - `slug` here is the WIDER combined line (kebab slug +
// more of the truncated title), not the grid's own short kebab-only slug.
export interface PipelineBoardListEntry {
  id: string;
  slug: string;
}

export interface PipelineBoardParkedEntry extends PipelineBoardListEntry {
  status: 'parked' | 'awaiting-approval';
}

// BL-465: one link-list line - a ticket/intake id resolved to its
// repo-relative backlog path, for the tappable GitHub link list below the
// grid (the grid/lists themselves carry no inline links - Telegram does
// not render links inside a <pre> block).
export interface PipelineBoardLinkEntry {
  id: string;
  path: string;
}

export interface PipelineBoardData {
  rows: PipelineBoardRow[];
  parked: PipelineBoardParkedEntry[];
  rootIntake: PipelineBoardListEntry[];
  recentlyClosed: PipelineBoardListEntry[];
  links: PipelineBoardLinkEntry[];
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
// BL-465: filename/location added for the GitHub link list - the SAME
// BacklogItem.filename backlogReader.ts now captures, never a filename
// reconstructed from the title (which could drift and 404).
export interface PipelineBoardTicketMeta {
  epic?: string;
  title?: string;
  filename?: string;
  location?: 'active' | 'paused';
}

// BL-465: recently-closed/root-intake items feed in as raw {id, title,
// filename} triples (root-intake ids are a raw filename stem, e.g. an
// "INTAKE-..." .md file, not a BL-### ticket id) - kept separate from
// PipelineBoardTicketMeta since these are NOT joined against role-held/
// paused ids at all, just rendered as their own list.
export interface PipelineBoardListSourceItem {
  id: string;
  title?: string;
  filename: string;
}

// BL-465: additional, OPTIONAL inputs this ticket adds - every existing
// 3-arg computePipelineBoard call site (conciergeTick.ts's own real caller,
// plus the pre-BL-465 unit/acceptance fixtures) keeps working completely
// unchanged; only a caller that wants the new sections/links passes this.
export interface PipelineBoardExtras {
  rootIntake?: PipelineBoardListSourceItem[];
  recentlyClosed?: PipelineBoardListSourceItem[];
  // The repo's GitHub base URL (e.g. "https://github.com/ldecorps/swarmforgevc")
  // - absent means "not resolvable this tick" (e.g. no git remote), in
  // which case the link list is omitted entirely rather than emitting
  // broken/relative links.
  repoBaseUrl?: string;
  // BL-473: the physical backlog/active/ membership set - ground truth for
  // "what is active" (the human's own contract: the board must be at least
  // as complete as the static PWA, which lists every active ticket). Every
  // id here gets exactly one grid row; the role-held map only DECORATES
  // that row's stage, defaulting to the not-started state when the map has
  // no stage for it. Absent (undefined, the pre-BL-473 shape) defaults to
  // the ids already implied by roleHeldTickets - i.e. every pre-existing
  // call site (which never passed this) keeps rendering identically; only
  // a caller that wants a ticket physically active-but-unheld to still
  // render (conciergeTick.ts's real wiring) passes this.
  activeIds?: string[];
}

// BL-473: the not-started sentinel column - a distinct state for an active
// ticket no role currently holds, never one of the real pipeline roles.
// Placed LAST in PIPELINE_BOARD_COLUMN_ORDER below (the human's own stated
// preference 2026-07-16: "a dedicated 'not started' column on the
// right-hand side").
export const PIPELINE_BOARD_NOT_STARTED_COLUMN = 'not-started';

export const PIPELINE_BOARD_COLUMN_ORDER: readonly string[] = [...ALL_SWARM_ROLES, PIPELINE_BOARD_NOT_STARTED_COLUMN];

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
  [PIPELINE_BOARD_NOT_STARTED_COLUMN]: 'NS',
};

const TICKET_HEADER = 'TICKET';
const SLUG_HEADER = 'SLUG';
const NO_EPIC_LABEL = '(no epic)';
const PARKED_SECTION_HEADER = 'PARKED:';
const AWAITING_APPROVAL_SECTION_HEADER = 'AWAITING APPROVAL:';
const ROOT_INTAKE_SECTION_HEADER = 'ROOT INTAKE:';
const RECENTLY_CLOSED_SECTION_HEADER = 'RECENTLY CLOSED:';
const LINKS_SECTION_HEADER = 'LINKS:';

// BL-465: how many recently-closed items the board shows below the grid -
// a build-time/cosmetic bound (the ticket's own "the precise recently-
// closed window" note), not a promotion gate. The caller (conciergeTick.ts)
// decides WHICH items count as "recent"; this only bounds the list length.
export const PIPELINE_BOARD_RECENTLY_CLOSED_MAX = 5;

// BL-502: Telegram's own sendMessage text limit is 4096 chars; a small
// safety margin below it absorbs the HTML entity expansion escapeHtml adds
// (each &/</> becomes 4-5 chars) and any off-by-a-few in a future render
// tweak, without eating meaningfully into the link budget. Every consumer
// of the send limit (budgetPipelineBoardLinks below, its caller in
// pipelineBoardSync.ts) reads this ONE constant, never a hardcoded number
// of its own.
export const PIPELINE_BOARD_MESSAGE_MAX_LENGTH = 4000;

// BL-465: the grid's own short kebab slug - 2-3 significant words, lower-
// cased and hyphenated, mirroring the ticket's own backlog-filename slug
// convention (e.g. "BL-467-pipeline-board-only-pin" -> "pipeline-board-
// only"). Derived from the TITLE rather than re-reading the real filename
// (a build-time/cosmetic detail per the ticket's own note) - in practice
// close to the real on-disk slug, since a title and its filename slug are
// authored together.
export function deriveKebabSlug(title: string | undefined, maxWords = 3): string {
  if (!title) {
    return '';
  }
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join('-');
}

// A build-time detail, not a promotion gate (BL-455's own human_approval
// note) - bounds a slug to a single short, phone-width line. Widened by
// BL-462 (24 -> 40, "longer slug, same line"); BL-465 widens it again for
// the below-grid LIST entries specifically ("shows more of the title than
// the previous limit allowed") - the grid itself no longer uses this bound
// at all (it shows deriveKebabSlug's own short form instead).
export const PIPELINE_BOARD_SLUG_MAX_LENGTH = 60;

// BL-455: a short, single-line, delimiter-safe projection of a ticket's
// title - never the raw title verbatim (engineering external-text-into-
// structured-output rule: strip newlines before the value reaches any
// generated output). A missing title renders as an empty slug rather than
// throwing.
export function deriveTicketSlug(title: string | undefined): string {
  if (!title) {
    return '';
  }
  const singleLine = title.replace(/[\r\n]+/g, ' ').trim();
  return singleLine.length > PIPELINE_BOARD_SLUG_MAX_LENGTH
    ? `${singleLine.slice(0, PIPELINE_BOARD_SLUG_MAX_LENGTH - 1)}…`
    : singleLine;
}

// BL-465: the below-grid list's own combined line - leads with the short
// kebab slug, then fills the remaining width with more of the truncated
// title (the human's own "both: slug + wider title" decision). A missing
// title still leads with the kebab slug (empty here too) rather than
// throwing.
export function deriveListEntryText(title: string | undefined): string {
  const kebab = deriveKebabSlug(title);
  const wider = deriveTicketSlug(title);
  return kebab ? `${kebab} ${wider}`.trim() : wider;
}

// Sorts named epics alphabetically, with the no-epic bucket always LAST -
// deterministic regardless of role/ticket iteration order, so the
// edge-triggered rendered-text comparison in pipelineBoardSync.ts stays
// stable tick over tick (BL-455's own "fixed epic + ticket ordering, not
// hash-order" constraint).
function epicSortKey(epic: string | undefined): string {
  return epic === undefined ? `￿${NO_EPIC_LABEL}` : epic;
}

function linkPathFor(meta: PipelineBoardTicketMeta | undefined): string | undefined {
  if (!meta?.filename || !meta.location) {
    return undefined;
  }
  return `backlog/${meta.location}/${meta.filename}`;
}

function listEntryFor(item: PipelineBoardListSourceItem): PipelineBoardListEntry {
  return { id: item.id, slug: deriveListEntryText(item.title) };
}

// BL-464: a ticket id observed under more than one role - the exact
// double-row defect a mid-transition in_process scrape used to produce -
// collapses to exactly one held role, never two. ALL_SWARM_ROLES is
// iterated in pipeline order, so a LATER occurrence (a more downstream
// role) overwrites an earlier one in the Map, mirroring
// pipeline_stage_lib.bb's own reconcile-stage-map "most downstream wins"
// rule - the same guarantee, belt-and-braces at the renderer, whatever the
// authoritative source's own shape already structurally prevents.
function heldRoleByTicketId(roleHeldTickets: Record<string, string[]>): Map<string, string> {
  const heldRoleById = new Map<string, string>();
  for (const role of ALL_SWARM_ROLES) {
    for (const id of roleHeldTickets[role] ?? []) {
      heldRoleById.set(id, role);
    }
  }
  return heldRoleById;
}

// BL-473: row MEMBERSHIP is exactly `activeIds` (the physical backlog/active/
// set, ground truth) - the role-held map only DECORATES a member's stage,
// defaulting to the not-started sentinel when the map has no stage for it.
// A role-held id absent from activeIds gets no row at all (activeIds is the
// SOLE source iterated below, never merged with heldRoleById's own keys) -
// this is what makes "every file in backlog/active/ is a row exactly once,
// and only those" hold as a property of this function, independent of
// whatever membership its caller decides to pass. Omitting activeIds
// (undefined) defaults to the ids already implied by roleHeldTickets - the
// exact pre-BL-473 behavior every existing call site relied on.
//
// Grouped by epic via a STABLE sort (Array#sort is spec-guaranteed stable in
// Node), so ties within the same epic keep their original role/insertion
// order.
//
// Paused tickets never enter the grid at all (BL-455 rule 2): each becomes
// a below-grid PipelineBoardParkedEntry instead, sorted by id so the list
// is deterministic too. A paused ticket with humanApproval 'pending' is
// 'awaiting-approval'; every other paused ticket (absent, or 'approved') is
// plain 'parked' - unchanged from BL-452's own column-assignment rule, just
// relocated off the grid.
// Split out of computePipelineBoard below for the same CRAP-budget reason
// documented throughout this codebase (e.g. telegramFrontDeskBotCore.ts's
// gatherControlState) - one active ticket becomes one grid row, held in a
// Map (never a plain array push) so a duplicate id in `activeIds` collapses
// to one row too.
function buildGridRows(
  roleHeldTickets: Record<string, string[]>,
  ticketMeta: Record<string, PipelineBoardTicketMeta>,
  activeIds?: string[]
): PipelineBoardRow[] {
  const heldRoleById = heldRoleByTicketId(roleHeldTickets);
  const ids = activeIds ?? [...heldRoleById.keys()];
  const rowsById = new Map<string, PipelineBoardRow>();
  for (const id of ids) {
    const meta = ticketMeta[id];
    const column = heldRoleById.get(id) ?? PIPELINE_BOARD_NOT_STARTED_COLUMN;
    rowsById.set(id, { id, column, epic: meta?.epic, slug: deriveKebabSlug(meta?.title) });
  }
  return [...rowsById.values()].sort((a, b) => epicSortKey(a.epic).localeCompare(epicSortKey(b.epic)));
}

// Split out of computePipelineBoard below for the same CRAP-budget reason
// as buildGridRows above.
function buildParkedEntries(
  paused: PipelineBoardPausedItem[],
  ticketMeta: Record<string, PipelineBoardTicketMeta>
): PipelineBoardParkedEntry[] {
  return [...paused]
    .map(
      (item): PipelineBoardParkedEntry => ({
        id: item.id,
        slug: deriveListEntryText(ticketMeta[item.id]?.title),
        status: item.humanApproval === 'pending' ? 'awaiting-approval' : 'parked',
      })
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

// The four link SOURCES below each mirror one of the board's own sections
// (grid rows, parked, recently-closed, root-intake) - split into one
// function per source (rather than four loops inlined in buildLinks) for
// the same CRAP-budget reason as buildGridRows above; buildLinks itself
// just concatenates and sorts.
function linksFromRows(rows: PipelineBoardRow[], ticketMeta: Record<string, PipelineBoardTicketMeta>): PipelineBoardLinkEntry[] {
  const links: PipelineBoardLinkEntry[] = [];
  for (const row of rows) {
    const path = linkPathFor(ticketMeta[row.id]);
    if (path) {
      links.push({ id: row.id, path });
    }
  }
  return links;
}

function linksFromParked(
  parked: PipelineBoardParkedEntry[],
  ticketMeta: Record<string, PipelineBoardTicketMeta>
): PipelineBoardLinkEntry[] {
  const links: PipelineBoardLinkEntry[] = [];
  for (const entry of parked) {
    const path = linkPathFor(ticketMeta[entry.id]);
    if (path) {
      links.push({ id: entry.id, path });
    }
  }
  return links;
}

function linksFromRecentlyClosed(extras: PipelineBoardExtras): PipelineBoardLinkEntry[] {
  return (extras.recentlyClosed ?? []).map((item) => ({ id: item.id, path: `backlog/done/${item.filename}` }));
}

function linksFromRootIntake(extras: PipelineBoardExtras): PipelineBoardLinkEntry[] {
  return (extras.rootIntake ?? []).map((item) => ({ id: item.id, path: `backlog/${item.filename}` }));
}

// Split out of computePipelineBoard below for the same CRAP-budget reason
// as buildGridRows above. Only called once extras.repoBaseUrl is confirmed
// present (see computePipelineBoard's own ternary) - a link list without a
// resolvable repo base would emit broken/relative links, per
// PipelineBoardExtras.repoBaseUrl's own comment.
function buildLinks(
  rows: PipelineBoardRow[],
  parked: PipelineBoardParkedEntry[],
  extras: PipelineBoardExtras,
  ticketMeta: Record<string, PipelineBoardTicketMeta>
): PipelineBoardLinkEntry[] {
  const links = [
    ...linksFromRows(rows, ticketMeta),
    ...linksFromParked(parked, ticketMeta),
    ...linksFromRecentlyClosed(extras),
    ...linksFromRootIntake(extras),
  ];
  links.sort((a, b) => a.id.localeCompare(b.id));
  return links;
}

export function computePipelineBoard(
  roleHeldTickets: Record<string, string[]>,
  paused: PipelineBoardPausedItem[],
  ticketMeta: Record<string, PipelineBoardTicketMeta>,
  extras: PipelineBoardExtras = {}
): PipelineBoardData {
  const rows = buildGridRows(roleHeldTickets, ticketMeta, extras.activeIds);
  const parked = buildParkedEntries(paused, ticketMeta);
  const rootIntake = [...(extras.rootIntake ?? [])].map(listEntryFor).sort((a, b) => a.id.localeCompare(b.id));
  // BL-465 bounce (architect review): unlike rootIntake/parked above,
  // recently-closed order IS the whole point of the section - re-sorting
  // it alphabetically here silently discarded whatever recency order the
  // caller (conciergeTick.ts's recentlyClosedItems) worked out, which is
  // this function's OWN documented contract just above
  // (PIPELINE_BOARD_RECENTLY_CLOSED_MAX's comment: "the caller decides
  // WHICH items count as 'recent'; this only bounds the list length").
  // Slice-then-map only, preserving the caller's order exactly.
  const recentlyClosed = [...(extras.recentlyClosed ?? [])].slice(0, PIPELINE_BOARD_RECENTLY_CLOSED_MAX).map(listEntryFor);
  const links = extras.repoBaseUrl ? buildLinks(rows, parked, extras, ticketMeta) : [];

  return { rows, parked, rootIntake, recentlyClosed, links };
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

// BL-465: renders one below-grid section (parked/awaiting-approval/root-
// intake/recently-closed) - omitted entirely when empty (BL-455's own
// "every active ticket lands in exactly one place" convention, extended
// here to every below-grid list: an empty section is a normal steady
// state, not worth rendering). No per-line status label anymore (drops
// BL-452's PK/AA glyphs) - the SECTION HEADER itself is the label now.
function renderListSection(header: string, entries: PipelineBoardListEntry[]): string[] {
  if (entries.length === 0) {
    return [];
  }
  const lines: string[] = ['', header];
  for (const entry of entries) {
    lines.push(`  ${entry.id} ${entry.slug}`.trimEnd());
  }
  return lines;
}

// BL-465: defaults every below-grid section to empty (?? []) - a fixture
// built before this ticket (still ubiquitous across pre-existing unit/
// acceptance tests) supplies only {rows, parked}; the two NEW sections
// this ticket adds simply render as absent, exactly the pre-BL-465 shape,
// rather than every one of those fixtures needing a mechanical update.
function renderBodySections(data: PipelineBoardData): string[] {
  const idWidth = idColumnWidth(data.rows);
  const slugWidth = slugColumnWidth(data.rows);
  const parked = data.parked ?? [];
  return [
    renderHeader(idWidth, slugWidth),
    ...renderGridLines(data.rows, idWidth, slugWidth),
    ...renderListSection(
      PARKED_SECTION_HEADER,
      parked.filter((p) => p.status === 'parked')
    ),
    ...renderListSection(
      AWAITING_APPROVAL_SECTION_HEADER,
      parked.filter((p) => p.status === 'awaiting-approval')
    ),
    ...renderListSection(ROOT_INTAKE_SECTION_HEADER, data.rootIntake ?? []),
    ...renderListSection(RECENTLY_CLOSED_SECTION_HEADER, data.recentlyClosed ?? []),
  ];
}

// BL-462: the grid + below-grid sections only, EXCLUDING the footer
// timestamp AND the link list - pipelineBoardSync.ts's own content
// signature is this text (never the full renderPipelineBoard output
// below). The link list is fully DERIVED from the same rows/parked/
// rootIntake/recentlyClosed data already in the signature (never an
// independent source of change) and repoBaseUrl is a render-time-only
// concern, so omitting it here cannot hide a real content change.
export function renderPipelineBoardBody(data: PipelineBoardData): string {
  return renderBodySections(data).join('\n');
}

const MONTH_LABELS: readonly string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// BL-462: a pure function of an injected epoch-ms - never a bare
// new Date()/Date.now() (engineering no-real-clock rule). UTC throughout so
// the label is deterministic regardless of the host's local timezone; exact
// glyphs/timezone are a build-time detail, not a promotion gate (the
// ticket's own human_approval note).
export function formatUpdatedAtLabel(epochMs: number): string {
  const d = new Date(epochMs);
  const month = MONTH_LABELS[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${month} ${day} ${hours}:${minutes}`;
}

function renderUpdatedAtFooter(lastChangeMs: number): string {
  return `updated at ${formatUpdatedAtLabel(lastChangeMs)}`;
}

// BL-462: the full board - the pure grid/below-grid body plus an "updated
// at" footer stamped with the last CONTENT-change instant (never the
// current clock - the caller, pipelineBoardSync.ts, only ever passes the
// instant it recorded for the last actual content change, per its own
// change-gate). Stays the <pre>-wrapped monospace portion ONLY - the link
// list is a SEPARATE render (renderPipelineBoardLinks below), since
// Telegram never renders a real <a href> tag placed inside a <pre> block
// (same platform wall as BL-449's icon glyphs) - it would just show up as
// escaped literal text, not a tappable link.
export function renderPipelineBoard(data: PipelineBoardData, lastChangeMs: number): string {
  return [...renderBodySections(data), '', renderUpdatedAtFooter(lastChangeMs)].join('\n');
}

function pipelineBoardLinkLine(link: PipelineBoardLinkEntry, repoBaseUrl: string): string {
  return `${link.id}: <a href="${repoBaseUrl}/blob/main/${link.path}">${link.path}</a>`;
}

// BL-465: the tappable link list below the grid, as its OWN plain-HTML
// fragment (real <a href> tags) - never placed inside the <pre> block
// above. Empty string (nothing to append) when there are no links at all,
// or repoBaseUrl could not be resolved this tick (e.g. no git remote) -
// omitted rather than emitting broken relative links.
export function renderPipelineBoardLinks(links: PipelineBoardLinkEntry[], repoBaseUrl: string | undefined): string {
  if (links.length === 0 || !repoBaseUrl) {
    return '';
  }
  const lines = [LINKS_SECTION_HEADER, ...links.map((link) => pipelineBoardLinkLine(link, repoBaseUrl))];
  return lines.join('\n');
}

function pipelineBoardOverflowLine(omittedCount: number): string {
  return `+${omittedCount} more`;
}

export interface PipelineBoardLinksBudget {
  html: string;
  omittedCount: number;
}

// BL-502: the link list above has NO bound of its own - one line per
// linkable entry - so at any backlog of comparable-or-larger size than
// ~16 entries the FULL list alone pushes the composed message over
// Telegram's whole-message send limit, and every post is rejected "text
// is too long" (live outage 2026-07-17). Unlike a transient failure,
// retrying the SAME oversized payload never succeeds - the PAYLOAD must
// shrink. This budgets the link list to maxLinksLength (the space
// PIPELINE_BOARD_MESSAGE_MAX_LENGTH has left after the grid/parked body,
// computed by the caller - pipelineBoardSync.ts) - included IN FULL when
// it fits (the common case, byte-identical to the pre-budget render,
// omittedCount 0), else TRIMMED, in list order, to the largest prefix
// that still leaves room for a VISIBLE "+N more" indicator naming exactly
// how many were dropped - never a silent cap (this codebase's
// no-silent-cap posture, mirroring PIPELINE_BOARD_RECENTLY_CLOSED_MAX's
// own bounded list).
export function budgetPipelineBoardLinks(links: PipelineBoardLinkEntry[], repoBaseUrl: string | undefined, maxLinksLength: number): PipelineBoardLinksBudget {
  if (links.length === 0 || !repoBaseUrl) {
    return { html: '', omittedCount: 0 };
  }
  const full = renderPipelineBoardLinks(links, repoBaseUrl);
  if (full.length <= maxLinksLength) {
    return { html: full, omittedCount: 0 };
  }
  const includedLines: string[] = [];
  for (const link of links) {
    const candidateOmitted = links.length - (includedLines.length + 1);
    const candidateLines = [LINKS_SECTION_HEADER, ...includedLines, pipelineBoardLinkLine(link, repoBaseUrl)];
    if (candidateOmitted > 0) {
      candidateLines.push(pipelineBoardOverflowLine(candidateOmitted));
    }
    if (candidateLines.join('\n').length > maxLinksLength) {
      break;
    }
    includedLines.push(pipelineBoardLinkLine(link, repoBaseUrl));
  }
  const omittedCount = links.length - includedLines.length;
  if (omittedCount === 0) {
    return { html: [LINKS_SECTION_HEADER, ...includedLines].join('\n'), omittedCount: 0 };
  }
  const lines = [LINKS_SECTION_HEADER, ...includedLines, pipelineBoardOverflowLine(omittedCount)];
  if (lines.join('\n').length > maxLinksLength) {
    // Not even the header + omitted-count indicator alone fits within the
    // remaining budget - degrade to no links at all rather than emit a
    // message still over budget (never happens at realistic backlog sizes:
    // the grid/parked body is small and bounded, so this remains a
    // generous budget in practice).
    return { html: '', omittedCount: links.length };
  }
  return { html: lines.join('\n'), omittedCount };
}

// Telegram's own HTML parse_mode requires only these three characters
// escaped inside a <pre> block (unlike MarkdownV2's much larger escape set) -
// ticket ids and column glyphs never carry them in practice, but the wrap
// must not corrupt the markup if they ever did.
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// BL-465: only the grid/list/footer TEXT (renderPipelineBoard's own output)
// is wrapped in <pre> - the link list (renderPipelineBoardLinks, already
// real HTML) is appended AFTER the closing </pre>, completely unescaped,
// so its <a href> tags render as tappable links. linksHtml empty (the
// common case: no links yet, or no repoBaseUrl) leaves the message
// byte-for-byte the pre-BL-465 <pre>-only shape.
export function wrapPipelineBoardHtml(boardText: string, linksHtml = ''): string {
  const pre = `<pre>${escapeHtml(boardText)}</pre>`;
  return linksHtml ? `${pre}\n\n${linksHtml}` : pre;
}
