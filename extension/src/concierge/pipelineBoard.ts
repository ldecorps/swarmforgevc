// BL-452/BL-455/BL-465/BL-585/BL-979: a live pipeline-board grid - ONE
// matrix with a single shared header. BL-979 pivoted the axes: active BL
// tickets are ROWS down the Y axis and the eight pipeline stages are shared
// COLUMNS across the X axis, so an extra ticket adds a row rather than
// widening the board. Width is the scarce axis on a phone and vertical
// growth is cheap, which is the whole argument for the pivot; BL-585's
// ticket-columns layout grew sideways with every promotion.
//
// Because of that pivot the DROPPING axis is height, not width. The row
// budget (PIPELINE_BOARD_GRID_MAX_ROWS) drops the tail of the epic-grouped
// order and announces it with "+N more active", never a silent cap. The
// character-width budget (PIPELINE_BOARD_GRID_MAX_WIDTH) survives as an
// ASSERTION rather than a dropper: the grid's width is now a property of
// the fixed stage set plus the id gutter, so no ticket can ever be dropped
// for width (BL-979 invariant 2). Telegram's <pre> does not wrap, so an
// over-wide grid would need horizontal scrolling on a phone - hence the
// budget stays, as a guard.
//
// Below the matrix each visible row gets a caption line (display id +
// truncated title, BL-956), grouped under "-- <epic-slug> --" separators
// with a blank line before every summary. This is NOT a return to BL-455's
// per-ticket pivoted blocks: there is still exactly one matrix and one
// header.
// Parked/awaiting-approval/root-intake/recently-closed items are listed
// separately below the grid. Telegram cannot nest <a> inside the grid's
// <pre>, so ticket numbers in the below-grid lists (and grid-only tickets)
// are composed as HTML anchors after that <pre> by composePipelineBoardHtml
// — never a separate LINKS: footer.
import { ALL_SWARM_ROLES } from './roleTopicMapStore';
import { PIPELINE_CHAIN } from '../swarm/rolePack';
import { stageOfSeat } from '../swarm/swarmState';

export interface PipelineBoardRow {
  id: string;
  column: string;
  epic?: string;
  // BL-465: the grid's OWN slug column shows a SHORT (2-3 word) kebab slug
  // only - the grid has no title column to widen (its width is spent on
  // the 8 stage columns). Distinct from PipelineBoardParkedEntry/
  // PipelineBoardListEntry's own `slug` below, which carries MORE text.
  slug: string;
  title?: string;
  // BL-1009: resolved owner swarm (wire name). Optional so pre-BL-1009
  // callers/fixtures keep their row shape byte-identical when they do not
  // pass localSwarmName.
  swarm?: string;
}

// BL-465: shared shape for every below-grid list line (parked, root-intake,
// recently-closed) - `slug` here is the WIDER combined line (kebab slug +
// more of the truncated title), not the grid's own short kebab-only slug.
export interface PipelineBoardListEntry {
  id: string;
  slug: string;
  // BL-980: relative age suffix for RECENTLY CLOSED lines only - present only
  // when a durable closure instant was recorded (doneClosedAtMs).
  closedAge?: string;
}

export interface PipelineBoardParkedEntry extends PipelineBoardListEntry {
  status: 'parked' | 'awaiting-approval';
}

// BL-1045: one ticket in backlog/hold/. Hold is the only backlog state with
// no automatic mover - Article 3.1 is explicit that held items sit until a
// human moves them - so HOW LONG it has been held is the fact that matters,
// and it is the caller's job to derive that from git rather than file mtime
// (mtime is rewritten by clones, worktree operations and checkouts).
export interface PipelineBoardHeldSourceItem {
  id: string;
  title?: string;
  filename: string;
  /** When the ticket entered hold/, from history. Absent = not derivable. */
  heldSinceMs?: number;
}

export interface PipelineBoardHeldEntry extends PipelineBoardListEntry {
  /** A glance-readable age: "12d", "5h", "age unknown". */
  heldFor: string;
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
  // BL-559: paused type:epic trackers collapsed to one line per epic slug
  // with active/paused child-slice counts — never plain parked ticket lines.
  collapsedEpics?: PipelineBoardCollapsedEpicEntry[];
  rootIntake: PipelineBoardListEntry[];
  recentlyClosed: PipelineBoardListEntry[];
  links: PipelineBoardLinkEntry[];
  // Plain parked tickets omitted by PIPELINE_BOARD_PAUSED_MAX (awaiting-
  // approval tickets are never capped). Rendered as "+N more parked" under
  // the PARKED section — never a silent cap.
  parkedOmittedCount?: number;
  // BL-956: epic trackers omitted by PIPELINE_BOARD_COLLAPSED_EPICS_MAX.
  // Rendered as "+N more epics" under the PARKED section — same
  // never-a-silent-cap posture as parkedOmittedCount above.
  collapsedEpicsOmittedCount?: number;
  // BL-1045: backlog/hold/, in its own section - never a role column and
  // never not-started, because no role holds a held ticket.
  held?: PipelineBoardHeldEntry[];
  // Held tickets omitted by PIPELINE_BOARD_HELD_MAX, rendered as
  // "+N more held" - same never-a-silent-cap posture as the counts above.
  heldOmittedCount?: number;
}

export interface PipelineBoardCollapsedEpicEntry {
  epicSlug: string;
  trackerId: string;
  pausedChildCount: number;
  activeChildCount: number;
}

export interface PipelineBoardPausedItem {
  id: string;
  humanApproval?: 'pending' | 'approved';
  priority?: number;
  type?: string;
  epic?: string;
}

export function isEpicTrackerPausedItem(item: PipelineBoardPausedItem): boolean {
  return item.type === 'epic';
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
  type?: string;
  title?: string;
  filename?: string;
  // BL-1045: 'hold' was missing, which is the whole defect - backlogReader.ts
  // has returned backlog/hold/ since BL-672, but a state the board cannot
  // represent is a state it silently drops.
  location?: 'active' | 'paused' | 'hold' | 'done' | 'root';
  // BL-1009: optional wire swarm name from ticket YAML (BL-090). Absent
  // means "default to the local swarm" at render time.
  swarm?: string;
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
  // BL-980: durable closure instant from TickState.doneClosedAtMs - absent
  // means no age suffix rather than a guess from file mtime.
  closedAtMs?: number;
}

// BL-465: additional, OPTIONAL inputs this ticket adds - every existing
// 3-arg computePipelineBoard call site (conciergeTick.ts's own real caller,
// plus the pre-BL-465 unit/acceptance fixtures) keeps working completely
// unchanged; only a caller that wants the new sections/links passes this.
export interface PipelineBoardExtras {
  // BL-1045: backlog/hold/ contents, with the instant each entered hold.
  held?: PipelineBoardHeldSourceItem[];
  // BL-1045: the instant held ages are measured against. Injected, never a
  // bare Date.now() (engineering no-real-clock rule).
  nowMs?: number;
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
  // BL-1009: this host's swarm wire name (via readSwarmName). When set,
  // absent ticket swarm: defaults to it, remote rows never show a live
  // held-by-role marker, and captions badge only when >1 swarm is visible.
  localSwarmName?: string;
}

// BL-473: the not-started sentinel column - a distinct state for an active
// ticket no role currently holds, never one of the real pipeline roles.
// BL-505: placed FIRST in PIPELINE_BOARD_COLUMN_ORDER below (a same-day
// follow-up ask reversing BL-473's original "right-hand side" placement -
// BL-473 itself declared column placement a build-time cosmetic detail, and
// every NS assertion locates the column by name via indexOf, never a fixed
// position, so this reorder breaks no existing test).
export const PIPELINE_BOARD_NOT_STARTED_COLUMN = 'not-started';

/** BL-1009: wire swarm_name → short badge text for captions. */
export function swarmDisplayBadge(wireName: string): string {
  if (wireName === 'primary') return 's1';
  if (wireName === 'second') return 's2';
  return wireName;
}

function resolveRowSwarm(meta: PipelineBoardTicketMeta | undefined, localSwarmName: string | undefined): string | undefined {
  if (localSwarmName === undefined) return undefined;
  return meta?.swarm ?? localSwarmName;
}

