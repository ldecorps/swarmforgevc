import * as fs from 'fs';
import * as path from 'path';
import { listDeadLettersForRole } from './inboxChaser';

/**
 * BL-122: automatic agent-driven handoff recovery. Consumes BL-121's
 * detection (dead-lettered parcels) and self-heals without a human — a
 * dead letter is re-delivered to its recipient, never into a busy live
 * holder's in-flight work (BL-109), with bounded retries that escalate to a
 * needs-human state instead of looping or leaving the parcel to rot in
 * failed/ indefinitely.
 *
 * Recovery owner (recovery-owner-05): this module is invoked from the SAME
 * extension-host timer that already drives chaserMonitor's sweep, not from
 * any one pipeline agent. An agent process can exit and tear down the swarm
 * around it (BL-107); the extension host's watchdog timer is not a pipeline
 * agent and is already the supervised owner of the chase/respawn seams this
 * builds on, so it is not a new single point of failure.
 */

export interface RecoveryConfig {
  maxRecoveryAttempts: number;
}

export type RecoveryAction = 'redelivered' | 'skipped-busy' | 'escalated';

export interface RecoveryOutcome {
  role: string;
  filePath: string;
  action: RecoveryAction;
  attempts: number;
}

export interface RecoveryAdapters {
  isRecipientBusy: (role: string) => boolean;
  sendWakeUp: (role: string) => void;
  logRemediation: (outcome: RecoveryOutcome) => void;
  setNeedsHuman: (role: string, needsHuman: boolean) => void;
}

// Attempts are keyed to the STABLE base handoff path (without the .dead
// suffix) so a parcel that keeps failing across repeated redeliver/dead-letter
// cycles accumulates toward the bound instead of resetting to 0 every time
// the chaser dead-letters it again.
function baseHandoffPath(filePath: string): string {
  return filePath.endsWith('.dead') ? filePath.slice(0, -'.dead'.length) : filePath;
}

function recoveryAttemptsPath(filePath: string): string {
  return `${baseHandoffPath(filePath)}.recovery.json`;
}

export function readRecoveryAttempts(filePath: string): number {
  try {
    const data = JSON.parse(fs.readFileSync(recoveryAttemptsPath(filePath), 'utf-8'));
    return typeof data.attempts === 'number' ? data.attempts : 0;
  } catch {
    return 0;
  }
}

export function writeRecoveryAttempts(filePath: string, attempts: number): void {
  fs.writeFileSync(recoveryAttemptsPath(filePath), JSON.stringify({ attempts }), 'utf-8');
}

// BL-1114: handoffs/failed/ relative to inbox/new (…/handoffs/inbox/new →
// …/handoffs/failed). Same box babysitterd's dead-letter-nonempty CRIT reads.
export function failedBoxDir(inboxNewDir: string): string {
  return path.join(inboxNewDir, '..', '..', 'failed');
}

