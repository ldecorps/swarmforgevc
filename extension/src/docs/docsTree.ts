import * as fs from 'fs';
import * as path from 'path';
import { BacklogItem, readBacklogFolders } from '../panel/backlogReader';
import { getCurrentSha } from '../metrics/gitHistoryAdapter';
import { extractScenarios, GherkinScenario } from './gherkinScenarios';

// BL-117: documentation drill-down tree - vision -> milestone -> ticket ->
// Gherkin. All derivation (reading vision docs, grouping by milestone,
// resolving each ticket's acceptance form) lives here, in the Action
// renderer; the PWA client is a pure renderer of the published artifact
// (this ticket's own non-behavioral gate). buildDocsTree is pure over
// already-read data; computeDocsTree is the one impure orchestrator.

export const DOCS_TREE_SCHEMA_VERSION = 1;

export interface VisionDoc {
  id: string;
  title: string;
  kind: 'markdown' | 'mermaid';
  content: string;
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