// BL-507: built from the forward PIPELINE_CHAIN (specifier..QA), NOT
// ALL_SWARM_ROLES - the coordinator does post-QA backlog bookkeeping only
// (PIPELINE.md; constitution BL-247), not a forward parcel stage, so the
// grid carries no coordinator column. ALL_SWARM_ROLES itself is untouched -
// it still legitimately drives the coordinator's own standing steering
// topic (roleTopicMapStore.ts, BL-425) and heldRoleByTicketId's iteration
// below, which is exactly why buildGridRows must remap a coordinator-held
// row's stage to 'QA' before it renders (see buildGridRows).
export const PIPELINE_BOARD_COLUMN_ORDER: readonly string[] = [PIPELINE_BOARD_NOT_STARTED_COLUMN, ...PIPELINE_CHAIN];

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
  [PIPELINE_BOARD_NOT_STARTED_COLUMN]: 'NS',
};

// BL-505: shortened from "TICKET" (6 chars) — kept for deriveDisplayTicketId
// docs only; BL-585 the matrix caption line uses it directly for an epic-less ticket.
const NO_EPIC_LABEL = '(no epic)';
// Steady state when backlog/active/ is empty — keeps the Telegram <pre>
// grid from rendering as a blank block between pipeline clears.
const NO_ACTIVE_TICKETS_LABEL = '(no active tickets)';
const PARKED_SECTION_HEADER = 'PARKED:';
const HELD_SECTION_HEADER = 'HELD:';
const AWAITING_APPROVAL_SECTION_HEADER = 'AWAITING APPROVAL:';
const ROOT_INTAKE_SECTION_HEADER = 'ROOT INTAKE:';
const RECENTLY_CLOSED_SECTION_HEADER = 'RECENTLY CLOSED:';
const LINKS_SECTION_HEADER = 'LINKS:';

// BL-465: how many recently-closed items the board shows below the grid -
// a build-time/cosmetic bound (the ticket's own "the precise recently-
// closed window" note), not a promotion gate. The caller (conciergeTick.ts)
// decides WHICH items count as "recent"; this only bounds the list length.
export const PIPELINE_BOARD_RECENTLY_CLOSED_MAX = 5;

// Below-grid PARKED section (not awaiting-approval): show only the top N
// paused tickets by priority (lower number = higher urgency), same ordering
// as the paused-pager bridge route. Awaiting-approval tickets are always
// shown in full regardless of this cap.
export const PIPELINE_BOARD_PAUSED_MAX = 3;

const PAUSED_PRIORITY_FALLBACK = Number.MAX_SAFE_INTEGER;

// BL-502: Telegram's own sendMessage text limit is 4096 chars; a small
// safety margin below it absorbs the HTML entity expansion escapeHtml adds
// (each &/</> becomes 4-5 chars) and any off-by-a-few in a future render
// tweak, without eating meaningfully into the link budget. Every consumer
// of the send limit (budgetPipelineBoardLinks below, its caller in
// pipelineBoardSync.ts) reads this ONE constant, never a hardcoded number
// of its own.
export const PIPELINE_BOARD_MESSAGE_MAX_LENGTH = 4000;

// BL-585/BL-979: the matrix's own character-width budget. Under BL-585 this
// was the DROPPER (it decided how many ticket columns fitted); after the
// BL-979 pivot the stage set is fixed, so width is a constant of the layout
// and this is an assertion instead - nothing is ever dropped for width.
//
// The arithmetic, so a future id-width change is checked rather than
// assumed: the id gutter (at least 3, else the widest display id) plus one
// 2-wide cell for each of the 8 stages, with one NBSP separator between
// cells (BL-1155 — no per-cell leading NBSP). That is 26 at today's 3-digit
// ids, 27 at 4 digits and 28 at 5 - all inside 30.
// BL-979 scenario 05 and invariant 2 pin exactly this.
export const PIPELINE_BOARD_GRID_MAX_WIDTH = 30;

// BL-979: the dropping axis after the pivot. Height is cheap on a phone in
// a way width is not, so this is deliberately far more generous than the 7
// ticket columns BL-585's width budget allowed - but it is still a budget,
// keeping the same never-a-silent-cap posture: rows past it are the tail of
// the same epic-grouped order and are announced by "+N more active".
// 12 covers the live active set (the depth cap plus expedited defects) with
// headroom, and keeps the whole <pre> - header, 12 rows, and two caption
// lines apiece - inside one comfortable phone scroll.
export const PIPELINE_BOARD_GRID_MAX_ROWS = 12;

// Every stage glyph is exactly 2 characters (COLUMN_LABEL above), and a
// mark is 1 right-aligned into the same width, so the cell width is a
// constant of the stage set rather than something derived per render.
export const PIPELINE_BOARD_STAGE_CELL_WIDTH = 2;
const STAGE_CELL_WIDTH = PIPELINE_BOARD_STAGE_CELL_WIDTH;

// BL-465: the grid's own short kebab slug - 2-3 significant words, lower-
// cased and hyphenated, mirroring the ticket's own backlog-filename slug
// convention (e.g. "BL-467-pipeline-board-only-pin" -> "pipeline-board-
// only"). Derived from the TITLE rather than re-reading the real filename
// (a build-time/cosmetic detail per the ticket's own note) - in practice
// close to the real on-disk slug, since a title and its filename slug are
// authored together.
// Default 3 significant words (BL-505 had narrowed to 2; phone captions
// need the third word for enough context). Shared by the grid slug column
// and deriveListEntryText below-grid list lines.
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

// BL-505: the below-grid list's own line text - the short kebab slug ONLY.
// Previously (BL-465) also appended more of the truncated title via the
// now-retired deriveTicketSlug (a wider, unbounded-word single-line
// projection); that wide tail is dropped here to fit a phone screen. A
// missing title still renders an empty slug rather than throwing
// (deriveKebabSlug's own contract).
// BL-956 invariant 1: bounded - a single-word title has no word cap to
// catch it (deriveKebabSlug caps WORDS, not characters), so an arbitrarily
// long title used to flow straight into a below-grid list line and from
// there past the whole-message send limit (the body is never trimmed by
// composePipelineBoardHtml; found by this ticket's own property test).
export function deriveListEntryText(title: string | undefined): string {
  return truncateCaptionDescription(deriveKebabSlug(title));
}

// BL-505: the SHORT display form of a ticket/list id, shared by the grid
// TICKET column and every below-grid list line - strips a recognised BL-/
// GH- ticket prefix (BL-493 -> "493"); an id with no recognised prefix (a
// root-intake filename stem, e.g. "INTAKE-...") is returned unchanged.
// Digits-only is unambiguous today (every real id is BL-, zero GH- exist -
// grep-verified at spec time); see the ticket's own ID-COLLISION SAFETY
// note for the future-GH- caveat.
const TICKET_ID_PREFIX_PATTERN = /^(?:BL|GH)-(\d+)$/;

export function deriveDisplayTicketId(id: string): string {
  const match = TICKET_ID_PREFIX_PATTERN.exec(id);
  return match ? match[1] : id;
}

// Sorts named epics alphabetically, with the no-epic bucket always LAST -
// deterministic regardless of role/ticket iteration order, so the
// edge-triggered rendered-text comparison in pipelineBoardSync.ts stays
// stable tick over tick (BL-455's own "fixed epic + ticket ordering, not
// hash-order" constraint).
function epicSortKey(epic: string | undefined): string {
  return epic === undefined ? `￿${NO_EPIC_LABEL}` : epic;
}

// BL-506: only a BL-/GH- ticket id carries a ticket NUMBER to rank by - a
// root-intake id (a raw filename stem, e.g.
// "INTAKE-operator-question-1784328071807") is not a ticket id at all and
// must never be parsed as one just because it happens to end in digits (a
// root-intake filename stem commonly does, from an embedded timestamp).
// Reuses deriveDisplayTicketId's own anchored TICKET_ID_PREFIX_PATTERN
// rather than a generic trailing-digit regex, for exactly that reason.
function ticketNumberOf(id: string): number | undefined {
  const match = TICKET_ID_PREFIX_PATTERN.exec(id);
  return match ? Number(match[1]) : undefined;
}

