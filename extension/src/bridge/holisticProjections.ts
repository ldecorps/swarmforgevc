import * as fs from 'fs';
import * as path from 'path';
import { BacklogItem } from '../panel/backlogReader';
import { TicketHoldingWindow } from '../metrics/ticketHoldingWindows';
import { TicketLifecycleEvent, MergeLogEntry } from '../metrics/gitHistoryAdapter';
import { RunEntry, mostRecentRunForTarget } from '../runs/runLog';

// BL-094: pure projections for the holistic web UI. Every function here
// takes already-read data (backlog items, holding windows, git-derived
// lifecycles/merges, run log entries) - only the two readSwarmName/thin-fs
// pieces touch disk, matching this ticket's own "data contracts are what
// get tested" scope note.

const DEFAULT_SWARM_NAME = 'primary';

// BL-090: `config swarm_name <name>` in swarmforge/swarmforge.conf; absent
// entirely (the common case today - no ticket has actually adopted this
// yet) defaults to "primary", matching BL-090's own stated default.
export function parseSwarmName(confContent: string): string {
  const match = confContent.match(/^\s*config\s+swarm_name\s+(\S+)/m);
  return match ? match[1] : DEFAULT_SWARM_NAME;
}

export function readSwarmName(targetPath: string): string {
  try {
    return parseSwarmName(fs.readFileSync(path.join(targetPath, 'swarmforge', 'swarmforge.conf'), 'utf8'));
  } catch {
    return DEFAULT_SWARM_NAME;
  }
}

// ── assignments (holistic-ui-02/03) ─────────────────────────────────────

export interface TicketAssignment {
  ticketId: string;
  title: string;
  swarm: string;
  isLocal: boolean;
  folderStatus: 'active' | 'paused';
  // The role currently holding this ticket (its live pipeline stage) - only
  // ever known for the local swarm. A remote swarm's tickets are visible
  // (folder position, swarm field - both git-derived and shared) but their
  // in-pipeline stage is live state this machine has no access to.
  stageRole: string | null;
  milestone?: string;
  priority?: number;
}

function toAssignment(
  item: BacklogItem,
  folderStatus: 'active' | 'paused',
  localSwarmName: string,
  currentHolders: Map<string, string>
): TicketAssignment {
  const swarm = item.swarm ?? localSwarmName;
  const isLocal = swarm === localSwarmName;
  return {
    ticketId: item.id,
    title: item.title,
    swarm,
    isLocal,
    folderStatus,
    stageRole: isLocal ? currentHolders.get(item.id) ?? null : null,
    milestone: item.milestone,
    priority: item.priority,
  };
}

export function computeAssignments(
  activeItems: BacklogItem[],
  pausedItems: BacklogItem[],
  localSwarmName: string,
  currentHolders: Map<string, string>
): TicketAssignment[] {
  return [
    ...activeItems.map((item) => toAssignment(item, 'active', localSwarmName, currentHolders)),
    ...pausedItems.map((item) => toAssignment(item, 'paused', localSwarmName, currentHolders)),
  ];
}

// Pure: collapses every role's holding windows into one ticketId -> role
// map, keeping only the currently-open window (endMs === null) per ticket -
// a closed window means that role no longer holds it.
export function computeCurrentHolders(windowsByRole: Record<string, TicketHoldingWindow[]>): Map<string, string> {
  const holders = new Map<string, string>();
  for (const [role, windows] of Object.entries(windowsByRole)) {
    for (const w of windows) {
      if (w.endMs === null) {
        holders.set(w.ticketId, role);
      }
    }
  }
  return holders;
}

// ── done-by-milestone ────────────────────────────────────────────────────

const UNSPECIFIED_MILESTONE = 'unspecified';

export function groupDoneByMilestone(doneItems: BacklogItem[]): Record<string, BacklogItem[]> {
  const result: Record<string, BacklogItem[]> = {};
  for (const item of doneItems) {
    const milestone = item.milestone ?? UNSPECIFIED_MILESTONE;
    if (!result[milestone]) {
      result[milestone] = [];
    }
    result[milestone].push(item);
  }
  return result;
}

// ── recent activity ──────────────────────────────────────────────────────

export interface RecentActivity {
  recentCloses: Array<{ ticketId: string; closeDateIso: string }>;
  recentMerges: MergeLogEntry[];
  currentRun: RunEntry | null;
}

export function computeRecentActivity(
  lifecycles: TicketLifecycleEvent[],
  merges: MergeLogEntry[],
  runs: RunEntry[],
  targetPath: string,
  limit: number = 10
): RecentActivity {
  const recentCloses = lifecycles
    .filter((l): l is TicketLifecycleEvent & { closeDateIso: string } => l.closeDateIso !== null)
    .sort((a, b) => Date.parse(b.closeDateIso) - Date.parse(a.closeDateIso))
    .slice(0, limit)
    .map((l) => ({ ticketId: l.ticketId, closeDateIso: l.closeDateIso }));

  return {
    recentCloses,
    recentMerges: merges.slice(0, limit),
    currentRun: mostRecentRunForTarget(runs, targetPath),
  };
}
