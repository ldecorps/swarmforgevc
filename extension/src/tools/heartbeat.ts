import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';

export interface HeartbeatData {
  role: string;
  pid: number;
  last_beat: string;
  last_tool: string;
  phase: 'entry' | 'exit';
  in_flight: boolean;
  beat_count: number;
  task?: string;
}

/**
 * Write a heartbeat YAML file for the given role in the specified directory.
 *
 * The file name is `${role}.yaml` and the content is a simple key/value YAML
 * mapping compatible with parseYamlLine() below.
 */
export function writeHeartbeat(dir: string, data: HeartbeatData): void {
  let yaml = `role: ${data.role}
pid: ${data.pid}
last_beat: "${data.last_beat}"
last_tool: ${data.last_tool}
phase: ${data.phase}
in_flight: ${data.in_flight}
beat_count: ${data.beat_count}
`;
  if (data.task) {
    yaml += `task: ${data.task}\n`;
  }
  const filePath = path.join(dir, `${data.role}.yaml`);
  atomicWrite(filePath, yaml);
}

/**
 * Parse a single "key: value" YAML line into a [key, value] pair.
 *
 * Supported types:
 * - strings (optionally quoted with double quotes)
 * - booleans ("true"/"false")
 * - integers (sequence of digits)
 *
 * Lines that do not match the expected "key: value" format are ignored.
 */
function parseYamlLine(line: string): [string, unknown] | null {
  const m = line.match(/^(\w+):\s*(.+)$/);
  if (!m) return null;
  const key = m[1];
  let val: string | boolean | number = m[2].trim().replace(/^"(.*)"$/, '$1');
  if (val === 'true') val = true;
  else if (val === 'false') val = false;
  else if (/^\d+$/.test(val)) val = parseInt(val, 10);
  return [key, val];
}

/**
 * Read the heartbeat YAML file for the given role from the specified directory.
 *
 * Returns a HeartbeatData object when the file exists and can be parsed, or
 * undefined if the file does not exist or cannot be read.
 *
 * This function is intentionally lenient: unknown keys are ignored and missing
 * files simply result in undefined instead of throwing.
 */
export function readHeartbeat(dir: string, role: string): HeartbeatData | undefined {
  const filePath = path.join(dir, `${role}.yaml`);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const obj: Record<string, unknown> = {};

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (line === '') continue;
      const parsed = parseYamlLine(line);
      if (parsed) obj[parsed[0]] = parsed[1];
    }

    return obj as unknown as HeartbeatData;
  } catch {
    return undefined;
  }
}

/**
 * Convert the last_beat string from a HeartbeatData into a Date.
 *
 * Returns null if last_beat is missing or not a valid date.
 */
export function getHeartbeatTime(hb: HeartbeatData | undefined): Date | null {
  if (!hb || !hb.last_beat) return null;
  const d = new Date(hb.last_beat);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Determine whether the given heartbeat is "stale" relative to the current time.
 *
 * A heartbeat is considered stale when:
 * - there is no heartbeat data at all, or
 * - last_beat cannot be parsed as a valid Date, or
 * - the time elapsed since last_beat is greater than the given staleThresholdMs.
 *
 * This helper is intended to support BL-528-auto-heal-claim-without-progress:
 * higher-level claim/queue logic can call isHeartbeatStale() to decide whether
 * a claimed task shows no recent progress and should be considered for
 * auto-healing.
 */
export function isHeartbeatStale(
  hb: HeartbeatData | undefined,
  staleThresholdMs: number,
  now: Date = new Date()
): boolean {
  const beatTime = getHeartbeatTime(hb);
  if (!beatTime) {
    // No heartbeat or invalid timestamp -> treat as stale (no progress signal).
    return true;
  }
  const elapsed = now.getTime() - beatTime.getTime();
  return elapsed > staleThresholdMs;
}

/**
 * Convenience helper to check whether there is "no progress" for a role, as
 * inferred from heartbeat data in the given directory.
 *
 * This does not implement the full auto-heal behavior itself; it only reports
 * whether the heartbeat signal is stale according to the provided threshold.
 * Auto-heal logic elsewhere (e.g., claim/backlog processing code) can use this
 * to decide when to release or re-queue a claim that has been held without
 * progress.
 */
export function isClaimWithoutProgress(
  dir: string,
  role: string,
  staleThresholdMs: number,
  now: Date = new Date()
): boolean {
  const hb = readHeartbeat(dir, role);
  return isHeartbeatStale(hb, staleThresholdMs, now);
}
