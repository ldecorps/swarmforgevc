import * as fs from 'fs';
import * as path from 'path';

const SWARMFORGE_DIR = '.swarmforge';
const HANDOFF_EXTENSION = '.handoff';
const INBOX_SUBDIRS = ['new', 'in_process'];
const TSV_ROLE_INDEX = 0;
const TSV_WORKTREE_INDEX = 2;
const TSV_DISPLAY_NAME_INDEX = 4;

export interface RoleEntry {
  role: string;
  worktreePath: string;
  displayName: string;
}

export interface PipelineStage {
  role: string;
  displayName: string;
  status: 'active' | 'idle';
}

export function parseRolesTsv(tsv: string): RoleEntry[] {
  const entries: RoleEntry[] = [];
  for (const line of tsv.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split('\t');
    const role = parts[TSV_ROLE_INDEX];
    const worktreePath = parts[TSV_WORKTREE_INDEX];
    const displayName = parts[TSV_DISPLAY_NAME_INDEX];
    if (role && worktreePath && displayName) {
      entries.push({ role, worktreePath, displayName });
    }
  }
  return entries;
}

export function readHandoffInboxStatus(worktreePath: string): 'active' | 'idle' {
  const inboxBase = path.join(worktreePath, SWARMFORGE_DIR, 'handoffs', 'inbox');

  for (const subdir of INBOX_SUBDIRS) {
    const dir = path.join(inboxBase, subdir);
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

export function readPipelineStages(targetPath: string): PipelineStage[] {
  const rolesFile = path.join(targetPath, SWARMFORGE_DIR, 'roles.tsv');
  if (!fs.existsSync(rolesFile)) {
    return [];
  }

  const tsv = fs.readFileSync(rolesFile, 'utf8');
  return parseRolesTsv(tsv).map((entry) => ({
    role: entry.role,
    displayName: entry.displayName,
    status: readHandoffInboxStatus(entry.worktreePath),
  }));
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
