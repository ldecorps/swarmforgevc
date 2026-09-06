import * as fs from 'fs';
import * as path from 'path';
import { BacklogItem, readBacklogFolders } from '../panel/backlogReader';
import { getCurrentSha, deriveTicketLifecycles, runGitLog, TicketLifecycleEvent } from '../metrics/gitHistoryAdapter';
import { extractScenarios, GherkinScenario } from './gherkinScenarios';
import { translateMarkdown, translateString, TranslationSession } from '../i18n/translate';

// BL-117: documentation drill-down tree - vision -> milestone -> ticket ->
// Gherkin. All derivation (reading vision docs, grouping by milestone,
// resolving each ticket's acceptance form) lives here, in the Action
// renderer; the PWA client is a pure renderer of the published artifact
// (this ticket's own non-behavioral gate). buildDocsTree is pure over
// already-read data; computeDocsTree is the one impure orchestrator.
//
// BL-118: every translatable field below gains an additive *Fr sibling
// (contentFr/titleFr/descriptionFr) rather than replacing the existing
// English field's shape - schemaVersion stays unchanged (same additive-
// field precedent as costHealth on BacklogDashboardData), and every
// existing English-only consumer/test keeps working untouched.
// translateDocsTree (below) is the one function that populates them; a
// tree computeDocsTree alone produces carries none of them at all.

export const DOCS_TREE_SCHEMA_VERSION = 2;

export const NO_EPIC_KEY = '(no epic)';

export interface VisionDoc {
  id: string;
  title: string;
  kind: 'markdown' | 'mermaid';
  content: string;
  // Only ever set for kind "markdown" - a mermaid doc's content is a
  // diagram source (bilingual-06: never translated), so it simply never
  // gains this field, rather than gaining one equal to its own English text.
  contentFr?: string;
  contentFrUntranslated?: boolean;
}

export interface MilestoneTicketSummary {
  id: string;
  title: string;
  status: 'active' | 'paused' | 'done';
  priority?: number;
  implemented: boolean;
}

export interface EpicNode {
  epicKey: string;
  title?: string;
  trackerId?: string;
  tickets: MilestoneTicketSummary[];
}

export interface MilestoneNode {
  milestone: string;
  epics: EpicNode[];
}

export interface TicketNode {
  id: string;
  title: string;
  status: 'active' | 'paused' | 'done';
  priority?: number;
  milestone?: string;
  description?: string;
  scenarios: GherkinScenario[];
  implemented: boolean;
  titleFr?: string;
  titleFrUntranslated?: boolean;
  descriptionFr?: string;
  descriptionFrUntranslated?: boolean;
  // BL-257 per-ticket-timeline-02: git-derived (gitHistoryAdapter.ts's
  // deriveTicketLifecycles), reproducible from a fresh clone - unlike a
  // richer per-role holding-window breakdown, which needs live
  // .swarmforge/ mailbox state this artifact's own generation pipeline
  // does not have. specDateIso is absent only when no lifecycle event
  // matched this ticket id at all (should not happen for a real backlog
  // item, but never crashes); closeDateIso is absent for a still-open
  // ticket.
  specDateIso?: string;
  closeDateIso?: string;
}

export interface DocsTreeData {
  schemaVersion: number;
  generatedAtIso: string;
  sourceSha: string | null;
  vision: VisionDoc[];
  milestones: MilestoneNode[];
  tickets: TicketNode[];
}

const UNSPECIFIED_MILESTONE = 'unspecified';

// A ticket's acceptance field is either a specs/features/*.feature
// reference (post-BL-111 form) or inline Gherkin text (pre-BL-111 form,
// still the majority of live tickets) - a reference always ends in
// .feature and contains no newline, which inline Gherkin never does.
export function isFeatureFilePath(acceptance: string | undefined): boolean {
  if (!acceptance) {
    return false;
  }
  const trimmed = acceptance.trim();
  return !trimmed.includes('\n') && trimmed.endsWith('.feature');
}

type StatusedItem = Omit<BacklogItem, 'status'> & { status: 'active' | 'paused' | 'done' };

