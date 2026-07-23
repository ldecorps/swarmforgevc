import * as fs from 'fs';
import * as path from 'path';
import { readHandoffHeaderRecordsWithBatches, extractTicketId } from '../metrics/swarmMetrics';

const SWARMFORGE_DIR = '.swarmforge';
const HANDOFF_EXTENSION = '.handoff';
const INBOX_SUBDIRS = ['new', 'in_process'];
const TSV_ROLE_INDEX = 0;
const TSV_WORKTREE_NAME_INDEX = 1;
const TSV_WORKTREE_INDEX = 2;
const TSV_DISPLAY_NAME_INDEX = 4;
const TSV_AGENT_INDEX = 5;

export interface RoleEntry {
  role: string;
  worktreeName: string;
  worktreePath: string;
  displayName: string;
  // BL-208: the configured agent/provider brand (claude/aider/grok/codex/
  // copilot/mock - agent_runtime_lib.bb's supported-agents), the one
  // common field cross-provider readers group telemetry by. Undefined for
  // a TSV row shorter than expected, never a crash.
  agent?: string;
}

export interface PipelineStage {
  role: string;
  displayName: string;
  status: 'active' | 'idle';
  // BL-452: the pipeline board's own data source - ticket id(s) this role is
  // CURRENTLY holding, right now, in in_process (never inbox/new, which is
  // merely queued; never completed history) - a cheap, one-directory read,
  // no git walk. A batch role (cleaner/hardener) may hold several at once.
  // Distinct from telegram-front-desk-bot.ts's own readRoleTicket (BL-301),
  // which derives "current holder" from completed+in_process holding
  // WINDOWS - the hop-log-shaped mechanism the Operator explicitly rejected
  // as this feature's data source (BL-452 ticket notes).
  heldTicketIds: string[];
}

// Split out of parseRolesTsv so each function stays under the CRAP<=6 gate
// - the agent field is only present on the entry when the TSV row actually
// carried one (an `agent?: undefined` property would fail the ticket's own
// "omitted, not present-but-undefined" role-entry shape elsewhere).
function buildRoleEntry(role: string, worktreeName: string, worktreePath: string, displayName: string, agent: string): RoleEntry {
  return agent ? { role, worktreeName, worktreePath, displayName, agent } : { role, worktreeName, worktreePath, displayName };
}

export function parseRolesTsv(tsv: string): RoleEntry[] {
  const entries: RoleEntry[] = [];
  for (const line of tsv.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split('\t');
    const role = parts[TSV_ROLE_INDEX];
    const worktreeName = parts[TSV_WORKTREE_NAME_INDEX];
    const worktreePath = parts[TSV_WORKTREE_INDEX];
    const displayName = parts[TSV_DISPLAY_NAME_INDEX];
    if (role && worktreePath && displayName) {
      entries.push(buildRoleEntry(role, worktreeName, worktreePath, displayName, parts[TSV_AGENT_INDEX]));
    }
  }
  return entries;
}

// BL-128: the one shared, role-keyed mailbox path resolver on the
// TypeScript side, mirroring handoff_lib.bb's mailbox-base-dir/mailbox-dir.
// Coordinator and specifier both run on the shared `master` worktree, so
// they get their own <role> subdirectory; every other role's own dedicated
// worktree already provides physical separation and keeps the flat layout.
export function mailboxBaseDir(entry: Pick<RoleEntry, 'role' | 'worktreeName' | 'worktreePath'>): string {
  if (entry.worktreeName === 'master') {
    return path.join(entry.worktreePath, SWARMFORGE_DIR, 'handoffs', entry.role);
  }
  return path.join(entry.worktreePath, SWARMFORGE_DIR, 'handoffs');
}

export function mailboxDir(entry: Pick<RoleEntry, 'role' | 'worktreeName' | 'worktreePath'>, ...segments: string[]): string {
  return path.join(mailboxBaseDir(entry), ...segments);
}

export function readHandoffInboxStatus(entry: Pick<RoleEntry, 'role' | 'worktreeName' | 'worktreePath'>): 'active' | 'idle' {
  for (const subdir of INBOX_SUBDIRS) {
    const dir = mailboxDir(entry, 'inbox', subdir);
    if (!fs.existsSync(dir)) {
      continue;
    }
    if (hasHandoffFiles(dir)) {
      return 'active';
    }
  }

  return 'idle';
}

function hasHandoffFiles(dir: string): boolean {
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith(HANDOFF_EXTENSION)) {
        return true;
      }
      const fullPath = path.join(dir, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        if (fs.readdirSync(fullPath).some((f) => f.endsWith(HANDOFF_EXTENSION))) {
          return true;
        }
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return false;
}

// BL-452: every distinct ticket id this role's in_process handoff(s) name -
// reuses the SAME batch-aware handoff-header reader ticketHoldingWindows.ts
// already relies on (readHandoffHeaderRecordsWithBatches) and the shared
// ticket-id extraction (extractTicketId), rather than re-deriving either.
// Deduped since a role should not report the same held ticket twice even if
// an anomaly left more than one handoff naming it.
function readInProcessTicketIds(entry: Pick<RoleEntry, 'role' | 'worktreeName' | 'worktreePath'>): string[] {
  const dir = mailboxDir(entry, 'inbox', 'in_process');
  const ids = readHandoffHeaderRecordsWithBatches(dir)
    .map((headers) => {
      const fromTask = headers.task ? extractTicketId(headers.task) : null;
      if (fromTask) {
        return fromTask;
      }
      return headers.message ? extractTicketId(headers.message) : null;
    })
    .filter((id): id is string => id !== null);
  return [...new Set(ids)];
}

