import * as fs from 'fs';
import * as path from 'path';
import type { LivenessState } from '../watchdog/liveness';

export interface InboxChaserConfig {
  chaseIntervalSeconds: number;
  chaseTimeoutSeconds: number;
  maxChases: number;
  stuckInProcessTimeoutSeconds: number;
}

export type ChaserAction = 'chased' | 'respawned' | 'dead-lettered' | 'skipped';

export interface InboxItem {
  filePath: string;
  mtimeMs: number;
  chaseCount: number;
}

export function sidecarPath(handoffFilePath: string): string {
  return `${handoffFilePath}.chase.json`;
}

export function deadLetterPath(handoffFilePath: string): string {
  return `${handoffFilePath}.dead`;
}

export function readChaseCount(handoffFilePath: string): number {
  const sc = sidecarPath(handoffFilePath);
  try {
    const data = JSON.parse(fs.readFileSync(sc, 'utf-8'));
    return typeof data.chaseCount === 'number' ? data.chaseCount : 0;
  } catch {
    return 0;
  }
}

export function writeChaseCount(handoffFilePath: string, count: number): void {
  fs.writeFileSync(sidecarPath(handoffFilePath), JSON.stringify({ chaseCount: count }), 'utf-8');
}

export function scanInboxNew(inboxNewDir: string): InboxItem[] {
  if (!fs.existsSync(inboxNewDir)) {
    return [];
  }
  const items: InboxItem[] = [];
  for (const entry of fs.readdirSync(inboxNewDir)) {
    if (!entry.endsWith('.handoff')) {
      continue;
    }
    const filePath = path.join(inboxNewDir, entry);
    const stat = fs.statSync(filePath);
    items.push({
      filePath,
      mtimeMs: stat.mtimeMs,
      chaseCount: readChaseCount(filePath),
    });
  }
  return items;
}

export function decideItemAction(
  itemMtimeMs: number,
  chaseCount: number,
  nowMs: number,
  config: InboxChaserConfig,
  liveness: LivenessState
): ChaserAction {
  const ageSeconds = (nowMs - itemMtimeMs) / 1000;
  if (ageSeconds < config.chaseTimeoutSeconds) {
    return 'skipped';
  }
  if (chaseCount >= config.maxChases) {
    return 'dead-lettered';
  }
  if (liveness === 'dead' || liveness === 'unknown' || liveness === 'stuck') {
    return 'respawned';
  }
  return 'chased';
}

// ── in_process reconciler ──────────────────────────────────────────────────

export type StuckAction = 'nudge' | 'alert' | 'skipped';

export interface InProcessItem {
  filePath: string;
  mtimeMs: number;
  nudgeCount: number;
}

export function nudgePath(itemFilePath: string): string {
  return `${itemFilePath}.nudge`;
}

export function readNudgeCount(itemFilePath: string): number {
  try {
    const data = JSON.parse(fs.readFileSync(nudgePath(itemFilePath), 'utf-8'));
    return typeof data.nudgeCount === 'number' ? data.nudgeCount : 0;
  } catch {
    return 0;
  }
}

export function writeNudgeCount(itemFilePath: string, count: number): void {
  fs.writeFileSync(nudgePath(itemFilePath), JSON.stringify({ nudgeCount: count }), 'utf-8');
}

export function scanInProcess(inProcessDir: string): InProcessItem[] {
  if (!fs.existsSync(inProcessDir)) {
    return [];
  }
  const items: InProcessItem[] = [];

  function collectHandoffs(dir: string): void {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory() && entry.startsWith('batch_')) {
        collectHandoffs(full);
      } else if (entry.endsWith('.handoff')) {
        items.push({ filePath: full, mtimeMs: stat.mtimeMs, nudgeCount: readNudgeCount(full) });
      }
    }
  }

  collectHandoffs(inProcessDir);
  return items;
}

export function decideStuckAction(
  itemMtimeMs: number,
  nudgeCount: number,
  nowMs: number,
  config: InboxChaserConfig
): StuckAction {
  const ageSeconds = (nowMs - itemMtimeMs) / 1000;
  if (ageSeconds < config.stuckInProcessTimeoutSeconds) {
    return 'skipped';
  }
  return nudgeCount >= config.maxChases ? 'alert' : 'nudge';
}

export function isDoneButUndelivered(
  inProcessItems: InProcessItem[],
  latestCommitMs: number,
  lastSentMs: number,
  nowMs: number,
  config: InboxChaserConfig
): boolean {
  if (inProcessItems.length === 0) {
    return false;
  }
  if (latestCommitMs <= lastSentMs) {
    return false;
  }
  const ageSeconds = (nowMs - latestCommitMs) / 1000;
  return ageSeconds >= config.stuckInProcessTimeoutSeconds;
}

export interface ChaserAdapters {
  getLiveness: (role: string) => LivenessState;
  sendWakeUp: (role: string) => void;
  triggerRespawn: (role: string) => void;
  logDeadLetter: (role: string, filePath: string) => void;
}

export interface RoleInbox {
  role: string;
  inboxNewDir: string;
}

export function runSweep(
  roleInboxes: RoleInbox[],
  nowMs: number,
  config: InboxChaserConfig,
  adapters: ChaserAdapters
): void {
  for (const { role, inboxNewDir } of roleInboxes) {
    const items = scanInboxNew(inboxNewDir);
    const liveness = adapters.getLiveness(role);

    for (const item of items) {
      const action = decideItemAction(item.mtimeMs, item.chaseCount, nowMs, config, liveness);

      if (action === 'chased') {
        adapters.sendWakeUp(role);
        writeChaseCount(item.filePath, item.chaseCount + 1);
      } else if (action === 'respawned') {
        adapters.triggerRespawn(role);
      } else if (action === 'dead-lettered') {
        const dead = deadLetterPath(item.filePath);
        fs.renameSync(item.filePath, dead);
        const sc = sidecarPath(item.filePath);
        if (fs.existsSync(sc)) {
          fs.renameSync(sc, sidecarPath(dead));
        }
        adapters.logDeadLetter(role, item.filePath);
      }
      // 'skipped' → no-op
    }
  }
}