// BL-506: the LINKS section lists most-recent first - highest ticket
// NUMBER first, numeric (not lexicographic, so BL-1000 sorts above
// BL-999). An id with no ticket number (a root-intake filename stem)
// sorts after every numbered link; equal numbers (or two unnumbered ids)
// break the tie by plain id order, so the render stays deterministic
// tick-over-tick (the board's own content-signature change-gate requires
// it).
export function compareLinksMostRecentFirst(a: PipelineBoardLinkEntry, b: PipelineBoardLinkEntry): number {
  const aNum = ticketNumberOf(a.id);
  const bNum = ticketNumberOf(b.id);
  if (aNum === undefined) {
    return bNum === undefined ? a.id.localeCompare(b.id) : 1;
  }
  if (bNum === undefined) {
    return -1;
  }
  return aNum !== bNum ? bNum - aNum : a.id.localeCompare(b.id);
}

function linkPathFor(meta: PipelineBoardTicketMeta | undefined): string | undefined {
  if (!meta?.filename || !meta.location) {
    return undefined;
  }
  if (meta.location === 'root') {
    return `backlog/${meta.filename}`;
  }
  return `backlog/${meta.location}/${meta.filename}`;
}

function listEntryFor(item: PipelineBoardListSourceItem): PipelineBoardListEntry {
  return { id: item.id, slug: deriveListEntryText(item.title) };
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * BL-980: relative elapsed time since closure for RECENTLY CLOSED lines.
 * A pure function of two injected instants - never a bare Date.now(). Returns
 * undefined when no durable closure instant was recorded.
 */
export function formatRecentlyClosedAgeLabel(closedAtMs: number | undefined, nowMs: number): string | undefined {
  if (closedAtMs === undefined) {
    return undefined;
  }
  const elapsed = Math.max(0, nowMs - closedAtMs);
  if (elapsed < MINUTE_MS) {
    return 'just now';
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}min ago`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  }
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
}

function recentlyClosedEntryFor(item: PipelineBoardListSourceItem, nowMs: number): PipelineBoardListEntry {
  const entry: PipelineBoardListEntry = { id: item.id, slug: deriveListEntryText(item.title) };
  const closedAge = formatRecentlyClosedAgeLabel(item.closedAtMs, nowMs);
  if (closedAge !== undefined) {
    entry.closedAge = closedAge;
  }
  return entry;
}

// BL-464: a ticket id observed under more than one role - the exact
// double-row defect a mid-transition in_process scrape used to produce -
// collapses to exactly one held role, never two. ALL_SWARM_ROLES is
// iterated in pipeline order, so a LATER occurrence (a more downstream
// role) overwrites an earlier one in the Map, mirroring
// pipeline_stage_lib.bb's own reconcile-stage-map "most downstream wins"
// rule - the same guarantee, belt-and-braces at the renderer, whatever the
// authoritative source's own shape already structurally prevents.
//
// BL-1040: a seat-keyed entry (`coder@sonnet2`) folds onto its stage column
// here too. The reader chokepoint in swarmState already folds, but
// roleHeldTickets is a plain record any producer can hand in, and this
// function's ALL_SWARM_ROLES-only iteration is precisely the layer at which
// a leaked seat key matched nothing and fell through to the not-started
// sentinel while the seat was busy. Precedence is computed by pipeline rank
// rather than by iteration order, so folding cannot let a seat key outrank a
// genuinely more downstream stage. A key that is not a stage even after the
// fold is still ignored, exactly as an unknown role always was.
// Split out of heldRoleByTicketId to keep that function's own complexity at
// its pre-BL-1040 baseline (differential CRAP gate) - folds every key onto
// its stage in one pass over roleHeldTickets, keeping each id under the
// key's original position, since heldRoleByTicketId's own per-stage
// insertion order still needs it.
function idsByStageFromRoleHeldTickets(roleHeldTickets: Record<string, string[]>): Map<string, string[]> {
  const idsByStage = new Map<string, string[]>();
  for (const [roleOrSeat, ids] of Object.entries(roleHeldTickets)) {
    const stage = stageOfSeat(roleOrSeat);
    const bucket = idsByStage.get(stage) ?? idsByStage.set(stage, []).get(stage)!;
    bucket.push(...(ids ?? []));
  }
  return idsByStage;
}

function heldRoleByTicketId(roleHeldTickets: Record<string, string[]>): Map<string, string> {
  const idsByStage = idsByStageFromRoleHeldTickets(roleHeldTickets);
  const heldRoleById = new Map<string, string>();
  // Iterating ALL_SWARM_ROLES in pipeline order is load-bearing twice over:
  // it is what makes a LATER (more downstream) stage win, and the Map's
  // insertion order is itself read downstream as the row order.
  for (const stage of ALL_SWARM_ROLES) {
    for (const id of idsByStage.get(stage) ?? []) {
      heldRoleById.set(id, stage);
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
  activeIds?: string[],
  localSwarmName?: string
): PipelineBoardRow[] {
  const heldRoleById = heldRoleByTicketId(roleHeldTickets);
  const ids = activeIds ?? [...heldRoleById.keys()];
  const rowsById = new Map<string, PipelineBoardRow>();
  for (const id of ids) {
    const meta = ticketMeta[id];
    const swarm = resolveRowSwarm(meta, localSwarmName);
    const heldRole = heldRoleById.get(id) ?? PIPELINE_BOARD_NOT_STARTED_COLUMN;
    // BL-1009 invariant 1: remote swarm live stage is unobservable — never
    // render a held-by-role mark for a non-local row, even if a fixture
    // accidentally seeds roleHeld for it.
    const remote = swarm !== undefined && localSwarmName !== undefined && swarm !== localSwarmName;
    const rawRole = remote ? PIPELINE_BOARD_NOT_STARTED_COLUMN : heldRole;
    // BL-507: heldRoleById still resolves a coordinator-held ticket to
    // 'coordinator' (heldRoleByTicketId iterates ALL_SWARM_ROLES, unchanged)
    // but the grid has no coordinator column any more - remap it to 'QA' so
    // it renders at the end-of-line stage instead of matching no column at
    // all (an all-dots row) or falling through to not-started.
    const column = rawRole === 'coordinator' ? 'QA' : rawRole;
    rowsById.set(id, {
      id,
      column,
      epic: meta?.epic,
      slug: deriveKebabSlug(meta?.title),
      // BL-956: only set when the backlog meta actually carries one - a
      // meta-less row keeps its pre-BL-956 shape exactly.
      ...(meta?.title !== undefined ? { title: meta.title } : {}),
      ...(swarm !== undefined ? { swarm } : {}),
    });
  }
  return [...rowsById.values()].sort((a, b) => epicSortKey(a.epic).localeCompare(epicSortKey(b.epic)));
}

function comparePausedByPriority(a: PipelineBoardPausedItem, b: PipelineBoardPausedItem): number {
  const pa = a.priority ?? PAUSED_PRIORITY_FALLBACK;
  const pb = b.priority ?? PAUSED_PRIORITY_FALLBACK;
  if (pa !== pb) {
    return pa - pb;
  }
  return a.id.localeCompare(b.id);
}

// Awaiting-approval tickets are always shown. Plain parked tickets are
// capped to PIPELINE_BOARD_PAUSED_MAX by priority (then id). Epic trackers
// (type: epic) are excluded — they render as collapsed epic summaries.
export function selectPausedForBoard(paused: PipelineBoardPausedItem[]): {
  selected: PipelineBoardPausedItem[];
  parkedOmittedCount: number;
} {
  const workflowPaused = paused.filter(
    (item) => !isEpicTrackerPausedItem(item) || item.humanApproval === 'pending'
  );
  const awaiting = workflowPaused.filter((item) => item.humanApproval === 'pending').sort(comparePausedByPriority);
  const plainParked = workflowPaused.filter((item) => item.humanApproval !== 'pending').sort(comparePausedByPriority);
  const shownParked = plainParked.slice(0, PIPELINE_BOARD_PAUSED_MAX);
  return {
    selected: [...awaiting, ...shownParked],
    parkedOmittedCount: Math.max(0, plainParked.length - shownParked.length),
  };
}

function countEpicSliceChildren(
  epicSlug: string,
  ticketMeta: Record<string, PipelineBoardTicketMeta>
): { paused: number; active: number } {
  let paused = 0;
  let active = 0;
  for (const meta of Object.values(ticketMeta)) {
    if (meta.epic !== epicSlug || meta.type === 'epic') {
      continue;
    }
    if (meta.location === 'paused') {
      paused += 1;
    } else if (meta.location === 'active') {
      active += 1;
    }
  }
  return { paused, active };
}

export const PIPELINE_BOARD_COLLAPSED_EPICS_MAX = 3;

// BL-956 invariant 3: the cap is never silent - alongside the sliced list
// the omitted count comes back, rendered as "+N more epics" (the same
// visible-overflow treatment PIPELINE_BOARD_PAUSED_MAX and the grid's
// "+N more active" already have).
function buildCollapsedEpicEntries(
  paused: PipelineBoardPausedItem[],
  ticketMeta: Record<string, PipelineBoardTicketMeta>
): { collapsedEpics: PipelineBoardCollapsedEpicEntry[]; collapsedEpicsOmittedCount: number } {
  const trackers = paused
    .filter((item) => isEpicTrackerPausedItem(item) && item.humanApproval !== 'pending')
    .sort(comparePausedByPriority);
  const collapsedEpics = trackers.slice(0, PIPELINE_BOARD_COLLAPSED_EPICS_MAX).map((item) => {
    const epicSlug = item.epic ?? ticketMeta[item.id]?.epic ?? '';
    const counts = countEpicSliceChildren(epicSlug, ticketMeta);
    return {
      epicSlug,
      trackerId: item.id,
      pausedChildCount: counts.paused,
      activeChildCount: counts.active,
    };
  });
  return { collapsedEpics, collapsedEpicsOmittedCount: trackers.length - collapsedEpics.length };
}

export function formatCollapsedEpicLine(entry: PipelineBoardCollapsedEpicEntry): string {
  const parts: string[] = [];
  if (entry.activeChildCount > 0) {
    parts.push(`${entry.activeChildCount} active`);
  }
  if (entry.pausedChildCount > 0) {
    parts.push(`${entry.pausedChildCount} paused`);
  }
  const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  return `  ${entry.epicSlug}${suffix}`;
}

// Split out of computePipelineBoard below for the same CRAP-budget reason
// as buildGridRows above.
function buildParkedEntries(
  paused: PipelineBoardPausedItem[],
  ticketMeta: Record<string, PipelineBoardTicketMeta>
): {
  parked: PipelineBoardParkedEntry[];
  collapsedEpics: PipelineBoardCollapsedEpicEntry[];
  parkedOmittedCount: number;
  collapsedEpicsOmittedCount: number;
} {
  const { selected, parkedOmittedCount } = selectPausedForBoard(paused);
  const parked = selected.map(
    (item): PipelineBoardParkedEntry => ({
      id: item.id,
      slug: deriveListEntryText(ticketMeta[item.id]?.title),
      status: item.humanApproval === 'pending' ? 'awaiting-approval' : 'parked',
    })
  );
  const { collapsedEpics, collapsedEpicsOmittedCount } = buildCollapsedEpicEntries(paused, ticketMeta);
  return { parked, collapsedEpics, parkedOmittedCount, collapsedEpicsOmittedCount };
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

function linksFromRecentlyClosed(
  extras: PipelineBoardExtras,
  ticketMeta: Record<string, PipelineBoardTicketMeta>
): PipelineBoardLinkEntry[] {
  const links: PipelineBoardLinkEntry[] = [];
  for (const item of extras.recentlyClosed ?? []) {
    const meta = ticketMeta[item.id];
    const path = meta ? linkPathFor(meta) : `backlog/done/${item.filename}`;
    if (path) {
      links.push({ id: item.id, path });
    }
  }
  return links;
}

function linksFromRootIntake(
  extras: PipelineBoardExtras,
  ticketMeta: Record<string, PipelineBoardTicketMeta>
): PipelineBoardLinkEntry[] {
  const links: PipelineBoardLinkEntry[] = [];
  for (const item of extras.rootIntake ?? []) {
    const meta = ticketMeta[item.id];
    const path = meta ? linkPathFor(meta) : `backlog/${item.filename}`;
    if (path) {
      links.push({ id: item.id, path });
    }
  }
  return links;
}

// Split out of computePipelineBoard below for the same CRAP-budget reason
// as buildGridRows above. Only called once extras.repoBaseUrl is confirmed
// present (see computePipelineBoard's own ternary) - a link list without a
// resolvable repo base would emit broken/relative links, per
// PipelineBoardExtras.repoBaseUrl's own comment.
function linksFromCollapsedEpics(
  collapsedEpics: PipelineBoardCollapsedEpicEntry[],
  ticketMeta: Record<string, PipelineBoardTicketMeta>
): PipelineBoardLinkEntry[] {
  const links: PipelineBoardLinkEntry[] = [];
  for (const entry of collapsedEpics) {
    const path = linkPathFor(ticketMeta[entry.trackerId]);
    if (path) {
      links.push({ id: entry.trackerId, path });
    }
  }
  return links;
}

function linksFromHeld(
  extras: PipelineBoardExtras,
  ticketMeta: Record<string, PipelineBoardTicketMeta>
): PipelineBoardLinkEntry[] {
  const links: PipelineBoardLinkEntry[] = [];
  for (const item of extras.held ?? []) {
    // The item carries its own filename; location is 'hold' by definition of
    // being in this list, so a stale ticketMeta cannot point the link at the
    // folder the ticket just left.
    const path = linkPathFor({ ...ticketMeta[item.id], filename: item.filename, location: 'hold' });
    if (path) {
      links.push({ id: item.id, path });
    }
  }
  return links;
}

function buildLinks(
  rows: PipelineBoardRow[],
  parked: PipelineBoardParkedEntry[],
  collapsedEpics: PipelineBoardCollapsedEpicEntry[],
  extras: PipelineBoardExtras,
  ticketMeta: Record<string, PipelineBoardTicketMeta>
): PipelineBoardLinkEntry[] {
  const linksById = new Map<string, PipelineBoardLinkEntry>();
  for (const link of [
    ...linksFromRows(rows, ticketMeta),
    ...linksFromParked(parked, ticketMeta),
    ...linksFromCollapsedEpics(collapsedEpics, ticketMeta),
    ...linksFromRecentlyClosed(extras, ticketMeta),
    ...linksFromRootIntake(extras, ticketMeta),
    // BL-1045: a held ticket is reachable from the link list like any other -
    // the whole point is that it stops being invisible, and a section with no
    // way to open the ticket is only half of that.
    ...linksFromHeld(extras, ticketMeta),
  ]) {
    if (!linksById.has(link.id)) {
      linksById.set(link.id, link);
    }
  }
  const links = [...linksById.values()];
  links.sort(compareLinksMostRecentFirst);
  return links;
}

/**
 * BL-1045: omitted entirely when nothing is held, so a board with an empty
 * hold/ renders byte-identically to one built before this ticket.
 */
function heldResultFields(
  held: PipelineBoardHeldEntry[],
  heldOmittedCount: number | undefined
): Pick<PipelineBoardData, 'held' | 'heldOmittedCount'> {
  return {
    ...(held.length > 0 || heldOmittedCount ? { held } : {}),
    ...(heldOmittedCount ? { heldOmittedCount } : {}),
  };
}

export function computePipelineBoard(
  roleHeldTickets: Record<string, string[]>,
  paused: PipelineBoardPausedItem[],
  ticketMeta: Record<string, PipelineBoardTicketMeta>,
  extras: PipelineBoardExtras = {}
): PipelineBoardData {
  // BL-1045 invariant 1: a held ticket is never rendered as in-flight. The
  // exclusion is applied HERE, before the grid is built, so there is no
  // ordering in which a held id reaches a role column or the not-started
  // column - not even one that is somehow also role-held mid-transition.
  const heldSource = extras.held ?? [];
  const heldIds = new Set(heldSource.map((item) => item.id));
  const rows = buildGridRows(roleHeldTickets, ticketMeta, extras.activeIds, extras.localSwarmName).filter(
    (row) => !heldIds.has(row.id)
  );
  const { parked: allParked, collapsedEpics, parkedOmittedCount, collapsedEpicsOmittedCount } =
    buildParkedEntries(paused, ticketMeta);
  const parked = allParked.filter((entry) => !heldIds.has(entry.id));
  const { held, heldOmittedCount } = buildHeldEntries(heldSource, extras.nowMs ?? 0);
  const rootIntake = [...(extras.rootIntake ?? [])].map(listEntryFor).sort((a, b) => a.id.localeCompare(b.id));
  // BL-465 bounce (architect review): unlike rootIntake/parked above,
  // recently-closed order IS the whole point of the section - re-sorting
  // it alphabetically here silently discarded whatever recency order the
  // caller (conciergeTick.ts's recentlyClosedItems) worked out, which is
  // this function's OWN documented contract just above
  // (PIPELINE_BOARD_RECENTLY_CLOSED_MAX's comment: "the caller decides
  // WHICH items count as 'recent'; this only bounds the list length").
  // Slice-then-map only, preserving the caller's order exactly.
  const recentlyClosed = [...(extras.recentlyClosed ?? [])]
    .slice(0, PIPELINE_BOARD_RECENTLY_CLOSED_MAX)
    .map((item) => recentlyClosedEntryFor(item, extras.nowMs ?? 0));
  const links = extras.repoBaseUrl ? buildLinks(rows, parked, collapsedEpics, extras, ticketMeta) : [];

  return {
    rows,
    parked,
    collapsedEpics,
    rootIntake,
    recentlyClosed,
    links,
    parkedOmittedCount,
    collapsedEpicsOmittedCount,
    ...heldResultFields(held, heldOmittedCount),
  };
}

// BL-585: caption/overflow lines sit outside the matrix proper and may use
// plain spaces (they are ordinary text, not column-aligned).
const NBSP = '\u00a0';

function padStartNbsp(text: string, width: number): string {
  return text.length >= width ? text : NBSP.repeat(width - text.length) + text;
}

// BL-979: the dropping axis is height now. There is no arithmetic left to
// do - the stage set is fixed, so every row is the same width and only the
// row budget can drop one.
function maxVisibleGridRows(totalRows: number, maxRows: number): number {
  return Math.max(0, Math.min(totalRows, maxRows));
}

// The id gutter: wide enough for the widest display id on the board, and
// never narrower than 3 (today's ids). Computed over EVERY candidate row,
// not just the visible ones, so the gutter never depends circularly on
// which rows end up fitting the budget.
function gridIdGutterWidth(displayIds: string[]): number {
  return Math.max(3, ...displayIds.map((id) => id.length));
}

// BL-979 invariant 2: the width of every grid line, as a pure function of
// the stage set and the gutter. Nothing is dropped for width - this exists
// so the budget can be asserted rather than silently exceeded.
export function computePipelineBoardGridLineWidth(idGutterWidth: number): number {
  const stageCount = PIPELINE_BOARD_COLUMN_ORDER.length;
  return idGutterWidth + stageCount * STAGE_CELL_WIDTH + (stageCount - 1);
}

function gridLineWidth(idGutterWidth: number): number {
  return computePipelineBoardGridLineWidth(idGutterWidth);
}

function gridOverflowLine(droppedCount: number): string {
  return `+${droppedCount} more active`;
}

// BL-956: the caption carries the full ticket TITLE (the human's hotfix -
// the epic moved out of this line when captions became per-ticket), but
// bounded: an unbounded title is a new path into the whole-message send
// limit that composePipelineBoardHtml only budgets LINKS against (the
// body is never trimmed there, and an oversized body is rejected whole -
// live outage 2026-07-17). Truncation is visible (ellipsis), never silent.
export const PIPELINE_BOARD_CAPTION_DESCRIPTION_MAX = 64;

// BL-956 invariant 2: a caption always identifies SOMETHING - a role-held
// ticket with no backlog entry (no title, empty slug) gets this label
// rather than rendering as a bare id followed by nothing.
const NO_BACKLOG_ENTRY_LABEL = '(no backlog entry)';

function truncateCaptionDescription(text: string): string {
  if (text.length <= PIPELINE_BOARD_CAPTION_DESCRIPTION_MAX) {
    return text;
  }
  return `${text.slice(0, PIPELINE_BOARD_CAPTION_DESCRIPTION_MAX - 1)}…`;
}

function gridCaptionLine(row: PipelineBoardRow, showSwarmBadge: boolean): string {
  const displayId = deriveDisplayTicketId(row.id);
  const description = (row.title ?? '').trim() || row.slug.trim() || NO_BACKLOG_ENTRY_LABEL;
  if (showSwarmBadge && row.swarm) {
    return `${displayId} [${swarmDisplayBadge(row.swarm)}] ${truncateCaptionDescription(description)}`;
  }
  return `${displayId} ${truncateCaptionDescription(description)}`;
}

function captionsNeedSwarmBadges(visibleRows: PipelineBoardRow[]): boolean {
  const names = new Set(visibleRows.map((r) => r.swarm).filter((s): s is string => s !== undefined));
  return names.size > 1;
}

// Split out of renderGridLines below for the same CRAP-budget reason as
// buildGridRows/buildParkedEntries above - the shared stage header and the
// per-ticket mark rows are one cohesive block (they share the id gutter and
// iterate PIPELINE_BOARD_COLUMN_ORDER together) but pushed renderGridLines
// itself over the CRAP budget. Pure formatting, no behavior of its own.
//
// BL-979: transposed. The header is the eight stage glyphs over an empty id
// gutter, and each subsequent line is one ticket - its display id in the
// gutter, then its mark under each stage.
function renderGridMatrixLines(visibleRows: PipelineBoardRow[], visibleIds: string[], idGutterWidth: number): string[] {
  const stageCells = (cell: (column: string) => string): string =>
    PIPELINE_BOARD_COLUMN_ORDER.map((column) => padStartNbsp(cell(column), STAGE_CELL_WIDTH)).join(NBSP);
  const lines: string[] = [NBSP.repeat(idGutterWidth) + stageCells((column) => COLUMN_LABEL[column])];
  visibleRows.forEach((row, index) => {
    lines.push(padStartNbsp(visibleIds[index], idGutterWidth) + stageCells((column) => (column === row.column ? 'X' : '.')));
  });
  return lines;
}

// BL-979: the caption block below the matrix. BL-956 grouped same-epic
// captions adjacently and marked each epic CHANGE with one blank line,
// which left membership to be inferred from adjacency; the group is named
// outright now. The separator carries the kebab SLUG exactly as the
// human's approved mockup shows ("-- code-quality-gates --"), not a
// prettier epic title.
//
// Rows arrive epic-sorted from buildGridRows, with the epic-less bucket
// already last (epicSortKey), so grouping is a single pass over the visible
// rows - no second ordering rule anywhere.
//
// The one conditional shape: a board where NO ticket carries an epic emits
// no separators at all, rather than one lone "-- (no epic) --" header that
// says nothing. Every summary is still preceded by a blank line either way,
// which is also what separates the block from the matrix above it.
function epicSeparatorLine(epic: string | undefined): string {
  return `-- ${epic ?? NO_EPIC_LABEL} --`;
}

function renderGridCaptionLines(visibleRows: PipelineBoardRow[]): string[] {
  const withSeparators = visibleRows.some((row) => row.epic !== undefined);
  const showBadges = captionsNeedSwarmBadges(visibleRows);
  const lines: string[] = [];
  let prevEpic: string | undefined;
  let started = false;
  for (const row of visibleRows) {
    if (withSeparators && (!started || row.epic !== prevEpic)) {
      if (started) {
        lines.push('');
      }
      lines.push(epicSeparatorLine(row.epic));
    }
    lines.push('');
    lines.push(gridCaptionLine(row, showBadges));
    prevEpic = row.epic;
    started = true;
  }
  return lines;
}

// ONE matrix: active tickets as rows, pipeline stages as shared columns
// (BL-979). Rows already arrive epic-grouped via computePipelineBoard's own
// stable sort (buildGridRows) - rows dropped by the budget are simply the
// tail of that same order, no second ordering rule. The id gutter is
// computed over EVERY candidate row's display id, not just the visible
// ones, so it never depends circularly on how many rows end up fitting.
function renderGridLines(rows: PipelineBoardRow[]): string[] {
  if (rows.length === 0) {
    return [NO_ACTIVE_TICKETS_LABEL];
  }
  const displayIds = rows.map((row) => deriveDisplayTicketId(row.id));
  const idGutterWidth = gridIdGutterWidth(displayIds);
  const visibleCount = maxVisibleGridRows(rows.length, PIPELINE_BOARD_GRID_MAX_ROWS);
  const visibleRows = rows.slice(0, visibleCount);
  const droppedCount = rows.length - visibleCount;

  const lines = renderGridMatrixLines(visibleRows, displayIds.slice(0, visibleCount), idGutterWidth);
  // The caption block always opens with a blank line (every summary is
  // preceded by one); when separators are in play that blank has to come
  // before the first separator instead, so the matrix is never flush
  // against it.
  const captions = renderGridCaptionLines(visibleRows);
  if (captions[0] !== '') {
    lines.push('');
  }
  lines.push(...captions);
  if (droppedCount > 0) {
    lines.push(gridOverflowLine(droppedCount));
  }
  return lines;
}

// BL-1045: the cap on the held section. Held tickets are ordered
// LONGEST-HELD FIRST, so the cap can only ever drop the newest - the
// twelve-day ticket this feature exists for is never the one hidden.
export const PIPELINE_BOARD_HELD_MAX = 8;

/**
 * BL-1045: how long a ticket has been held, in the coarsest unit that still
 * separates "yesterday" from "twelve days ago" at a glance. A pure function
 * of two injected instants - never a bare Date.now().
 *
 * An unknown hold date says so rather than rendering as zero: "just now" for
 * a ticket parked twelve days ago would be worse than no age at all.
 */
export function formatHeldForLabel(heldSinceMs: number | undefined, nowMs: number): string {
  if (heldSinceMs === undefined) {
    return 'age unknown';
  }
  const elapsed = nowMs - heldSinceMs;
  if (elapsed >= DAY_MS) {
    return `${Math.floor(elapsed / DAY_MS)}d`;
  }
  if (elapsed >= HOUR_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}h`;
  }
  if (elapsed >= MINUTE_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}m`;
  }
  return 'just now';
}

function heldEntryFor(item: PipelineBoardHeldSourceItem, nowMs: number): PipelineBoardHeldEntry {
  return {
    id: item.id,
    slug: deriveListEntryText(item.title),
    heldFor: formatHeldForLabel(item.heldSinceMs, nowMs),
  };
}

// Longest-held first. An item with no derivable date sorts last rather than
// first: an unknown age is not evidence of a long one.
function byHeldLongestFirst(a: PipelineBoardHeldSourceItem, b: PipelineBoardHeldSourceItem): number {
  const aHeld = a.heldSinceMs ?? Number.POSITIVE_INFINITY;
  const bHeld = b.heldSinceMs ?? Number.POSITIVE_INFINITY;
  return aHeld !== bHeld ? aHeld - bHeld : a.id.localeCompare(b.id);
}

function buildHeldEntries(
  held: PipelineBoardHeldSourceItem[],
  nowMs: number
): { held: PipelineBoardHeldEntry[]; heldOmittedCount?: number } {
  const ordered = [...held].sort(byHeldLongestFirst);
  const shown = ordered.slice(0, PIPELINE_BOARD_HELD_MAX);
  const omitted = ordered.length - shown.length;
  return {
    held: shown.map((item) => heldEntryFor(item, nowMs)),
    ...(omitted > 0 ? { heldOmittedCount: omitted } : {}),
  };
}

function pipelineBoardHeldOverflowLine(omittedCount: number): string {
  return `+${omittedCount} more held`;
}

function renderHeldSection(held: PipelineBoardHeldEntry[], omittedCount: number | undefined): string[] {
  if (held.length === 0 && !omittedCount) {
    return [];
  }
  const lines: string[] = ['', HELD_SECTION_HEADER];
  for (const entry of held) {
    lines.push(`  ${deriveDisplayTicketId(entry.id)} ${entry.slug} (${entry.heldFor})`.replace(/\s+\(/, ' ('));
  }
  if (omittedCount) {
    lines.push(`  ${pipelineBoardHeldOverflowLine(omittedCount)}`);
  }
  return lines;
}

function pipelineBoardParkedOverflowLine(omittedCount: number): string {
  return `+${omittedCount} more parked`;
}

// BL-956 invariant 3: the collapsed-epic cap's own visible overflow line.
function pipelineBoardEpicsOverflowLine(omittedCount: number): string {
  return `+${omittedCount} more epics`;
}

// BL-956 hardener: the two overflow-line computations and the parked
// section's emptiness guard are shared by BOTH render paths - the
// plain-text one (change-detection content signature) and the HTML one
// (the live Telegram message). They are near-duplicates BY DESIGN and must
// stay in lockstep; the bounce D1 defect was precisely the moment they did
// not. Extracting them here keeps that lockstep in one place, and keeps
// each caller's own CRAP at or below its pre-parcel score (BL-866 pattern:
// extract before measuring, so new code carries its own isolated number
// rather than inheriting a shared renderer's pre-existing debt).
function parkedOverflowLineFor(data: PipelineBoardData): string | undefined {
  const omitted = data.parkedOmittedCount ?? 0;
  return omitted > 0 ? pipelineBoardParkedOverflowLine(omitted) : undefined;
}

function epicsOverflowLineFor(data: PipelineBoardData): string | undefined {
  const omitted = data.collapsedEpicsOmittedCount ?? 0;
  return omitted > 0 ? pipelineBoardEpicsOverflowLine(omitted) : undefined;
}

function parkedSectionIsEmpty(
  collapsedEpics: PipelineBoardCollapsedEpicEntry[],
  plainParked: PipelineBoardParkedEntry[],
  overflowLine: string | undefined,
  epicsOverflowLine: string | undefined
): boolean {
  return collapsedEpics.length === 0 && plainParked.length === 0 && !overflowLine && !epicsOverflowLine;
}

function renderParkedSection(
  collapsedEpics: PipelineBoardCollapsedEpicEntry[],
  parked: PipelineBoardParkedEntry[],
  overflowLine?: string,
  epicsOverflowLine?: string
): string[] {
  const plainParked = parked.filter((p) => p.status === 'parked');
  if (parkedSectionIsEmpty(collapsedEpics, plainParked, overflowLine, epicsOverflowLine)) {
    return [];
  }
  const lines: string[] = ['', PARKED_SECTION_HEADER];
  for (const epic of collapsedEpics) {
    lines.push(formatCollapsedEpicLine(epic));
  }
  if (epicsOverflowLine) {
    lines.push(`  ${epicsOverflowLine}`);
  }
  for (const entry of plainParked) {
    lines.push(`  ${deriveDisplayTicketId(entry.id)} ${entry.slug}`.trimEnd());
  }
  if (overflowLine) {
    lines.push(`  ${overflowLine}`);
  }
  return lines;
}

function formatListEntryLine(entry: PipelineBoardListEntry): string {
  const base = `  ${deriveDisplayTicketId(entry.id)} ${entry.slug}`.trimEnd();
  return entry.closedAge ? `${base} (${entry.closedAge})` : base;
}

// BL-465: renders one below-grid section (awaiting-approval/root-
// intake/recently-closed) - omitted entirely when empty (BL-455's own
// "every active ticket lands in exactly one place" convention, extended
// here to every below-grid list: an empty section is a normal steady
// state, not worth rendering). No per-line status label anymore (drops
// BL-452's PK/AA glyphs) - the SECTION HEADER itself is the label now.
function renderListSection(header: string, entries: PipelineBoardListEntry[], overflowLine?: string): string[] {
  if (entries.length === 0 && (overflowLine === undefined || overflowLine === '')) {
    return [];
  }
  const lines: string[] = ['', header];
  for (const entry of entries) {
    lines.push(formatListEntryLine(entry));
  }
  if (overflowLine) {
    lines.push(`  ${overflowLine}`);
  }
  return lines;
}

// BL-526/BL-585: STATUS GRID only (ticket-column matrix + captions) - no
// below-grid lists and never the LINKS fragment. Phone miniapp portrait
// destination; Telegram pin continues to use renderBodySections below.
function renderGridOnlySections(data: PipelineBoardData): string[] {
  return renderGridLines(data.rows);
}

// BL-465: defaults every below-grid section to empty (?? []) - a fixture
// built before this ticket (still ubiquitous across pre-existing unit/
// acceptance tests) supplies only {rows, parked}; the two NEW sections
// this ticket adds simply render as absent, exactly the pre-BL-465 shape,
// rather than every one of those fixtures needing a mechanical update.
function renderBodySections(data: PipelineBoardData): string[] {
  const parked = data.parked ?? [];
  const parkedOverflow = parkedOverflowLineFor(data);
  const epicsOverflow = epicsOverflowLineFor(data);
  return [
    ...renderGridOnlySections(data),
    ...renderParkedSection(data.collapsedEpics ?? [], parked, parkedOverflow, epicsOverflow),
    // BL-1045: its own section, immediately after PARKED. Hold is the one
    // backlog state nothing will ever move on its own, so it sits where a
    // reader already looks for work that is not in flight.
    ...renderHeldSection(data.held ?? [], data.heldOmittedCount),
    ...renderListSection(
      AWAITING_APPROVAL_SECTION_HEADER,
      parked.filter((p) => p.status === 'awaiting-approval')
    ),
    ...renderListSection(ROOT_INTAKE_SECTION_HEADER, data.rootIntake ?? []),
    ...renderListSection(RECENTLY_CLOSED_SECTION_HEADER, data.recentlyClosed ?? []),
  ];
}

// BL-526: portrait phone miniapp — STATUS GRID (+ optional updated-at
// footer). Omits PARKED / AWAITING / ROOT INTAKE / RECENTLY CLOSED and
// never includes LINKS: (that fragment is a separate render).
export function renderPipelineBoardGridOnly(data: PipelineBoardData, lastChangeMs?: number): string {
  const sections = renderGridOnlySections(data);
  if (lastChangeMs === undefined) {
    return sections.join('\n');
  }
  return [...sections, '', renderUpdatedAtFooter(lastChangeMs)].join('\n');
}

// BL-462: the grid + below-grid sections only, EXCLUDING the footer
// timestamp AND the link list. This is the visible body; pipelineBoardSync
// adds link path data to its content signature separately (BL-513), because
// a ticket can move folders while this body stays byte-identical.
export function renderPipelineBoardBody(data: PipelineBoardData): string {
  return renderBodySections(data).join('\n');
}

// BL-462/BL-508: a pure function of an injected epoch-ms - never a bare
// new Date()/Date.now() (engineering no-real-clock rule). Europe/London is
// named explicitly so DST and date rollover are resolved from the injected
// instant, not from the host's local timezone.
export function formatUpdatedAtLabel(epochMs: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(epochMs);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('month')} ${part('day')} ${part('hour')}:${part('minute')} ${part('timeZoneName')}`;
}

