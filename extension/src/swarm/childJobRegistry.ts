import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';

/**
 * BL-108: a normal "stop the extension" must never leak a spawned process
 * tree. Node's child_process does not kill descendants when the parent
 * dies, and VS Code's "Stop Extension Host" can SIGKILL the host without
 * ever running deactivate() - so a long-running job spawned without
 * process-group ownership and a durable registry entry can reparent to
 * launchd (PPID 1) and run forever (observed: a Stryker root that kept
 * respawning sandbox workers for over a day).
 */

export interface ChildJobEntry {
  pgid: number;
  worktree: string;
  kind: string;
  started_at: string;
  owner_host_pid: number;
}

function registryFile(swarmforgeDir: string): string {
  return path.join(swarmforgeDir, 'child-jobs.json');
}

/** Absent or corrupt registry reads as empty - never throws, never blocks a caller. */
export function readTrackedJobs(swarmforgeDir: string): ChildJobEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(registryFile(swarmforgeDir), 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function writeTrackedJobs(swarmforgeDir: string, entries: ChildJobEntry[]): void {
  atomicWrite(registryFile(swarmforgeDir), JSON.stringify(entries, null, 2));
}

export function recordTrackedJob(swarmforgeDir: string, entry: ChildJobEntry): void {
  const entries = readTrackedJobs(swarmforgeDir).filter((e) => e.pgid !== entry.pgid);
  entries.push(entry);
  writeTrackedJobs(swarmforgeDir, entries);
}

export function removeTrackedJob(swarmforgeDir: string, pgid: number): void {
  const entries = readTrackedJobs(swarmforgeDir).filter((e) => e.pgid !== pgid);
  writeTrackedJobs(swarmforgeDir, entries);
}

// The minimal shape spawnTrackedJob needs for its own bookkeeping. spawnFn's
// concrete return type (e.g. Node's real ChildProcess) is preserved via the
// generic below so callers keep full access to stdout/stderr/other events.
export interface SpawnedChild {
  pid?: number;
  on(event: 'exit', listener: () => void): unknown;
}

export interface SpawnTrackedJobOptions {
  worktree: string;
  kind: string;
  ownerHostPid: number;
}

/**
 * Spawn-registry-01: wraps an already-detached spawn (spawnFn must pass
 * `detached: true` so `child.pid` is the new process GROUP's leader, i.e.
 * its pgid) with a durable registry entry, removed automatically on a
 * clean exit. spawnFn is injected so this is testable without a real child
 * process.
 */
export function spawnTrackedJob<T extends SpawnedChild>(
  swarmforgeDir: string,
  spawnFn: () => T,
  options: SpawnTrackedJobOptions
): T {
  const child = spawnFn();
  if (typeof child.pid !== 'number') {
    return child;
  }
  const pgid = child.pid;
  recordTrackedJob(swarmforgeDir, {
    pgid,
    worktree: options.worktree,
    kind: options.kind,
    started_at: new Date().toISOString(),
    owner_host_pid: options.ownerHostPid,
  });
  child.on('exit', () => removeTrackedJob(swarmforgeDir, pgid));
  return child;
}

export type KillGroupFn = (pgid: number, signal: NodeJS.Signals) => void;

/**
 * deactivate-reap-02: signal every tracked group to terminate (SIGTERM,
 * escalating to SIGKILL after graceMs) and leave the registry empty. Best
 * effort per entry - one failing kill (already-dead group) must not stop
 * the rest from being reaped.
 */
export function reapAllTrackedJobs(
  swarmforgeDir: string,
  killGroup: KillGroupFn,
  graceMs: number,
  scheduleEscalation: (fn: () => void, ms: number) => void = setTimeout
): void {
  const entries = readTrackedJobs(swarmforgeDir);
  for (const entry of entries) {
    try {
      killGroup(entry.pgid, 'SIGTERM');
    } catch {
      // already gone; nothing to escalate
      continue;
    }
    scheduleEscalation(() => {
      try {
        killGroup(entry.pgid, 'SIGKILL');
      } catch {
        // already reaped by SIGTERM
      }
    }, graceMs);
  }
  writeTrackedJobs(swarmforgeDir, []);
}

/**
 * startup-reaper-03: a host killed without deactivate() leaves stale
 * registry entries whose owner_host_pid is gone. Terminate those groups
 * and drop only those entries - a still-live owner's tracked job is left
 * running untouched.
 */
export function reapStaleTrackedJobs(
  swarmforgeDir: string,
  isHostPidAlive: (pid: number) => boolean,
  killGroup: KillGroupFn
): void {
  const entries = readTrackedJobs(swarmforgeDir);
  const survivors: ChildJobEntry[] = [];
  for (const entry of entries) {
    if (isHostPidAlive(entry.owner_host_pid)) {
      survivors.push(entry);
      continue;
    }
    try {
      killGroup(entry.pgid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  writeTrackedJobs(swarmforgeDir, survivors);
}
