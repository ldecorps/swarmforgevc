import * as path from 'path';
import * as fs from 'fs';
import type { InboxChaserConfig, RoleInbox } from '../swarm/inboxChaser';
import { scanInProcess } from '../swarm/inboxChaser';
import { recoverDeadLetters, appendRecoveryLog } from '../swarm/handoffRecovery';
import { parseRolesTsv } from '../swarm/swarmState';
import type { LivenessState } from './liveness';

export interface ChaserMonitorConfig extends InboxChaserConfig {
  targetPath: string;
  rolesList: string[]; // ['specifier', 'coder', 'cleaner', ...]
  /** BL-122: bounded retries before a dead letter escalates to needs-human
   * instead of being redelivered forever. */
  maxRecoveryAttempts: number;
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

  const roleInboxes: RoleInbox[] = buildRoleInboxes(config.targetPath, config.rolesList);

  // BL-122: the recovery owner is this SAME extension-host timer, not any
  // one pipeline agent — an agent process exiting can tear the swarm down
  // around it (BL-107), but this watchdog is already the supervised owner
  // of the chase/respawn seams recovery builds on.
  //
  // BL-146: the chase/nudge sweep itself (runSweep) moved into handoffd.bb -
  // the single daemon process that now owns both delivery and liveness, so
  // the extension host must never also run it (two processes independently
  // chasing/respawning the same inbox would race each other, double-chase,
  // and corrupt the shared .chase.json/.nudge sidecars). This interval is
  // now solely the dead-letter recovery sweep, still TS-owned pending its
  // own port to a follow-up ticket.
  const runRecoverySweep = (): void => {
    recoverDeadLetters(roleInboxes, { maxRecoveryAttempts: config.maxRecoveryAttempts }, {
      isRecipientBusy: (role) => {
        const inbox = roleInboxes.find((r) => r.role === role);
        return inbox ? scanInProcess(inbox.inProcessDir).length > 0 : false;
      },
      sendWakeUp: callbacks.sendWakeUp,
      logRemediation: (outcome) => appendRecoveryLog(config.targetPath, outcome),
      setNeedsHuman: callbacks.onStuckEscalation,
    });
  };

  const intervalId = setInterval(() => {
    runRecoverySweep();
  }, config.chaseIntervalSeconds * 1000);

  return intervalId;
}

export function stopChaserMonitor(intervalId: NodeJS.Timeout | null): void {
  if (intervalId) {
    clearInterval(intervalId);
  }
}
