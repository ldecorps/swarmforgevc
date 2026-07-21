import * as fs from 'fs';
import * as path from 'path';
import { parseHandoffHeaderField } from './inboxChaser';

/**
 * BL-121: canary injector — sends periodic synthetic handoffs through the
 * real delivery pipeline to detect transport-level breakage independent of
 * process liveness. A canary that completes within its budget signals healthy
 * delivery; a missed canary (timeout exceeded) signals transport broken.
 */

export interface CanaryStatus {
  lastRoundTripMs: number;
}

export interface CanaryScheduleDecision {
  shouldInject: boolean;
  nextCheckMs: number;
}

function canaryQueuePendingDir(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'daemon', 'canary-queue', 'pending');
}

// handoffd.bb's canary-sweep! moves a pending canary here as part of its own
// poll loop (never into any role's real inbox) — the completion signal for
// reconcileCanary below. A canary only lands here if the daemon's loop is
// actually still iterating, not merely alive as an OS process.
export function canaryQueueCompletedDir(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'daemon', 'canary-queue', 'completed');
}

/**
 * Generates a unique canary task name (format: canary-YYYYMMDDTHHMMSSZ,
 * deterministic per second) and writes it as a pending handoff-style file
 * under the daemon's own canary queue — a sibling of canary-status.json
 * under .swarmforge/daemon/, never under .swarmforge/handoffs/, so a canary
 * can never be picked up by ready_for_next.sh as a work item for any
 * pipeline role (BL-121 canary-isolation-04).
 */
export function sendCanary(targetPath: string, nowMs: number): string {
  const date = new Date(nowMs);
  const isoString = date.toISOString();
  // Take YYYY-MM-DDTHH:MM:SSZ and format as YYYYMMDDTHHMMSSz
  const timestamp = isoString
    .substring(0, 19) // "2026-07-05T22:00:00"
    .replace(/[-:]/g, '') + // "20260705T220000"
    'Z';
  const taskName = `canary-${timestamp}`;

  const pendingDir = canaryQueuePendingDir(targetPath);
  fs.mkdirSync(pendingDir, { recursive: true });
  const filePath = path.join(pendingDir, `${taskName}.handoff`);
  fs.writeFileSync(filePath, `task: ${taskName}\nsent_at: ${isoString}\n`, 'utf-8');

  return taskName;
}

function canaryStatusFile(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'daemon', 'canary-status.json');
}

/**
 * Searches the role's completed inbox for a handoff matching the canary task name.
 * Returns completion details if found, null otherwise.
 */
export function trackCanaryCompletion(
  targetPath: string,
  canaryTaskName: string,
  completedInboxDir: string
): { found: boolean; completedAtMs: number } | null {
  if (!fs.existsSync(completedInboxDir)) {
    return null;
  }
  for (const entry of fs.readdirSync(completedInboxDir)) {
    if (!entry.endsWith('.handoff')) {
      continue;
    }
    const filePath = path.join(completedInboxDir, entry);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const taskField = parseHandoffHeaderField(content, 'task');
      if (taskField === canaryTaskName) {
        const stat = fs.statSync(filePath);
        return { found: true, completedAtMs: stat.mtimeMs };
      }
    } catch {
      // Skip files that can't be read
      continue;
    }
  }
  return null;
}

/**
 * Records a successful canary round-trip by updating canary-status.json.
 * This file is read by transportHealth to determine if the canary is healthy.
 */
export function recordCanaryRoundTrip(targetPath: string, sentAtMs: number, completedAtMs: number): void {
  const statusPath = canaryStatusFile(targetPath);
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, JSON.stringify({ lastRoundTripMs: completedAtMs }), 'utf-8');
}

/**
 * Reads the canary status file. Returns null if it doesn't exist or can't be parsed.
 */
