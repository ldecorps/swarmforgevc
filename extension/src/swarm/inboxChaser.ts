import * as fs from 'fs';
import * as path from 'path';
import type { LivenessState } from '../watchdog/liveness';
import { isCoolingDown, shouldWakeOnExpiry } from './cooldownScheduler';

export interface InboxChaserConfig {
  chaseIntervalSeconds: number;
  chaseTimeoutSeconds: number;
  maxChases: number;
  stuckInProcessTimeoutSeconds: number;
  /** Minimum time (seconds) between two respawns of the same role, so a
   * repeated liveness misjudgment can never re-trigger respawn on every
   * sweep (BL-087). */
  respawnCooldownSeconds: number;
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

// BL-087: rate-limits respawns per role so a repeated misjudgment cannot
// loop. Stored one level up from inbox/new, sibling to inbox/in_process,
// since a respawn cooldown is a per-ROLE fact, not tied to any one item file.
export function respawnCooldownPath(inboxNewDir: string): string {
  return path.join(path.dirname(inboxNewDir), 'respawn-cooldown.json');
}

// The explicit 'utf-8' encoding argument on the read/write pair below is
// unkillable by mutation to '' for this JSON-of-a-number payload: Node's
// Buffer-to-string coercion (which JSON.parse and the writeFileSync string
// path both fall back to) already defaults to utf8, so both encodings
// produce byte-identical results here. Kept for explicitness, not
// testability.
export function readRespawnCooldownUntilMs(inboxNewDir: string): number | null {
  try {
    const data = JSON.parse(fs.readFileSync(respawnCooldownPath(inboxNewDir), 'utf-8'));
    return typeof data.untilMs === 'number' ? data.untilMs : null;
  } catch {
    return null;
  }
}

export function writeRespawnCooldownUntilMs(inboxNewDir: string, untilMs: number): void {
  fs.writeFileSync(respawnCooldownPath(inboxNewDir), JSON.stringify({ untilMs }), 'utf-8');
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

// BL-087: absence of heartbeat evidence must never, by itself, justify a
// respawn — the heartbeat file this reads from routinely does not exist, so
// liveness alone reported 'unknown' for every role and respawned it on the
// FIRST stale sweep, with no chase ever attempted first. Recent pane/outbox
// activity is positive proof of life and overrides liveness entirely; absent
// that, a role is chased across successive sweeps and only escalates to a
// respawn once chase attempts are exhausted (maxChases) AND liveness itself
// is not the explicit 'alive' state (which, like fresh activity, is treated
// as positive evidence and dead-letters instead of respawning).
function isUnresponsiveLiveness(liveness: LivenessState): boolean {
  return liveness === 'dead' || liveness === 'unknown' || liveness === 'stuck';
}

// Split out of decideItemAction (CRAP): the chase-exhausted decision once a
// role shows no recent activity - respawn only for a liveness reading that
// is itself evidence of unresponsiveness, dead-letter otherwise.
function decideStaleItemAction(chaseCount: number, config: InboxChaserConfig, liveness: LivenessState): ChaserAction {
  if (chaseCount < config.maxChases) {
    return 'chased';
  }
  return isUnresponsiveLiveness(liveness) ? 'respawned' : 'dead-lettered';
}

export function decideItemAction(
  itemMtimeMs: number,
  chaseCount: number,
  nowMs: number,
  config: InboxChaserConfig,
  liveness: LivenessState,
  lastActivityMs: number
): ChaserAction {
  const ageSeconds = (nowMs - itemMtimeMs) / 1000;
  if (ageSeconds < config.chaseTimeoutSeconds) {
    return 'skipped';
  }

  const idleSeconds = (nowMs - lastActivityMs) / 1000;
  const hasRecentActivity = idleSeconds < config.stuckInProcessTimeoutSeconds;

  if (hasRecentActivity) {
    return chaseCount >= config.maxChases ? 'dead-lettered' : 'chased';
  }

  return decideStaleItemAction(chaseCount, config, liveness);
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
  lastActivityMs: number,
  nudgeCount: number,
  nowMs: number,
  config: InboxChaserConfig
): StuckAction {
  // Stuck is judged by AGENT INACTIVITY while holding work, not by how long
  // the item has been held: an agent legitimately working a parcel for hours
  // shows pane/outbox activity and must never be chased (BL-067).
  const idleSeconds = (nowMs - lastActivityMs) / 1000;
  if (idleSeconds < config.stuckInProcessTimeoutSeconds) {
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
  /** Timestamp of the role's last observed activity (pane output changing,
   * outbox writes). Drives the in_process stuck decision (BL-067). */
  getLastActivityMs: (role: string) => number;
  /** Surfaces (or clears) the visible needs-human escalation for a role whose
   * chases were exhausted without recovery. */
  onStuckEscalation: (role: string, escalated: boolean) => void;
  /** Absolute epoch ms until which the role is cooling down (token exhaustion
   * reset time), or null/undefined when the role has no active cooldown
   * (BL-082). Optional so callers without cooldown scheduling are unaffected. */
  getCooldownUntilMs?: (role: string) => number | null | undefined;
  /** Epoch ms of the cooldown window this role was last woken for, or
   * null/undefined if no wake has been recorded yet (BL-082). */
  getCooldownWokenMarker?: (role: string) => number | null | undefined;
  /** Records that a wake was sent for this cooldown expiry, so the next
   * sweep does not re-wake for the same window (BL-082). */
  onCooldownExpired?: (role: string, cooldownUntilMs: number) => void;
}

export interface RoleInbox {
  role: string;
  inboxNewDir: string;
  inProcessDir: string;
}

// A role that HOLDS in_process work (single task file or batch directory)
// while showing no activity gets chased; after maxChases without recovery it
// escalates visibly instead of being chased forever (BL-067).
function applyStuckNudge(role: string, held: InProcessItem[], adapters: ChaserAdapters): void {
  adapters.sendWakeUp(role);
  for (const item of held) {
    writeNudgeCount(item.filePath, item.nudgeCount + 1);
  }
  adapters.onStuckEscalation(role, false);
}

function clearStaleNudgeCounts(held: InProcessItem[]): void {
  for (const item of held) {
    if (item.nudgeCount > 0) {
      writeNudgeCount(item.filePath, 0);
    }
  }
}

function sweepInProcess(
  role: string,
  inProcessDir: string,
  nowMs: number,
  config: InboxChaserConfig,
  adapters: ChaserAdapters
): void {
  const held = scanInProcess(inProcessDir);
  if (held.length === 0) {
    adapters.onStuckEscalation(role, false);
    return;
  }

  const nudgeCount = Math.max(...held.map((item) => item.nudgeCount));
  const action = decideStuckAction(adapters.getLastActivityMs(role), nudgeCount, nowMs, config);

  if (action === 'nudge') {
    applyStuckNudge(role, held, adapters);
  } else if (action === 'alert') {
    adapters.onStuckEscalation(role, true);
  } else {
    // active again: clear stale counts so a future stall re-chases from zero
    clearStaleNudgeCounts(held);
    adapters.onStuckEscalation(role, false);
  }
}

function maybeWakeOnCooldownExpiry(
  role: string,
  cooldownUntilMs: number | null,
  nowMs: number,
  adapters: ChaserAdapters
): void {
  if (cooldownUntilMs == null) {
    return;
  }
  if (!shouldWakeOnExpiry(cooldownUntilMs, nowMs, adapters.getCooldownWokenMarker?.(role) ?? null)) {
    return;
  }
  adapters.sendWakeUp(role);
  adapters.onCooldownExpired?.(role, cooldownUntilMs);
}

function applyInboxItemAction(
  role: string,
  item: InboxItem,
  action: ChaserAction,
  adapters: ChaserAdapters
): void {
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

function sweepRoleInbox(
  role: string,
  inboxNewDir: string,
  nowMs: number,
  config: InboxChaserConfig,
  adapters: ChaserAdapters
): void {
  const items = scanInboxNew(inboxNewDir);
  const liveness = adapters.getLiveness(role);
  const lastActivityMs = adapters.getLastActivityMs(role);
  const respawnCooldownUntilMs = readRespawnCooldownUntilMs(inboxNewDir);

  for (const item of items) {
    let action = decideItemAction(item.mtimeMs, item.chaseCount, nowMs, config, liveness, lastActivityMs);
    // BL-087: a respawn decision made while still cooling down from the
    // last respawn of this role is downgraded to a chase instead - never
    // silently dropped, so a genuinely still-unresponsive role keeps
    // getting wake-up attempts rather than going quiet.
    if (action === 'respawned' && isCoolingDown(respawnCooldownUntilMs, nowMs)) {
      action = 'chased';
    }
    applyInboxItemAction(role, item, action, adapters);
    if (action === 'respawned') {
      writeRespawnCooldownUntilMs(inboxNewDir, nowMs + config.respawnCooldownSeconds * 1000);
    }
  }
}

export function runSweep(
  roleInboxes: RoleInbox[],
  nowMs: number,
  config: InboxChaserConfig,
  adapters: ChaserAdapters
): void {
  for (const { role, inboxNewDir, inProcessDir } of roleInboxes) {
    const cooldownUntilMs = adapters.getCooldownUntilMs?.(role) ?? null;

    // While cooling down, suppress all wake/chase/respawn/nudge activity for
    // this role only; other roles in the same pass proceed normally (BL-082).
    if (isCoolingDown(cooldownUntilMs, nowMs)) {
      continue;
    }

    maybeWakeOnCooldownExpiry(role, cooldownUntilMs, nowMs, adapters);
    sweepInProcess(role, inProcessDir, nowMs, config, adapters);
    sweepRoleInbox(role, inboxNewDir, nowMs, config, adapters);
  }
}