/** Exported for mutation killers — message header must stay ≤ maxLen. */
export function truncateMessage(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

// Role-visible terminal signal: a real note in inbox/new the holder can
// dequeue, naming the exhausted .dead. Message header stays ≤80 chars to
// match swarm_handoff note limits.
export function installTerminalRecoveryNote(
  role: string,
  inboxNewDir: string,
  deadPath: string,
  attempts: number
): string {
  const deadBase = path.basename(deadPath);
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dest = path.join(inboxNewDir, `00_${stamp}_from_recovery_to_${role}_for_${role}.handoff`);
  const message = truncateMessage(
    `TERMINAL dead-letter ${deadBase} after ${attempts} recovery attempts — needs human`,
    80
  );
  const body = [
    `id: recovery_exhausted_${stamp}`,
    'from: recovery',
    `to: ${role}`,
    `recipient: ${role}`,
    'priority: 00',
    'type: note',
    `message: ${message}`,
    `created_at: ${now.toISOString()}`,
    '',
    `Recovery exhausted for ${deadBase} (${attempts} attempts).`,
    'The .dead parcel was moved to handoffs/failed/. Needs human.',
    '',
  ].join('\n');
  fs.writeFileSync(dest, body, 'utf-8');
  return dest;
}

// Move the silent .dead (+ recovery sidecar) out of inbox/new into failed/.
export function disposeEscalatedDeadLetter(deadPath: string, failedDir: string): string {
  fs.mkdirSync(failedDir, { recursive: true });
  const dest = path.join(failedDir, path.basename(deadPath));
  fs.renameSync(deadPath, dest);
  const recoverySrc = recoveryAttemptsPath(deadPath);
  if (fs.existsSync(recoverySrc)) {
    fs.renameSync(recoverySrc, path.join(failedDir, path.basename(recoverySrc)));
  }
  fs.rmSync(`${deadPath}.chase.json`, { force: true });
  return dest;
}

function applyExhaustedEscalation(
  role: string,
  inboxNewDir: string,
  deadPath: string,
  attempts: number,
  adapters: RecoveryAdapters
): RecoveryOutcome {
  const failedDir = failedBoxDir(inboxNewDir);
  installTerminalRecoveryNote(role, inboxNewDir, deadPath, attempts);
  const disposedPath = disposeEscalatedDeadLetter(deadPath, failedDir);
  const outcome: RecoveryOutcome = { role, filePath: disposedPath, action: 'escalated', attempts };
  adapters.setNeedsHuman(role, true);
  adapters.sendWakeUp(role);
  adapters.logRemediation(outcome);
  return outcome;
}

// A live holder actively processing work is never clobbered by a
// re-delivery (BL-109's busy-recipient dead-letter bug was exactly this
// failure mode in reverse). Once bounded retries are exhausted without ever
// finding the recipient idle, the parcel escalates instead of retrying
// forever or silently vanishing.
export function decideRecoveryAction(
  attempts: number,
  isRecipientBusy: boolean,
  config: RecoveryConfig
): RecoveryAction {
  if (isRecipientBusy) {
    return 'skipped-busy';
  }
  if (attempts >= config.maxRecoveryAttempts) {
    return 'escalated';
  }
  return 'redelivered';
}

// Redelivery is a rename of the SAME file that dead-lettering renamed
// (<name>.dead -> <name>): there is never more than one copy of a parcel on
// disk, so a sweep that runs again after a successful redelivery finds
// nothing left in .dead form and is a structural no-op — the recipient can
// never see two actionable copies (idempotent-redelivery-02).
export function recoverDeadLettersForRole(
  role: string,
  inboxNewDir: string,
  config: RecoveryConfig,
  adapters: RecoveryAdapters
): RecoveryOutcome[] {
  const outcomes: RecoveryOutcome[] = [];
  for (const dl of listDeadLettersForRole(role, inboxNewDir)) {
    const attempts = readRecoveryAttempts(dl.filePath);
    const action = decideRecoveryAction(attempts, adapters.isRecipientBusy(role), config);

    if (action === 'redelivered') {
      const restoredPath = baseHandoffPath(dl.filePath);
      fs.renameSync(dl.filePath, restoredPath);
      // RE-SCOPE (c): the daemon's chase-sweep dead-letters by mtime age AND
      // an exhausted chase-count sidecar - both of which this file still
      // carries from before it was dead-lettered. Carrying either forward
      // unchanged means the very next daemon sweep cycle sees an old mtime
      // and an already-exhausted chase-count and dead-letters it again
      // immediately, before the recipient has any real chance to consume it
      // (the chase-then-recover race). A redelivery is a fresh delivery
      // attempt from the transport's own chase clock: drop the stale
      // sidecar and touch the file to now.
      fs.rmSync(`${dl.filePath}.chase.json`, { force: true });
      const redeliveredAt = new Date();
      fs.utimesSync(restoredPath, redeliveredAt, redeliveredAt);
      writeRecoveryAttempts(restoredPath, attempts + 1);
      const outcome: RecoveryOutcome = { role, filePath: restoredPath, action, attempts: attempts + 1 };
      outcomes.push(outcome);
      adapters.setNeedsHuman(role, false);
      adapters.sendWakeUp(role);
      adapters.logRemediation(outcome);
    } else if (action === 'escalated') {
      // BL-1114: needs-human alone left the holder with silent .dead debris
      // after Operator announce-once. Wake + terminal note + move to failed/.
      outcomes.push(applyExhaustedEscalation(role, inboxNewDir, dl.filePath, attempts, adapters));
    } else {
      // skipped-busy: deferred to the next sweep, not lost — leave the
      // dead letter and its attempt count untouched.
      outcomes.push({ role, filePath: dl.filePath, action, attempts });
    }
  }
  return outcomes;
}

export function recoverDeadLetters(
  roleInboxes: { role: string; inboxNewDir: string }[],
  config: RecoveryConfig,
  adapters: RecoveryAdapters
): RecoveryOutcome[] {
  return roleInboxes.flatMap(({ role, inboxNewDir }) =>
    recoverDeadLettersForRole(role, inboxNewDir, config, adapters)
  );
}

// Durable remediation log (append-only JSONL), so every recovery action —
// redelivered or escalated — has an audit trail rather than living only in
// the process's memory (BL-122: "remediation actions and outcomes are
// durably logged").
export function recoveryLogPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'daemon', 'recovery.log');
}

export function appendRecoveryLog(targetPath: string, outcome: RecoveryOutcome): void {
  const logPath = recoveryLogPath(targetPath);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify({ ...outcome, at: new Date().toISOString() })}\n`, 'utf-8');
}
