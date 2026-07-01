import * as path from 'path';
import * as fs from 'fs';
import type { InboxChaserConfig, RoleInbox, ChaserAdapters } from '../swarm/inboxChaser';
import { runSweep } from '../swarm/inboxChaser';
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
  };

  // Build role inboxes list
  const roleInboxes: RoleInbox[] = config.rolesList.map((role) => ({
    role,
    inboxNewDir: path.join(swarmforgeDir, 'handoffs', role, 'inbox', 'new'),
  }));

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
