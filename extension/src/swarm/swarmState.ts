import * as fs from 'fs';
import * as path from 'path';

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
    const role = parts[0];
    const worktreePath = parts[2];
    const displayName = parts[4];
    if (role && worktreePath && displayName) {
      entries.push({ role, worktreePath, displayName });
    }
  }
  return entries;
}

export function readHandoffInboxStatus(worktreePath: string): 'active' | 'idle' {
  const inboxBase = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox');

  for (const subdir of ['new', 'in_process']) {
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
      if (entry.endsWith('.handoff')) {
        return true;
      }
      const fullPath = path.join(dir, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        if (fs.readdirSync(fullPath).some((f) => f.endsWith('.handoff'))) {
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
  const rolesFile = path.join(targetPath, '.swarmforge', 'roles.tsv');
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