// BL-253: whole-ticket implementation status derives purely from the
// backlog folder-authoritative status - done/ => implemented; active/ or
// paused/ => not-yet-implemented. Computed once here so the ticket node
// and its milestone summary always agree; a PWA consumer reads this field
// directly rather than re-deriving its own copy of the done/not-done rule.
// Greying not-yet tickets is a PWA-side VISUAL treatment only - this flag
// gates nothing else (recertification stays available regardless, see
// recertification.ts's own status-blind recertifiableScenariosFrom).
function deriveImplemented(status: StatusedItem['status']): boolean {
  return status === 'done';
}

function toMilestoneTicketSummary(item: StatusedItem): MilestoneTicketSummary {
  const summary: MilestoneTicketSummary = { id: item.id, title: item.title, status: item.status, implemented: deriveImplemented(item.status) };
  if (item.priority !== undefined) {
    summary.priority = item.priority;
  }
  return summary;
}

function buildEpicTrackersByKey(items: StatusedItem[]): Map<string, StatusedItem> {
  const trackers = new Map<string, StatusedItem>();
  for (const item of items) {
    if (item.type === 'epic' && item.epic) {
      trackers.set(item.epic, item);
    }
  }
  return trackers;
}

function epicKeyForItem(item: StatusedItem): string {
  return item.epic ?? NO_EPIC_KEY;
}

function buildEpicNodes(milestoneItems: StatusedItem[], trackersByEpicKey: Map<string, StatusedItem>): EpicNode[] {
  const byEpic = new Map<string, StatusedItem[]>();
  for (const item of milestoneItems) {
    const key = epicKeyForItem(item);
    if (!byEpic.has(key)) {
      byEpic.set(key, []);
    }
    byEpic.get(key)!.push(item);
  }
  const nodes: EpicNode[] = [];
  for (const [epicKey, members] of byEpic.entries()) {
    const tracker = trackersByEpicKey.get(epicKey);
    const ticketMembers = tracker ? members.filter((m) => m.id !== tracker.id) : members;
    const node: EpicNode = {
      epicKey,
      tickets: ticketMembers.map(toMilestoneTicketSummary).sort((a, b) => a.id.localeCompare(b.id)),
    };
    if (tracker) {
      node.title = tracker.title;
      node.trackerId = tracker.id;
    }
    nodes.push(node);
  }
  return nodes.sort((a, b) => a.epicKey.localeCompare(b.epicKey));
}

function buildMilestoneNodes(items: StatusedItem[]): MilestoneNode[] {
  const trackersByEpicKey = buildEpicTrackersByKey(items);
  const byMilestone = new Map<string, StatusedItem[]>();
  for (const item of items) {
    const milestone = item.milestone ?? UNSPECIFIED_MILESTONE;
    if (!byMilestone.has(milestone)) {
      byMilestone.set(milestone, []);
    }
    byMilestone.get(milestone)!.push(item);
  }
  return [...byMilestone.entries()]
    .map(([milestone, milestoneItems]) => ({
      milestone,
      epics: buildEpicNodes(milestoneItems, trackersByEpicKey),
    }))
    .sort((a, b) => a.milestone.localeCompare(b.milestone));
}

/** Flatten epic-grouped milestone data for consumers that skip the epic tier (PWA). */
export function flattenMilestoneTickets(milestone: MilestoneNode): MilestoneTicketSummary[] {
  return milestone.epics.flatMap((epic) => epic.tickets);
}

// Split out of toTicketNode (below) so each function's own complexity -
// and CRAP score - stays low independently, same pattern as
// dependency-gate.ts's mediaJsFilesForScopePath split.
function applyLifecycleFields(node: TicketNode, lifecycle: TicketLifecycleEvent | undefined): void {
  if (!lifecycle) {
    return;
  }
  node.specDateIso = lifecycle.specDateIso;
  if (lifecycle.closeDateIso) {
    node.closeDateIso = lifecycle.closeDateIso;
  }
}

function toTicketNode(
  item: StatusedItem,
  scenariosByTicketId: Map<string, GherkinScenario[]>,
  lifecyclesByTicketId: Map<string, TicketLifecycleEvent>
): TicketNode {
  const node: TicketNode = {
    id: item.id,
    title: item.title,
    status: item.status,
    scenarios: scenariosByTicketId.get(item.id) ?? [],
    implemented: deriveImplemented(item.status),
  };
  if (item.priority !== undefined) {
    node.priority = item.priority;
  }
  if (item.milestone !== undefined) {
    node.milestone = item.milestone;
  }
  if (item.description !== undefined) {
    node.description = item.description;
  }
  applyLifecycleFields(node, lifecyclesByTicketId.get(item.id));
  return node;
}

