import * as fs from 'fs';
import * as path from 'path';

/**
 * BL-121: Canary injector — injects periodic synthetic handoffs that make a
 * round-trip through the entire pipeline to prove delivery is working, and
 * records successful round-trip times so transportHealth can detect when
 * delivery is broken.
 *
 * The canary lives as a parcel with task name "canary-<timestamp>" so the
 * pipeline recognizes it as non-work and skips normal accounting, but still
 * delivers it. A missed canary (one that does not arrive back at the
 * coordinator within a budget) is the definitive "transport is broken" signal,
 * independent of process liveness.
 */

export interface CanaryRecord {
  injectedAtMs: number;
  canaryTaskName: string;
  recipientTaskName?: string; // what the recipient's completed/ file saw
}

export interface CanaryInjectorConfig {
  /** Interval in seconds between periodic canary injections. */
  injectionIntervalSeconds: number;
  /** Maximum age (seconds) a canary can have before considering it missed. */
  budgetSeconds: number;
}

function canaryStatusFile(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'daemon', 'canary-status.json');
}

function trackedCanariesFile(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'daemon', 'canaries.json');
}

export function generateCanaryTaskName(nowMs: number): string {
  const utc = new Date(nowMs);
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc.getUTCDate()).padStart(2, '0');
  const hour = String(utc.getUTCHours()).padStart(2, '0');
  const minute = String(utc.getUTCMinutes()).padStart(2, '0');
  const second = String(utc.getUTCSeconds()).padStart(2, '0');
  return `canary-${year}${month}${day}T${hour}${minute}${second}Z`;
}

export interface CanaryStatus {
  lastRoundTripMs: number | null;
}

/**
 * Reads the last recorded canary round-trip time, or null if no canary has
 * ever completed. Mirrors the pattern of readDaemonHealth: a status file
 * maintained by the injector. Absent or unreadable means no data.
 */
export function readCanaryStatus(targetPath: string): CanaryStatus {
  try {
    const raw = JSON.parse(fs.readFileSync(canaryStatusFile(targetPath), 'utf-8'));
    const lastRoundTripMs = typeof raw.lastRoundTripMs === 'number' ? raw.lastRoundTripMs : null;
    return { lastRoundTripMs };
  } catch {
    return { lastRoundTripMs: null };
  }
}

export function writeCanaryStatus(targetPath: string, lastRoundTripMs: number): void {
  const dir = path.dirname(canaryStatusFile(targetPath));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(canaryStatusFile(targetPath), JSON.stringify({ lastRoundTripMs }), 'utf-8');
}

export function readTrackedCanaries(targetPath: string): CanaryRecord[] {
  try {
    const raw = JSON.parse(fs.readFileSync(trackedCanariesFile(targetPath), 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeTrackedCanaries(targetPath: string, records: CanaryRecord[]): void {
  const dir = path.dirname(trackedCanariesFile(targetPath));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(trackedCanariesFile(targetPath), JSON.stringify(records), 'utf-8');
}

/**
 * Returns true if a canary at the given age is still within its delivery
 * budget (not yet considered missed).
 */
export function isCanaryWithinBudget(ageSeconds: number, budgetSeconds: number): boolean {
  return ageSeconds <= budgetSeconds;
}

/**
 * Generates the canary handoff filename that will appear in outbox/. This is
 * deterministic so the injector can watch for it in completed/ later.
 */
export function canaryOutboxFilename(taskName: string, recipientCount: number): string {
  const recipients = Array(recipientCount)
    .fill('coordinator')
    .join(',');
  return `00_${taskName.replace(/[^0-9A-Z]/gi, '')}_from_coordinator_to_${recipients}.handoff`;
}

/**
 * Generates a canary handoff draft ready for swarm_handoff.sh validation.
 * The canary is sent to every role in the pipeline so it makes the full
 * round-trip and proves end-to-end delivery.
 */
export function generateCanaryHandoffDraft(taskName: string, roles: string[]): string {
  return `type: git_handoff
to: ${roles.join(',')}
priority: 00
task: ${taskName}
commit: 0000000000

Testing delivery: canary handoff round-trip`;
}

/**
 * Attempts to inject a new canary now, if the last injection was long enough
 * ago. Records it in canaries.json so the detector can watch for its
 * completion. Returns the canary task name if a new one was injected, or null
 * if the injection interval has not elapsed.
 *
 * The actual handoff file creation and delivery to swarm_handoff.sh is the
 * caller's responsibility; this function only manages the state.
 */
export function tryInjectCanary(
  targetPath: string,
  nowMs: number,
  config: CanaryInjectorConfig,
  pipelineRoles: string[]
): string | null {
  const tracked = readTrackedCanaries(targetPath);
  const lastInjectin = tracked.length > 0 ? tracked[tracked.length - 1].injectedAtMs : null;

  if (lastInjectin !== null) {
    const ageMs = nowMs - lastInjectin;
    const ageSeconds = ageMs / 1000;
    if (ageSeconds < config.injectionIntervalSeconds) {
      return null;
    }
  }

  const taskName = generateCanaryTaskName(nowMs);
  const record: CanaryRecord = { injectedAtMs: nowMs, canaryTaskName: taskName };
  tracked.push(record);
  writeTrackedCanaries(targetPath, tracked);

  return taskName;
}

/**
 * Detector: scans the coordinator's completed inbox for canaries and records
 * their round-trip times. For each completed canary, removes it from the
 * tracked list (so old completed canaries don't accumulate) and records the
 * round-trip time in canary-status.json.
 *
 * This is called periodically by the supervisor/extension to update the canary
 * health status.
 */
export function detectCompletedCanaries(targetPath: string, nowMs: number, coordinatorCompletedDir: string): void {
  const tracked = readTrackedCanaries(targetPath);
  const updated: CanaryRecord[] = [];

  for (const record of tracked) {
    const ageMs = nowMs - record.injectedAtMs;
    const ageSeconds = ageMs / 1000;

    // Look for a completed handoff with this canary's task name. The filename
    // in completed/ will be named with the canary task and marked _for_coordinator.
    let found = false;
    if (fs.existsSync(coordinatorCompletedDir)) {
      for (const entry of fs.readdirSync(coordinatorCompletedDir)) {
        // Match handoff files (must be .handoff, not sidecar files)
        if (!entry.endsWith('.handoff')) {
          continue;
        }
        // Check if this is a matching canary by reading the task field
        try {
          const filePath = path.join(coordinatorCompletedDir, entry);
          const content = fs.readFileSync(filePath, 'utf-8');
          const taskMatch = content.match(/^task:\s*(.+)$/m);
          if (taskMatch && taskMatch[1].trim() === record.canaryTaskName) {
            found = true;
            record.recipientTaskName = record.canaryTaskName;
            break;
          }
        } catch {
          // Ignore unreadable files, keep looking
        }
      }
    }

    if (found) {
      // Canary completed successfully! Record the round-trip time.
      writeCanaryStatus(targetPath, ageMs);
    } else if (ageSeconds > 3600) {
      // Old canary, assume it's lost. Don't record it, just clean it up.
      found = true;
    }

    if (!found) {
      updated.push(record);
    }
  }

  writeTrackedCanaries(targetPath, updated);
}