function renderUpdatedAtFooter(lastChangeMs: number): string {
  return `updated at ${formatUpdatedAtLabel(lastChangeMs)}`;
}

// BL-462: the full board - the pure grid/below-grid body plus an "updated
// at" footer stamped with the last CONTENT-change instant (never the
// current clock - the caller, pipelineBoardSync.ts, only ever passes the
// instant it recorded for the last actual content change, per its own
// change-gate). Plain-text form used for content signatures and test
// fixtures; Telegram HTML is composePipelineBoardHtml (links cannot live
// inside the monospace <pre> grid).
export function renderPipelineBoard(data: PipelineBoardData, lastChangeMs: number): string {
  return [...renderBodySections(data), '', renderUpdatedAtFooter(lastChangeMs)].join('\n');
}

function pipelineBoardBlobUrl(repoBaseUrl: string, path: string): string {
  return `${repoBaseUrl}/blob/main/${path}`;
}

export function pipelineBoardLinkLine(link: PipelineBoardLinkEntry, repoBaseUrl: string): string {
  const label = escapeHtml(deriveDisplayTicketId(link.id));
  return `<a href="${pipelineBoardBlobUrl(repoBaseUrl, link.path)}">${label}</a>`;
}

function pathByIdFromLinks(links: PipelineBoardLinkEntry[]): Map<string, string> {
  return new Map(links.map((link) => [link.id, link.path]));
}