// Pure: assembles the full docs-tree payload from already-read vision docs,
// all backlog items (each already carrying its folder-authoritative
// status), and each ticket's already-resolved Gherkin scenarios (resolving
// which form an acceptance field takes, and reading a referenced feature
// file, is computeDocsTree's job below - not this function's).
export function buildDocsTree(
  vision: VisionDoc[],
  items: StatusedItem[],
  scenariosByTicketId: Map<string, GherkinScenario[]>,
  sourceSha: string | null,
  generatedAtIso: string,
  lifecyclesByTicketId: Map<string, TicketLifecycleEvent> = new Map()
): DocsTreeData {
  return {
    schemaVersion: DOCS_TREE_SCHEMA_VERSION,
    generatedAtIso,
    sourceSha,
    vision,
    milestones: buildMilestoneNodes(items),
    tickets: items.map((item) => toTicketNode(item, scenariosByTicketId, lifecyclesByTicketId)),
  };
}

// BL-254: pure, client-side full-text search filter over an already-built
// tree - case-insensitive substring against a ticket's title, description,
// and every scenario's text, pruning to matching tickets while keeping the
// milestone hierarchy (a milestone left with zero matches after pruning is
// dropped, rather than shown as an empty bucket). REUSE: filters the tree
// the PWA already fetches; adds no new store or endpoint. The DOM search
// box (pwa/app.js) is the unsuitable-for-testing boundary - only this pure
// function is unit- and acceptance-tested.
function ticketMatchesQuery(ticket: TicketNode, lowerQuery: string): boolean {
  if (ticket.title.toLowerCase().includes(lowerQuery)) {
    return true;
  }
  if (ticket.description?.toLowerCase().includes(lowerQuery)) {
    return true;
  }
  return ticket.scenarios.some((scenario) => scenario.text.toLowerCase().includes(lowerQuery));
}

export function filterDocsTree(tree: DocsTreeData, query: string): DocsTreeData {
  const trimmed = query.trim();
  if (!trimmed) {
    return tree;
  }
  const lowerQuery = trimmed.toLowerCase();
  const tickets = tree.tickets.filter((ticket) => ticketMatchesQuery(ticket, lowerQuery));
  const matchingIds = new Set(tickets.map((ticket) => ticket.id));
  const milestones = tree.milestones
    .map((milestone) => ({
      milestone: milestone.milestone,
      epics: milestone.epics
        .map((epic) => ({
          ...epic,
          tickets: epic.tickets.filter((ticket) => matchingIds.has(ticket.id)),
        }))
        .filter((epic) => epic.tickets.length > 0),
    }))
    .filter((milestone) => milestone.epics.length > 0);
  return { ...tree, tickets, milestones };
}

function labelMatches(label: string | undefined, lowerQuery: string): boolean {
  return !!label && label.toLowerCase().includes(lowerQuery);
}

// Hardener extraction (CRAP): filterSpecTree's own per-milestone epic
// filtering, isolated so each function's complexity is measured on its own
// rather than compounding into one function - filterSpecTree's body dropped
// from complexity 8 (CRAP 8.00) to complexity 4 (CRAP 4.00) by this split
// alone, with the extracted function itself at complexity 4 (CRAP 4.00).
// No behavior change: a milestone- or epic-label match still keeps that
// epic's WHOLE ticket list; otherwise only tickets in ticketMatchedIds
// survive.
function filterMilestoneEpics(milestone: MilestoneNode, lowerQuery: string, ticketMatchedIds: Set<string>): EpicNode[] {
  const milestoneLabelMatch = labelMatches(milestone.milestone, lowerQuery);
  const epics: EpicNode[] = [];
  for (const epic of milestone.epics) {
    const keepWholeEpic = milestoneLabelMatch || labelMatches(epic.title, lowerQuery);
    const tickets = keepWholeEpic ? epic.tickets : epic.tickets.filter((ticket) => ticketMatchedIds.has(ticket.id));
    if (tickets.length > 0) {
      epics.push({ ...epic, tickets });
    }
  }
  return epics;
}

