import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';

/**
 * BL-110: the extension is not yet stable, and when it goes down (close,
 * crash, reload, host kill) there is today no durable record of what it
 * knew - recovery and debugging start blind. Because an abrupt host kill
 * runs no shutdown code (BL-108), this must be a periodically-updated
 * durable snapshot, not only a written-at-exit artifact.
 */

export interface ExtensionStateSnapshot {
  timestamp: string;
  target: string | undefined;
  attachState: string;
  launchState: string;
  swarmInfo: unknown;
  reason: string | null;
}

const DUMPS_SUBDIR = 'dumps';
const CURRENT_FILE = 'extension-state.json';
const PREVIOUS_FILE = 'extension-state.previous.json';

function dumpsDir(swarmforgeDir: string): string {
  return path.join(swarmforgeDir, DUMPS_SUBDIR);
}

function currentFile(swarmforgeDir: string): string {
  return path.join(dumpsDir(swarmforgeDir), CURRENT_FILE);
}

function previousFile(swarmforgeDir: string): string {
  return path.join(dumpsDir(swarmforgeDir), PREVIOUS_FILE);
}

function readJson(filePath: string): ExtensionStateSnapshot | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

export function readStateDump(swarmforgeDir: string): ExtensionStateSnapshot | undefined {
  return readJson(currentFile(swarmforgeDir));
}

export function readPreviousStateDump(swarmforgeDir: string): ExtensionStateSnapshot | undefined {
  return readJson(previousFile(swarmforgeDir));
}

/**
 * state-dump-01/04: writes the new snapshot as current, first rotating
 * whatever was current into the previous slot so a dump is never clobbered
 * without at least the prior one surviving. Best-effort: a write failure
 * (e.g. an unwritable path) is swallowed, never thrown - dump writing must
 * never block or delay shutdown.
 */
export function writeStateDump(swarmforgeDir: string, snapshot: ExtensionStateSnapshot): void {
  try {
    const current = currentFile(swarmforgeDir);
    if (fs.existsSync(current)) {
      fs.mkdirSync(dumpsDir(swarmforgeDir), { recursive: true });
      fs.copyFileSync(current, previousFile(swarmforgeDir));
    }
    atomicWrite(current, JSON.stringify(snapshot, null, 2));
  } catch {
    // best-effort: never let dump writing block or fail shutdown/activation
  }
}

/**
 * state-dump-02: a periodically-updated snapshot survives an abrupt host
 * kill that never runs deactivate(). scheduleTick/clearTick are injected so
 * this is testable without a real timer (per the no-real-timers-in-tests
 * rule) - production callers pass setInterval/clearInterval.
 */
export function startPeriodicStateDump<H>(
  swarmforgeDir: string,
  getSnapshot: () => ExtensionStateSnapshot,
  intervalMs: number,
  scheduleTick: (fn: () => void, ms: number) => H,
  clearTick: (handle: H) => void
): () => void {
  const handle = scheduleTick(() => writeStateDump(swarmforgeDir, getSnapshot()), intervalMs);
  return () => clearTick(handle);
}