function listSectionTicketIds(data: PipelineBoardData): Set<string> {
  const ids = new Set<string>();
  for (const entry of data.parked ?? []) {
    ids.add(entry.id);
  }
  for (const entry of data.rootIntake ?? []) {
    ids.add(entry.id);
  }
  for (const entry of data.recentlyClosed ?? []) {
    ids.add(entry.id);
  }
  return ids;
}

// Linked ticket id (or plain escaped display id when not linkable).
function formatTicketIdHtml(
  id: string,
  path: string | undefined,
  repoBaseUrl: string | undefined
): string {
  const display = escapeHtml(deriveDisplayTicketId(id));
  if (!path || !repoBaseUrl) {
    return display;
  }
  return `<a href="${pipelineBoardBlobUrl(repoBaseUrl, path)}">${display}</a>`;
}

function formatBoardListLineHtml(
  id: string,
  slug: string,
  path: string | undefined,
  repoBaseUrl: string | undefined,
  closedAge?: string
): string {
  const idHtml = formatTicketIdHtml(id, path, repoBaseUrl);
  const slugPart = slug ? ` ${escapeHtml(slug)}` : '';
  const agePart = closedAge ? ` (${escapeHtml(closedAge)})` : '';
  return `  ${idHtml}${slugPart}${agePart}`.trimEnd();
}