// BL-1412: the classic IDE tree filter, on top of BL-254's ticket-text
// match (filterDocsTree, REUSED here - never re-implemented, never edited,
// since pwa/app.js mirrors its body by hand). Adds a LABEL match: a
// milestone name, an epic tracker's title, or a ticket id that contains
// the term keeps that node with its WHOLE subtree, unfiltered - the
// property a plain ticket-text match alone cannot express (filterDocsTree
// prunes every epic/milestone down to only the tickets that themselves
// matched). Rebuilds the milestone hierarchy from the UNFILTERED tree
// rather than post-processing filterDocsTree's own (already-pruned)
// output, which is why the ticket-text match is read as a set of ids
// (textMatchedIds) rather than as a tree to further filter.
export function filterSpecTree(tree: DocsTreeData, query: string): DocsTreeData {
  const trimmed = query.trim();
  if (!trimmed) {
    return tree;
  }
  const lowerQuery = trimmed.toLowerCase();

  const textMatchedIds = new Set(filterDocsTree(tree, query).tickets.map((ticket) => ticket.id));
  const idMatchedIds = new Set(tree.tickets.filter((ticket) => labelMatches(ticket.id, lowerQuery)).map((ticket) => ticket.id));
  const ticketMatchedIds = new Set<string>([...textMatchedIds, ...idMatchedIds]);

  const milestones: MilestoneNode[] = [];
  for (const milestone of tree.milestones) {
    const epics = filterMilestoneEpics(milestone, lowerQuery, ticketMatchedIds);
    if (epics.length > 0) {
      milestones.push({ milestone: milestone.milestone, epics });
    }
  }

  const keptTicketIds = new Set(milestones.flatMap((milestone) => milestone.epics.flatMap((epic) => epic.tickets.map((ticket) => ticket.id))));
  const tickets = tree.tickets.filter((ticket) => keptTicketIds.has(ticket.id));

  return { ...tree, tickets, milestones };
}

interface VisionDocSpec {
  id: string;
  title: string;
  kind: 'markdown' | 'mermaid';
  relativePath: string;
}

// BL-456: paths updated for the Divio four-mode reorg (docs/reference/,
// docs/explanation/, docs/tutorials/) - the diagrams stay under
// docs/diagrams/, out of the mode split (local-engineering diagrams rule).
const VISION_DOCS: VisionDocSpec[] = [
  { id: 'specification', title: 'Specification', kind: 'markdown', relativePath: 'docs/reference/Specification.MD' },
  { id: 'roadmap', title: 'Milestone Roadmap', kind: 'markdown', relativePath: 'docs/explanation/Milestone Roadmap.MD' },
  { id: 'gettingStarted', title: 'Getting Started', kind: 'markdown', relativePath: 'docs/tutorials/GettingStarted.md' },
  { id: 'architectureDiagram', title: 'Architecture', kind: 'mermaid', relativePath: 'docs/diagrams/architecture.mmd' },
  { id: 'swarmFlowDiagram', title: 'Swarm Flow', kind: 'mermaid', relativePath: 'docs/diagrams/swarm-flow.mmd' },
];

// BL-866: also read by companionManifest.ts's docs package - exported so
// that catalog doesn't duplicate VISION_DOCS's own list of source paths.
export function readVisionDocs(targetPath: string): VisionDoc[] {
  const docs: VisionDoc[] = [];
  for (const spec of VISION_DOCS) {
    try {
      const content = fs.readFileSync(path.join(targetPath, spec.relativePath), 'utf8');
      docs.push({ id: spec.id, title: spec.title, kind: spec.kind, content });
    } catch {
      continue; // doc not present at this SHA - simply absent from the tree
    }
  }
  return docs;
}

// Resolves one ticket's acceptance field into raw Gherkin text: reads the
// referenced .feature file if that's the form in use, otherwise treats the
// field as already-inline Gherkin. A missing/unreadable referenced file
// resolves to no text (and therefore no scenarios) rather than throwing.
function resolveGherkinText(targetPath: string, acceptance: string | undefined): string | null {
  if (!acceptance) {
    return null;
  }
  if (!isFeatureFilePath(acceptance)) {
    return acceptance;
  }
  try {
    return fs.readFileSync(path.join(targetPath, acceptance.trim()), 'utf8');
  } catch {
    return null;
  }
}