export function readPipelineStages(targetPath: string): PipelineStage[] {
  const rolesFile = path.join(targetPath, SWARMFORGE_DIR, 'roles.tsv');
  if (!fs.existsSync(rolesFile)) {
    return [];
  }

  const tsv = fs.readFileSync(rolesFile, 'utf8');
  return parseRolesTsv(tsv).map((entry) => ({
    role: entry.role,
    displayName: entry.displayName,
    status: readHandoffInboxStatus(entry),
    heldTicketIds: readInProcessTicketIds(entry),
  }));
}

// BL-464: the pipeline board's AUTHORITATIVE ticket->stage source, replacing
// readInProcessTicketIds/readPipelineStages's own heldTicketIds as the
// board's data source (readPipelineStages itself stays unchanged - the VS
// Code panel's own currentStageLabel/findLiveHolder still use it). This is a
// bot-owned, machine-local file (gitignored under .swarmforge/, same
// posture as every other file in that directory) written EXCLUSIVELY by the
// coordinator's own `bb swarmforge/scripts/pipeline_stage_cli.bb
// <project-root> sync` (swarmforge/roles/coordinator.prompt) - a real
// production writer, never a fixture-only/dark store. Tolerant of a
// missing/corrupt file (no sync has ever run yet, or a torn write mid-
// rewrite) - an empty map degrades to "no active ticket known", never a
// crash or a fabricated location.
export function readTicketStageMap(targetPath: string): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(path.join(targetPath, SWARMFORGE_DIR, 'board', 'ticket-stage-map.json'), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

// Pure: inverts the authoritative {ticketId: role} map into the
// {role: ticketId[]} shape computePipelineBoard already expects
// (pipelineBoard.ts) - trivially one role per ticket id by construction
// (a plain object key can only ever hold one value), which is what
// structurally closes the double-row defect at its source; computePipeline
// Board's own dedup (BL-464) is the belt-and-braces guarantee for whatever
// reaches it regardless of the source.
export function invertTicketStageToRoleHeldTickets(stageMap: Record<string, string>): Record<string, string[]> {
  const byRole: Record<string, string[]> = {};
  for (const [ticketId, role] of Object.entries(stageMap)) {
    (byRole[role] ??= []).push(ticketId);
  }
  return byRole;
}

export function currentStageLabel(stages: PipelineStage[]): string {
  const active = stages.filter((s) => s.status === 'active');
  if (active.length === 0) {
    return 'idle';
  }
  return active.map((s) => s.displayName).join(', ');
}

function parseHandoffTask(content: string): string | null {
  const match = content.match(/^task:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function readHandoffFilesFromInbox(inboxPath: string): Array<{ task: string | null }> {
  const handoffs: Array<{ task: string | null }> = [];

  for (const subdir of INBOX_SUBDIRS) {
    const dir = path.join(inboxPath, subdir);
    if (!fs.existsSync(dir)) {
      continue;
    }

    try {
      for (const entry of fs.readdirSync(dir)) {
        if (entry.endsWith(HANDOFF_EXTENSION)) {
          const filePath = path.join(dir, entry);
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const task = parseHandoffTask(content);
            handoffs.push({ task });
          } catch {
            // ignore unreadable handoff files
          }
        } else {
          // Check batch directories
          const fullPath = path.join(dir, entry);
          if (fs.statSync(fullPath).isDirectory()) {
            try {
              for (const batchFile of fs.readdirSync(fullPath)) {
                if (batchFile.endsWith(HANDOFF_EXTENSION)) {
                  const filePath = path.join(fullPath, batchFile);
                  try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const task = parseHandoffTask(content);
                    handoffs.push({ task });
                  } catch {
                    // ignore unreadable handoff files
                  }
                }
              }
            } catch {
              // ignore unreadable batch directories
            }
          }
        }
      }
    } catch {
      // ignore unreadable inbox directories
    }
  }

  return handoffs;
}

export function findLiveHolder(targetPath: string, itemId: string): string | null {
  const stages = readPipelineStages(targetPath);
  const rolesFile = path.join(targetPath, SWARMFORGE_DIR, 'roles.tsv');
  if (!fs.existsSync(rolesFile)) {
    return null;
  }

  const tsv = fs.readFileSync(rolesFile, 'utf8');
  const roles = parseRolesTsv(tsv);

  // For each active stage, check if it has a handoff with the matching task
  for (const stage of stages) {
    if (stage.status !== 'active') {
      continue;
    }

    const role = roles.find((r) => r.role === stage.role);
    if (!role) {
      continue;
    }

    const inboxPath = path.join(role.worktreePath, SWARMFORGE_DIR, 'handoffs', 'inbox');
    const handoffs = readHandoffFilesFromInbox(inboxPath);

    for (const handoff of handoffs) {
      if (handoff.task && handoff.task.toLowerCase().startsWith(itemId.toLowerCase())) {
        return stage.role;
      }
    }
  }

  return null;
}
