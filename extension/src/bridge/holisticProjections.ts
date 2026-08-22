import { BacklogItem } from '../panel/backlogReader';
import { TicketHoldingWindow } from '../metrics/ticketHoldingWindows';
import { TicketLifecycleEvent, MergeLogEntry } from '../metrics/gitHistoryAdapter';
import { RunEntry, mostRecentRunForTarget } from '../runs/runLog';
import * as fs from 'fs';
import * as path from 'path';
import { parseConfigValue, readConfigValue } from '../util/swarmforgeConfig';

// BL-094: pure projections for the holistic web UI. Every function here
// takes already-read data (backlog items, holding windows, git-derived
// lifecycles/merges, run log entries) - only the two readSwarmName/thin-fs
// pieces touch disk, matching this ticket's own "data contracts are what
// get tested" scope note.

// BL-1010: hand-mirrored from swarm_identity_lib.bb's `default-swarm-name`.
// No import can bridge TypeScript and Babashka, so the two literals are kept
// together by a TEST that reads both from source (a "kept in sync" comment is
// not a gate, and drift here mis-publishes fleet status silently). Exported so
// that test - and any caller needing the fallback - reads it rather than
// restating it, which would only mint a third copy.
export const DEFAULT_SWARM_NAME = 'primary';

// BL-090: `config swarm_name <name>` in swarmforge/swarmforge.conf.
export function parseSwarmName(confContent: string): string {
  return parseConfigValue(confContent, 'swarm_name') ?? DEFAULT_SWARM_NAME;
}

// Hardener split (CRAP): the per-line parse was inlined into
// readSwarmIdentityValue's loop, which alone pushed its cyclomatic complexity
// to 7 (CRAP 7.00 at 100% coverage - coverage was never the problem, the
// branch count was). Extracted as its own pure, behavior-preserving helper so
// each function's CRAP is measured on its own branches, not the sum of both.
function parseIdentityLine(line: string, key: string): string | undefined {
  if (!line.trim()) return undefined;
  const tab = line.indexOf('\t');
  if (tab < 0) return undefined;
  if (line.slice(0, tab) !== key) return undefined;
  const value = line.slice(tab + 1).trim();
  // An empty value is not a name - fall through rather than publish under "".
  return value || undefined;
}

// BL-1010: the swarm-identity file swarmforge.sh's write_swarm_identity_file
// actually writes - tab-separated `key<TAB>value` lines under .swarmforge/.
// This is the file the launcher writes and the conf is not; reading only the
// conf is what made a secondary swarm publish under the primary's name.
function readSwarmIdentityValue(targetPath: string, key: string): string | undefined {
  let content: string;
  try {
    content = fs.readFileSync(path.join(targetPath, '.swarmforge', 'swarm-identity'), 'utf8');
  } catch {
    // Absent (every pre-BL-090 swarm) or unreadable: fall through to the next
    // source rather than take the publisher down.
    return undefined;
  }
  for (const line of content.split('\n')) {
    const value = parseIdentityLine(line, key);
    if (value) return value;
  }
  return undefined;
}

/**
 * This swarm's own name, resolved the same way swarm_identity_lib.bb resolves
 * it: the identity file the launcher writes, then the conf, then the shared
 * default.
 *
 * BL-1010: this is deliberately the ONE resolver. emit-fleet-status,
 * backlogDashboard and bridgeState all call it, so none keeps a private order
 * of its own - a second reader with its own order is exactly the defect this
 * fixes, one level up.
 */
export function readSwarmName(targetPath: string): string {
  return readSwarmIdentityValue(targetPath, 'swarm_name')
    ?? readConfigValue(targetPath, 'swarm_name')
    ?? DEFAULT_SWARM_NAME;
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
