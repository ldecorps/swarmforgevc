import * as fs from 'fs';
import * as path from 'path';

/**
 * Transport health, read from the status file the handoffd supervisor
 * maintains under .swarmforge/daemon/ (BL-061). The extension is a view
 * only: it renders this state and never manages the daemon process.
 */
export interface DaemonHealth {
  state: 'healthy' | 'restarting' | 'persistent-failure' | 'halted' | 'unknown';
  detail?: string;
}

export type DaemonProcessPhase =
  | 'skipped'
  | 'halted'
  | 'dead'
  | 'starting'
  | 'polling'
  | 'up'
  | 'stale';

export interface DaemonProcessStatus {
  phase: DaemonProcessPhase;
  label: string;
  detail?: string;
  pid?: number;
  heartbeatAgeMs?: number;
}

/** Heartbeat younger than this is shown as actively polling. */
export const DAEMON_HEARTBEAT_POLLING_MS = 15_000;

/** Matches handoffd_supervisor.bb default SUPERVISOR_STALL_MS. */
export const DAEMON_HEARTBEAT_STALL_MS = 30_000;

export interface DaemonProcessProbe {
  isPidAlive?: (pid: number) => boolean;
  heartbeatAgeMs?: number | null;
}

// 'halted' (BL-144): the daemon died and the supervisor alarmed + hard-
// stopped the swarm instead of restarting it - a terminal state until a
// human intervenes, distinct from the (now unused) transient restart states.
const KNOWN_STATES = new Set(['healthy', 'restarting', 'persistent-failure', 'halted']);

function readDaemonPid(targetPath: string): number | null {
  const pidFile = path.join(targetPath, '.swarmforge', 'daemon', 'handoffd.pid');
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function shouldSkipHandoffDaemon(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['SWARMFORGE_SKIP_DAEMON'] === '1' || env['SWARMFORGE_MAILBOX_ONLY'] === '1';
}

/** True when handoffd is expected and its tracked pid is alive and not halted. */
export function isDaemonReady(targetPath: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (shouldSkipHandoffDaemon(env)) {
    return true;
  }

  const health = readDaemonHealth(targetPath);
  if (health.state === 'halted') {
    return false;
  }

  const pid = readDaemonPid(targetPath);
  return pid !== null && isPidAlive(pid);
}

function readHeartbeatAgeMs(targetPath: string, nowMs: number): number | null {
  const heartbeatFile = path.join(targetPath, '.swarmforge', 'daemon', 'handoffd.heartbeat');
  try {
    const mtimeMs = fs.statSync(heartbeatFile).mtimeMs;
    return Math.max(0, nowMs - mtimeMs);
  } catch {
    return null;
  }
}

function labelForPhase(phase: DaemonProcessPhase, detail?: string): string {
  switch (phase) {
    case 'skipped':
      return 'handoffd off (sync inject)';
    case 'halted':
      return detail ? `handoffd HALTED (${detail})` : 'handoffd HALTED';
    case 'dead':
      return 'handoffd dead';
    case 'starting':
      return 'handoffd starting…';
    case 'polling':
      return 'handoffd polling';
    case 'stale':
      return 'handoffd stale';
    case 'up':
      return 'handoffd up';
    default:
      return 'handoffd unknown';
  }
}

/**
 * Process-level handoffd status for the panel header. Distinct from
 * transportHealth's delivery-level view (dead letters, canary misses).
 */
export function computeDaemonProcessStatus(
  targetPath: string,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
  probe: DaemonProcessProbe = {}
): DaemonProcessStatus {
  if (shouldSkipHandoffDaemon(env)) {
    return { phase: 'skipped', label: labelForPhase('skipped') };
  }

  const health = readDaemonHealth(targetPath);
  if (health.state === 'halted') {
    return {
      phase: 'halted',
      label: labelForPhase('halted', health.detail),
      detail: health.detail,
    };
  }

  const pid = readDaemonPid(targetPath);
  const alive = pid !== null && (probe.isPidAlive ?? isPidAlive)(pid);
  if (!alive) {
    return { phase: 'dead', label: labelForPhase('dead'), pid: pid ?? undefined };
  }

  const heartbeatAgeMs =
    probe.heartbeatAgeMs !== undefined
      ? probe.heartbeatAgeMs
      : readHeartbeatAgeMs(targetPath, nowMs);

  if (health.state === 'unknown' || heartbeatAgeMs === null) {
    return {
      phase: 'starting',
      label: labelForPhase('starting'),
      pid,
      heartbeatAgeMs: heartbeatAgeMs ?? undefined,
    };
  }

  if (health.state === 'restarting' || health.state === 'persistent-failure') {
    return {
      phase: 'stale',
      label: labelForPhase('stale'),
      pid,
      heartbeatAgeMs,
      detail: health.detail ?? health.state,
    };
  }

  if (heartbeatAgeMs <= DAEMON_HEARTBEAT_POLLING_MS) {
    return {
      phase: 'polling',
      label: labelForPhase('polling'),
      pid,
      heartbeatAgeMs,
    };
  }

  if (heartbeatAgeMs <= DAEMON_HEARTBEAT_STALL_MS) {
    return {
      phase: 'up',
      label: labelForPhase('up'),
      pid,
      heartbeatAgeMs,
    };
  }

  return {
    phase: 'stale',
    label: labelForPhase('stale'),
    pid,
    heartbeatAgeMs,
    detail: health.detail,
  };
}

export function readDaemonHealth(targetPath: string): DaemonHealth {
  const statusFile = path.join(
    targetPath,
    '.swarmforge',
    'daemon',
    'handoffd.status.json'
  );
  try {
    const raw = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    if (!KNOWN_STATES.has(raw.state)) {
      return { state: 'unknown' };
    }
    const health: DaemonHealth = { state: raw.state };
    if (raw.state !== 'healthy' && raw.last_incident?.reason) {
      health.detail = String(raw.last_incident.reason);
    }
    return health;
  } catch {
    // No supervisor (older swarm) or unreadable state: show nothing rather
    // than a false alarm.
    return { state: 'unknown' };
  }
}
