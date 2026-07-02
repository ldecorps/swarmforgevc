import * as path from 'path';
import * as fs from 'fs';
import type { InboxChaserConfig, RoleInbox, ChaserAdapters } from '../swarm/inboxChaser';
import { runSweep } from '../swarm/inboxChaser';
import { parseRolesTsv } from '../swarm/swarmState';
import type { LivenessState } from './liveness';

export interface ChaserMonitorConfig extends InboxChaserConfig {
  targetPath: string;
  rolesList: string[]; // ['specifier', 'coder', 'cleaner', ...]
}

export interface ChaserCallbacks {
  sendWakeUp: (role: string) => void;
  triggerRespawn: (role: string) => void;
  logDeadLetter: (role: string, filePath: string) => void;
  getLiveness: (role: string) => LivenessState;
  getLastActivityMs: (role: string) => number;
  onStuckEscalation: (role: string, escalated: boolean) => void;
}

// Handoff inboxes live per WORKTREE (from roles.tsv), not under a per-role
// <target>/.swarmforge/handoffs/<role>/ layout — the monitor previously built
// the latter, which does not exist, so the live sweep scanned empty paths and
// never chased anything (BL-067 root cause 2).
export function buildRoleInboxes(targetPath: string, rolesList: string[]): RoleInbox[] {
  const rolesFile = path.join(targetPath, '.swarmforge', 'roles.tsv');
  let entries;
  try {
    entries = parseRolesTsv(fs.readFileSync(rolesFile, 'utf8'));
  } catch {
    return [];
  }
  return entries
    .filter((entry) => rolesList.includes(entry.role))
    .map((entry) => {
      const inbox = path.join(entry.worktreePath, '.swarmforge', 'handoffs', 'inbox');
      return {
        role: entry.role,
        inboxNewDir: path.join(inbox, 'new'),
        inProcessDir: path.join(inbox, 'in_process'),
      };
    });
}

export function startChaserMonitor(
  config: ChaserMonitorConfig,
  callbacks: ChaserCallbacks
): NodeJS.Timeout | null {
  const swarmforgeDir = path.join(config.targetPath, '.swarmforge');
  if (!fs.existsSync(swarmforgeDir)) {
    return null;
  }

  const adapters: ChaserAdapters = {
    getLiveness: callbacks.getLiveness,
    sendWakeUp: callbacks.sendWakeUp,
    triggerRespawn: callbacks.triggerRespawn,
    logDeadLetter: callbacks.logDeadLetter,
    getLastActivityMs: callbacks.getLastActivityMs,
    onStuckEscalation: callbacks.onStuckEscalation,
  };

  const roleInboxes: RoleInbox[] = buildRoleInboxes(config.targetPath, config.rolesList);

  // Start periodic sweep
  const intervalId = setInterval(() => {
    const nowMs = Date.now();
    runSweep(roleInboxes, nowMs, config, adapters);
  }, config.chaseIntervalSeconds * 1000);

  return intervalId;
}

export function stopChaserMonitor(intervalId: NodeJS.Timeout | null): void {
  if (intervalId) {
    clearInterval(intervalId);
  }
}