function formatCollapsedEpicLineHtml(
  entry: PipelineBoardCollapsedEpicEntry,
  path: string | undefined,
  repoBaseUrl: string | undefined
): string {
  const label = escapeHtml(entry.epicSlug);
  const nameHtml =
    path && repoBaseUrl ? `<a href="${pipelineBoardBlobUrl(repoBaseUrl, path)}">${label}</a>` : label;
  const parts: string[] = [];
  if (entry.activeChildCount > 0) {
    parts.push(`${entry.activeChildCount} active`);
  }
  if (entry.pausedChildCount > 0) {
    parts.push(`${entry.pausedChildCount} paused`);
  }
  const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  return `  ${nameHtml}${escapeHtml(suffix)}`;
}

function renderParkedSectionHtml(
  collapsedEpics: PipelineBoardCollapsedEpicEntry[],
  parked: PipelineBoardParkedEntry[],
  pathById: Map<string, string>,
  repoBaseUrl: string | undefined,
  linkedIds: Set<string> | undefined,
  overflowLine?: string,
  // BL-956 hardener bounce D1: the LIVE HTML surface silently dropped the
  // collapsed-epics cap indicator - only the plain-text content-signature
  // sibling (renderParkedSection) carried it, and every test layer asserted
  // that sibling. Same parameter shape as the plain sibling, kept in
  // lockstep.
  epicsOverflowLine?: string
): string[] {
  const plainParked = parked.filter((p) => p.status === 'parked');
  if (parkedSectionIsEmpty(collapsedEpics, plainParked, overflowLine, epicsOverflowLine)) {
    return [];
  }
  const lines: string[] = ['', escapeHtml(PARKED_SECTION_HEADER)];
  for (const epic of collapsedEpics) {
    const path =
      linkedIds !== undefined && !linkedIds.has(epic.trackerId) ? undefined : pathById.get(epic.trackerId);
    lines.push(formatCollapsedEpicLineHtml(epic, path, repoBaseUrl));
  }
  if (epicsOverflowLine) {
    lines.push(`  ${escapeHtml(epicsOverflowLine)}`);
  }
  for (const entry of plainParked) {
    const path =
      linkedIds !== undefined && !linkedIds.has(entry.id) ? undefined : pathById.get(entry.id);
    lines.push(formatBoardListLineHtml(entry.id, entry.slug, path, repoBaseUrl, entry.closedAge));
  }
  if (overflowLine) {
    lines.push(`  ${escapeHtml(overflowLine)}`);
  }
  return lines;
}

