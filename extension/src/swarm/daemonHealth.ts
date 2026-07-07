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
