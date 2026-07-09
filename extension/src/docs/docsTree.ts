import * as fs from 'fs';
import * as path from 'path';
import { BacklogItem, readBacklogFolders } from '../panel/backlogReader';
import { getCurrentSha } from '../metrics/gitHistoryAdapter';
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

export const DOCS_TREE_SCHEMA_VERSION = 1;

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
}

export interface MilestoneNode {
  milestone: string;
  tickets: MilestoneTicketSummary[];
}

export interface TicketNode {
  id: string;
  title: string;
  status: 'active' | 'paused' | 'done';
  priority?: number;
  milestone?: string;
  description?: string;
  scenarios: GherkinScenario[];
  titleFr?: string;
  titleFrUntranslated?: boolean;
  descriptionFr?: string;
  descriptionFrUntranslated?: boolean;
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

function toMilestoneTicketSummary(item: StatusedItem): MilestoneTicketSummary {
  const summary: MilestoneTicketSummary = { id: item.id, title: item.title, status: item.status };
  if (item.priority !== undefined) {
    summary.priority = item.priority;
  }
  return summary;
}

function buildMilestoneNodes(items: StatusedItem[]): MilestoneNode[] {
  const byMilestone = new Map<string, MilestoneTicketSummary[]>();
  for (const item of items) {
    const milestone = item.milestone ?? UNSPECIFIED_MILESTONE;
    if (!byMilestone.has(milestone)) {
      byMilestone.set(milestone, []);
    }
    byMilestone.get(milestone)!.push(toMilestoneTicketSummary(item));
  }
  return [...byMilestone.entries()]
    .map(([milestone, tickets]) => ({ milestone, tickets }))
    .sort((a, b) => a.milestone.localeCompare(b.milestone));
}

function toTicketNode(item: StatusedItem, scenariosByTicketId: Map<string, GherkinScenario[]>): TicketNode {
  const node: TicketNode = {
    id: item.id,
    title: item.title,
    status: item.status,
    scenarios: scenariosByTicketId.get(item.id) ?? [],
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
  generatedAtIso: string
): DocsTreeData {
  return {
    schemaVersion: DOCS_TREE_SCHEMA_VERSION,
    generatedAtIso,
    sourceSha,
    vision,
    milestones: buildMilestoneNodes(items),
    tickets: items.map((item) => toTicketNode(item, scenariosByTicketId)),
  };
}

interface VisionDocSpec {
  id: string;
  title: string;
  kind: 'markdown' | 'mermaid';
  relativePath: string;
}

const VISION_DOCS: VisionDocSpec[] = [
  { id: 'specification', title: 'Specification', kind: 'markdown', relativePath: 'docs/Specification.MD' },
  { id: 'roadmap', title: 'Milestone Roadmap', kind: 'markdown', relativePath: 'docs/Milestone Roadmap.MD' },
  { id: 'gettingStarted', title: 'Getting Started', kind: 'markdown', relativePath: 'docs/GettingStarted.md' },
  { id: 'architectureDiagram', title: 'Architecture', kind: 'mermaid', relativePath: 'docs/diagrams/architecture.mmd' },
  { id: 'swarmFlowDiagram', title: 'Swarm Flow', kind: 'mermaid', relativePath: 'docs/diagrams/swarm-flow.mmd' },
];

function readVisionDocs(targetPath: string): VisionDoc[] {
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

  return buildDocsTree(vision, items, scenariosByTicketId, getCurrentSha(targetPath), new Date(nowMs).toISOString());
}

async function translateVisionDoc(session: TranslationSession, doc: VisionDoc): Promise<VisionDoc> {
  if (doc.kind !== 'markdown') {
    return doc; // mermaid diagram source - bilingual-06, never translated
  }
  const translated = await translateMarkdown(session, doc.content);
  const result: VisionDoc = { ...doc, contentFr: translated.fr };
  if (translated.frUntranslated) {
    result.contentFrUntranslated = true;
  }
  return result;
}

async function translateScenario(session: TranslationSession, scenario: GherkinScenario): Promise<GherkinScenario> {
  const translated = await translateString(session, scenario.text);
  const result: GherkinScenario = { ...scenario, textFr: translated.fr };
  if (translated.frUntranslated) {
    result.textFrUntranslated = true;
  }
  return result;
}

async function translateTicket(session: TranslationSession, ticket: TicketNode): Promise<TicketNode> {
  const title = await translateString(session, ticket.title);
  const scenarios = await Promise.all(ticket.scenarios.map((s) => translateScenario(session, s)));
  const result: TicketNode = { ...ticket, titleFr: title.fr, scenarios };
  if (title.frUntranslated) {
    result.titleFrUntranslated = true;
  }
  if (ticket.description !== undefined) {
    const description = await translateString(session, ticket.description);
    result.descriptionFr = description.fr;
    if (description.frUntranslated) {
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
