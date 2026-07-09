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