function renderListSectionHtml(
  header: string,
  entries: PipelineBoardListEntry[],
  pathById: Map<string, string>,
  repoBaseUrl: string | undefined,
  linkedIds: Set<string> | undefined,
  overflowLine?: string
): string[] {
  if (entries.length === 0 && (overflowLine === undefined || overflowLine === '')) {
    return [];
  }
  const lines: string[] = ['', escapeHtml(header)];
  for (const entry of entries) {
    const path =
      linkedIds !== undefined && !linkedIds.has(entry.id) ? undefined : pathById.get(entry.id);
    lines.push(formatBoardListLineHtml(entry.id, entry.slug, path, repoBaseUrl, entry.closedAge));
  }
  if (overflowLine) {
    lines.push(`  ${escapeHtml(overflowLine)}`);
  }
  return lines;
}

function renderGridTapLinesHtml(
  data: PipelineBoardData,
  pathById: Map<string, string>,
  repoBaseUrl: string | undefined,
  linkedIds: Set<string> | undefined
): string[] {
  if (!repoBaseUrl) {
    return [];
  }
  const inLists = listSectionTicketIds(data);
  const lines: string[] = [];
  for (const row of data.rows) {
    if (inLists.has(row.id)) {
      continue;
    }
    if (linkedIds !== undefined && !linkedIds.has(row.id)) {
      continue;
    }
    const path = pathById.get(row.id);
    if (!path) {
      continue;
    }
    lines.push(formatBoardListLineHtml(row.id, row.slug, path, repoBaseUrl));
  }
  return lines.length === 0 ? [] : ['', ...lines];
}