function withStatus(item: BacklogItem, status: StatusedItem['status']): StatusedItem {
  return { ...item, status };
}

// The one impure entry point: reads the vision docs, every backlog item
// (tagged with its folder-authoritative status), and resolves each
// ticket's Gherkin scenarios - then delegates to the pure assembler above.
export function computeDocsTree(targetPath: string, nowMs: number = Date.now()): DocsTreeData {
  const vision = readVisionDocs(targetPath);
  const folders = readBacklogFolders(targetPath);
  const items: StatusedItem[] = [
    ...folders.active.map((item) => withStatus(item, 'active')),
    ...folders.paused.map((item) => withStatus(item, 'paused')),
    ...folders.done.map((item) => withStatus(item, 'done')),
  ];

  const scenariosByTicketId = new Map<string, GherkinScenario[]>();
  for (const item of items) {
    const gherkinText = resolveGherkinText(targetPath, item.acceptance);
    if (gherkinText) {
      scenariosByTicketId.set(item.id, extractScenarios(gherkinText));
    }
  }

  const lifecyclesByTicketId = deriveTicketLifecycles(runGitLog(targetPath, 'backlog'));

  return buildDocsTree(
    vision,
    items,
    scenariosByTicketId,
    getCurrentSha(targetPath),
    new Date(nowMs).toISOString(),
    lifecyclesByTicketId
  );
}

// BL-230: translate.ts's session-level API is now parameterized over an
// arbitrary target locale (a single fixed session.targetLang collided
// across configured locales - see translationCache.ts's schema bump).
// docsTree.ts stays French-only for now (descriptions/docs/scenarios are
// explicitly out of BL-230's own scope, a later slice) - 'fr' passed
// explicitly here is a mechanical adaptation to the shared API's new
// shape, not a behavior change.
const DOCS_TREE_LOCALE = 'fr';

async function translateVisionDoc(session: TranslationSession, doc: VisionDoc): Promise<VisionDoc> {
  if (doc.kind !== 'markdown') {
    return doc; // mermaid diagram source - bilingual-06, never translated
  }
  const translated = await translateMarkdown(session, doc.content, DOCS_TREE_LOCALE);
  const result: VisionDoc = { ...doc, contentFr: translated.text };
  if (translated.untranslated) {
    result.contentFrUntranslated = true;
  }
  return result;
}

async function translateScenario(session: TranslationSession, scenario: GherkinScenario): Promise<GherkinScenario> {
  const translated = await translateString(session, scenario.text, DOCS_TREE_LOCALE);
  const result: GherkinScenario = { ...scenario, textFr: translated.text };
  if (translated.untranslated) {
    result.textFrUntranslated = true;
  }
  return result;
}

async function translateTicket(session: TranslationSession, ticket: TicketNode): Promise<TicketNode> {
  const title = await translateString(session, ticket.title, DOCS_TREE_LOCALE);
  const scenarios = await Promise.all(ticket.scenarios.map((s) => translateScenario(session, s)));
  const result: TicketNode = { ...ticket, titleFr: title.text, scenarios };
  if (title.untranslated) {
    result.titleFrUntranslated = true;
  }
  if (ticket.description !== undefined) {
    const description = await translateString(session, ticket.description, DOCS_TREE_LOCALE);
    result.descriptionFr = description.text;
    if (description.untranslated) {
      result.descriptionFrUntranslated = true;
    }
  }
  return result;
}

// BL-118: populates every translatable field's additive *Fr sibling on an
// already-computed English tree - a separate pass from computeDocsTree
// (which stays English-only) so the translation step can be skipped
// entirely (e.g. a local dev build) without touching the tree's own
// derivation logic at all. Ticket ids, ticket status, milestone names,
// priorities, sourceSha, and generatedAtIso are never wrapped (bilingual-06:
// identifiers are never translated) - only title/description/scenario
// text/markdown vision-doc content go through the session.
export async function translateDocsTree(tree: DocsTreeData, session: TranslationSession): Promise<DocsTreeData> {
  const vision = await Promise.all(tree.vision.map((doc) => translateVisionDoc(session, doc)));
  const tickets = await Promise.all(tree.tickets.map((ticket) => translateTicket(session, ticket)));
  return { ...tree, vision, tickets };
}
