import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';
import { BounceType, isBounceType, handleFileWatchEvent } from './bounceWatcher';

// BL-069: graceful bounce. Before the existing verified bounce (BL-058) kills
// panes, the swarm enters a DRAIN mode: agents finish their current
// in_process work through its normal handoff (swarmforge/scripts/
// handoff_lib.bb's draining? gate refuses only NEW inbox items), and the
// extension host waits until every role is simultaneously idle before
// running the real bounce. The drain state is a durable on-disk sentinel
// (not in-memory) so it survives an extension reload while draining.
export interface BounceDrainState {
  bounceType: BounceType;
  startedAt: string;
  timeoutSeconds: number;
}

const SENTINEL_RELATIVE_PATH = ['.swarmforge', 'bounce-drain.json'];
const GRACEFUL_TRIGGER_FILENAME = 'bounce-graceful';

export function drainSentinelPath(targetPath: string): string {
  return path.join(targetPath, ...SENTINEL_RELATIVE_PATH);
}

export function readBounceDrainState(targetPath: string): BounceDrainState | null {
  try {
    const raw = fs.readFileSync(drainSentinelPath(targetPath), 'utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      isBounceType(parsed.bounceType) &&
      typeof parsed.startedAt === 'string' &&
      typeof parsed.timeoutSeconds === 'number'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// Write bounce drain state atomically (via temp+rename) so a reader never
// observes a partially-written file.
export function writeBounceDrainState(targetPath: string, state: BounceDrainState): void {
  atomicWrite(drainSentinelPath(targetPath), JSON.stringify(state, null, 2));
}

export function clearBounceDrainState(targetPath: string): void {
  const target = drainSentinelPath(targetPath);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
}

export function startBounceDrain(
  targetPath: string,
  bounceType: BounceType,
  timeoutSeconds: number,
  nowIso: string = new Date().toISOString()
): void {
  writeBounceDrainState(targetPath, { bounceType, startedAt: nowIso, timeoutSeconds });
}

// ── all-idle decision (pure) ─────────────────────────────────────────────

export interface RoleDrainStatus {
  role: string;
  hasInProcessWork: boolean;
  idle: boolean;
}

export type DrainDecision = 'wait' | 'bounce' | 'timeout';

export function decideDrainAction(
  roles: RoleDrainStatus[],
  startedAtMs: number,
  nowMs: number,
  timeoutSeconds: number
): DrainDecision {
  const allDrained = roles.every((r) => !r.hasInProcessWork && r.idle);
  if (allDrained) {
    return 'bounce';
  }
  const elapsedSeconds = (nowMs - startedAtMs) / 1000;
  if (elapsedSeconds >= timeoutSeconds) {
    return 'timeout';
  }
  return 'wait';
}

// ── periodic watcher ──────────────────────────────────────────────────────

export interface BounceDrainAdapters {
  getRoleStatuses: () => RoleDrainStatus[];
  onBounce: (bounceType: BounceType) => void;
  onTimeout: (bounceType: BounceType, busyRoles: string[]) => void;
}

export interface BounceDrainMonitorConfig {
  targetPath: string;
  pollIntervalSeconds: number;
}

export function startBounceDrainWatcher(
  config: BounceDrainMonitorConfig,
  adapters: BounceDrainAdapters,
  scheduleTick: (fn: () => void, ms: number) => NodeJS.Timeout = setInterval,
  getNowMs: () => number = Date.now
): NodeJS.Timeout {
  // Prompt the human once per drain session, not once per poll: the sentinel
  // itself only carries the state a role script needs, not UI state. `bounced`
  // guards the same way: the caller (extension.ts) stops this watcher and
  // clears the sentinel synchronously inside onBounce, so in practice a
  // second tick never reaches here — but that is an implicit contract with
  // the one current caller, not something this primitive enforces on its
  // own, so it is guarded directly rather than relying on it.
  let timeoutPrompted = false;
  let bounced = false;
  const intervalId = scheduleTick(() => {
    const state = readBounceDrainState(config.targetPath);
    if (!state) {
      timeoutPrompted = false;
      bounced = false;
      return;
    }
    const startedAtMs = Date.parse(state.startedAt);
    const roles = adapters.getRoleStatuses();
    const decision = decideDrainAction(roles, startedAtMs, getNowMs(), state.timeoutSeconds);
    if (decision === 'bounce' && !bounced) {
      bounced = true;
      adapters.onBounce(state.bounceType);
    } else if (decision === 'timeout' && !timeoutPrompted) {
      timeoutPrompted = true;
      const busyRoles = roles.filter((r) => r.hasInProcessWork || !r.idle).map((r) => r.role);
      adapters.onTimeout(state.bounceType, busyRoles);
    }
  }, config.pollIntervalSeconds * 1000);
  return intervalId;
}

export function stopBounceDrainWatcher(
  intervalId: NodeJS.Timeout | null,
  clearTick: (handle: NodeJS.Timeout) => void = clearInterval
): void {
  if (intervalId) {
    clearTick(intervalId);
  }
}

// ── remote sentinel variant ("plus a variant of the existing remote-bounce
// sentinel", BL-069) — mirrors bounceWatcher.ts's own fs.watch pattern for a
// second, distinct trigger file so the immediate-bounce path is untouched.
// BL-131: pulled out of the fs.watch callback so tests can drive it directly
// with an injected scheduleTick instead of writing real files and waiting on
// real fs.watch timing (mirrors bounceWatcher.ts's handleWatchEvent split).
export function handleGracefulWatchEvent(
  filename: string | null,
  triggerFilePath: string,
  onGracefulBounce: (bounceType: BounceType) => void,
  onError: ((error: string) => void) | undefined,
  scheduleTick: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); },
): void {
  handleFileWatchEvent(filename, GRACEFUL_TRIGGER_FILENAME, triggerFilePath, onGracefulBounce, onError, scheduleTick);
}

export function startGracefulBounceFileWatcher(
  targetPath: string,
  onGracefulBounce: (bounceType: BounceType) => void,
  onError?: (error: string) => void,
  scheduleTick: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); },
): fs.FSWatcher | null {
  const swarmforgeDir = path.join(targetPath, '.swarmforge');
  const triggerFilePath = path.join(swarmforgeDir, GRACEFUL_TRIGGER_FILENAME);

  if (!fs.existsSync(swarmforgeDir)) {
    return null;
  }

  const watcher = fs.watch(swarmforgeDir, (_eventType, filename) => {
    handleGracefulWatchEvent(filename, triggerFilePath, onGracefulBounce, onError, scheduleTick);
  });

  return watcher;
}