function buildPipelineBoardHtml(
  data: PipelineBoardData,
  lastChangeMs: number,
  repoBaseUrl: string | undefined,
  linkedIds: Set<string> | undefined
): string {
  const pathById = pathByIdFromLinks(data.links ?? []);
  const gridText = renderGridOnlySections(data).join('\n');
  const pre = `<pre>${escapeHtml(gridText)}</pre>`;
  const parked = data.parked ?? [];
  const parkedOverflow = parkedOverflowLineFor(data);
  // BL-956 hardener bounce D1: computed exactly like parkedOverflow above -
  // the live message must announce the collapsed-epics cap too. Both now go
  // through the shared helpers so the two render paths cannot drift again.
  const epicsOverflow = epicsOverflowLineFor(data);
  const afterPre = [
    ...renderGridTapLinesHtml(data, pathById, repoBaseUrl, linkedIds),
    ...renderParkedSectionHtml(
      data.collapsedEpics ?? [],
      parked,
      pathById,
      repoBaseUrl,
      linkedIds,
      parkedOverflow,
      epicsOverflow
    ),
    ...renderListSectionHtml(
      AWAITING_APPROVAL_SECTION_HEADER,
      parked.filter((p) => p.status === 'awaiting-approval'),
      pathById,
      repoBaseUrl,
      linkedIds
    ),
    ...renderListSectionHtml(ROOT_INTAKE_SECTION_HEADER, data.rootIntake ?? [], pathById, repoBaseUrl, linkedIds),
    ...renderListSectionHtml(
      RECENTLY_CLOSED_SECTION_HEADER,
      data.recentlyClosed ?? [],
      pathById,
      repoBaseUrl,
      linkedIds
    ),
    '',
    escapeHtml(renderUpdatedAtFooter(lastChangeMs)),
  ];
  return [pre, ...afterPre].join('\n');
}

export interface PipelineBoardHtmlComposition {
  html: string;
  omittedLinkCount: number;
}

// Telegram HTML board: status GRID in one <pre> (plain ids — column
// alignment); below-grid list ticket numbers (and grid-only tickets) as
// real <a href> tags AFTER the pre. No LINKS: footer. When the composed
// message would exceed maxLength, anchors are dropped from the oldest
// tickets first (most-recent-first order kept for those that remain) until
// it fits — unlinked ids still render as plain numbers on the board.
export function composePipelineBoardHtml(
  data: PipelineBoardData,
  lastChangeMs: number,
  repoBaseUrl: string | undefined,
  maxLength: number = PIPELINE_BOARD_MESSAGE_MAX_LENGTH
): PipelineBoardHtmlComposition {
  const full = buildPipelineBoardHtml(data, lastChangeMs, repoBaseUrl, undefined);
  if (full.length <= maxLength || !repoBaseUrl || (data.links ?? []).length === 0) {
    return { html: full, omittedLinkCount: 0 };
  }
  const sorted = [...(data.links ?? [])].sort(compareLinksMostRecentFirst);
  for (let keep = sorted.length - 1; keep >= 0; keep -= 1) {
    const linkedIds = new Set(sorted.slice(0, keep).map((link) => link.id));
    const candidate = buildPipelineBoardHtml(data, lastChangeMs, repoBaseUrl, linkedIds);
    if (candidate.length <= maxLength) {
      return { html: candidate, omittedLinkCount: sorted.length - keep };
    }
  }
  return {
    html: buildPipelineBoardHtml(data, lastChangeMs, undefined, new Set()),
    omittedLinkCount: sorted.length,
  };
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
// BL-502 (cleaner, CRAP budget): the trim loop itself - the largest prefix
// of links that still leaves room for the "+N more" overflow indicator -
// extracted from budgetPipelineBoardLinks below purely to keep that
// function's own CRAP under threshold, mirroring conciergeTick.ts's own
// epicTitleFor/epicUpdateText extractions for the identical reason.
function trimLinksToBudget(links: PipelineBoardLinkEntry[], repoBaseUrl: string, maxLinksLength: number): string[] {
  const includedLines: string[] = [];
  for (const link of links) {
    const line = pipelineBoardLinkLine(link, repoBaseUrl);
    const candidateOmitted = links.length - (includedLines.length + 1);
    const candidateLines = [LINKS_SECTION_HEADER, ...includedLines, line];
    if (candidateOmitted > 0) {
      candidateLines.push(pipelineBoardOverflowLine(candidateOmitted));
    }
    if (candidateLines.join('\n').length > maxLinksLength) {
      break;
    }
    includedLines.push(line);
  }
  return includedLines;
}

export function budgetPipelineBoardLinks(links: PipelineBoardLinkEntry[], repoBaseUrl: string | undefined, maxLinksLength: number): PipelineBoardLinksBudget {
  if (links.length === 0 || !repoBaseUrl) {
    return { html: '', omittedCount: 0 };
  }
  const full = renderPipelineBoardLinks(links, repoBaseUrl);
  if (full.length <= maxLinksLength) {
    return { html: full, omittedCount: 0 };
  }
  const includedLines = trimLinksToBudget(links, repoBaseUrl, maxLinksLength);
  // trimLinksToBudget can never accept every link: its FINAL iteration's
  // candidate check (for the last link, with every prior one already
  // included) omits the overflow line entirely - candidateOmitted reaches 0
  // only there - making that candidate identical to `full` above, which we
  // already know exceeds maxLinksLength (the very reason this loop runs).
  // So at least one link is always left out here; omittedCount is never 0.
  const omittedCount = links.length - includedLines.length;
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
  // Emit numeric &#160; for U+00A0 so Telegram HTML parse_mode keeps the
  // Pipeline Board stage header on one phone line. Named &nbsp; is NOT in
  // Telegram's allowed named-entity set (&lt; &gt; &amp; &quot; only) and
  // renders as the literal string "&nbsp;"; numeric entities are supported.
  // BL-1155: narrower 2-wide stage cells (no per-cell leading NBSP) keep the
  // composed header inside the phone <pre> width; numeric &#160; still prevents
  // named-entity literals. Tip 646ffe85d / BL-1117 stamp-off.
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u00a0/g, '&#160;');
}

// BL-465 / in-board links: prefer composePipelineBoardHtml for live posts.
// This helper remains for fixtures/BDD that still compose <pre>+optional
// legacy LINKS: fragment. When boardHtml is already a full composed
// message (starts with <pre>), callers should send it directly instead.
export function wrapPipelineBoardHtml(boardText: string, linksHtml = ''): string {
  const pre = `<pre>${escapeHtml(boardText)}</pre>`;
  return linksHtml ? `${pre}\n\n${linksHtml}` : pre;
}