export function readCanaryStatusFile(targetPath: string): CanaryStatus | null {
  try {
    const content = fs.readFileSync(canaryStatusFile(targetPath), 'utf-8');
    const data = JSON.parse(content);
    if (typeof data.lastRoundTripMs === 'number') {
      return { lastRoundTripMs: data.lastRoundTripMs };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Writes canary status to the status file.
 */
export function writeCanaryStatusFile(targetPath: string, status: CanaryStatus): void {
  const statusPath = canaryStatusFile(targetPath);
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, JSON.stringify(status), 'utf-8');
}

/**
 * Decides whether a new canary should be injected now, and when to check again.
 * Strategy: inject on first call (no prior canary), then periodically when the
 * prior canary is getting old (80% through its budget). This ensures continuous
 * monitoring while avoiding hammering with constant injections.
 */
export function computeCanaryInjectionSchedule(
  targetPath: string,
  nowMs: number,
  canaryBudgetSeconds: number
): CanaryScheduleDecision {
  const prior = readCanaryStatusFile(targetPath);

  if (prior === null) {
    // First injection: no prior canary exists
    return { shouldInject: true, nextCheckMs: nowMs + 60_000 };
  }

  const ageMs = nowMs - prior.lastRoundTripMs;
  const budgetMs = canaryBudgetSeconds * 1000;
  const stalThresholdMs = budgetMs * 0.8; // Re-inject at 80% of budget

  if (ageMs >= stalThresholdMs) {
    // Current canary is getting old; inject a new one to overlap
    return { shouldInject: true, nextCheckMs: nowMs + 60_000 };
  }

  // Current canary is still fresh; wait a bit longer
  const remainingMs = stalThresholdMs - ageMs;
  const checkIntervalMs = Math.min(60_000, remainingMs / 2); // 1 min or half of remaining
  return { shouldInject: false, nextCheckMs: nowMs + checkIntervalMs };
}

export interface ReconcileResult {
  /** Task names whose round trip completed and was recorded this call. */
  reconciledTaskNames: string[];
}

/**
 * Reconciles a single pending canary file against the completed inbox.
 * Returns its task name once its round trip is recorded and the pending
 * file is cleared, or null if it has not completed yet (or is malformed).
 */
function reconcileOnePendingCanary(
  targetPath: string,
  filePath: string,
  completedInboxDir: string
): string | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const taskName = parseHandoffHeaderField(content, 'task');
  if (!taskName) {
    return null;
  }
  const completion = trackCanaryCompletion(targetPath, taskName, completedInboxDir);
  if (!completion?.found) {
    return null;
  }
  const sentAtField = parseHandoffHeaderField(content, 'sent_at');
  const sentAtMs = sentAtField ? Date.parse(sentAtField) : fs.statSync(filePath).mtimeMs;
  recordCanaryRoundTrip(targetPath, sentAtMs, completion.completedAtMs);
  fs.rmSync(filePath);
  return taskName;
}

/**
 * Checks every canary still sitting in the pending queue against the real
 * transport's completed inbox. Any that have round-tripped get their
 * completion recorded via recordCanaryRoundTrip and are cleared from
 * pending so a later call never re-reconciles the same canary twice; any
 * that have not yet completed are left in place for the next call.
 */
export function reconcileCanary(targetPath: string, completedInboxDir: string): ReconcileResult {
  const pendingDir = canaryQueuePendingDir(targetPath);
  const reconciledTaskNames: string[] = [];
  if (!fs.existsSync(pendingDir)) {
    return { reconciledTaskNames };
  }

  for (const entry of fs.readdirSync(pendingDir)) {
    if (!entry.endsWith('.handoff')) {
      continue;
    }
    const filePath = path.join(pendingDir, entry);
    const taskName = reconcileOnePendingCanary(targetPath, filePath, completedInboxDir);
    if (taskName) {
      reconciledTaskNames.push(taskName);
    }
  }

  return { reconciledTaskNames };
}

export interface CanaryCycleResult {
  /** Whether a new canary was injected this cycle. */
  injected: boolean;
  /** Task name of the newly injected canary, or null if none was injected. */
  taskName: string | null;
  /** Task names reconciled (completed round trip recorded) this cycle. */
  reconciled: string[];
  /** When the caller should invoke this cycle again. */
  nextCheckMs: number;
}

/**
 * One full canary tick: reconcile any pending canaries that have completed
 * their round trip since the last cycle, then decide (via
 * computeCanaryInjectionSchedule) whether a new canary is due. Reconciling
 * first means a canary that completes right on schedule refreshes
 * canary-status.json before the injection decision is made, so a fresh
 * round trip does not get immediately followed by a redundant injection.
 */
export function runCanaryCycle(
  targetPath: string,
  completedInboxDir: string,
  nowMs: number,
  canaryBudgetSeconds: number
): CanaryCycleResult {
  const { reconciledTaskNames } = reconcileCanary(targetPath, completedInboxDir);
  const schedule = computeCanaryInjectionSchedule(targetPath, nowMs, canaryBudgetSeconds);
  const taskName = schedule.shouldInject ? sendCanary(targetPath, nowMs) : null;

  return {
    injected: schedule.shouldInject,
    taskName,
    reconciled: reconciledTaskNames,
    nextCheckMs: schedule.nextCheckMs,
  };
}
