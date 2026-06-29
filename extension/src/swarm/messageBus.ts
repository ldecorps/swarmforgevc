import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type MessageStatus = 'created' | 'received' | 'done' | 'chased' | 'dead-letter';

export interface MessageEvent {
  type: MessageStatus;
  [key: string]: unknown;
}

export interface CreateOptions {
  from: string;
  to: string;
  subject: string;
  body: string;
  seq: number;
}

/** Atomically append one JSON line to logPath via temp-file + rename. */
export function appendEventRaw(logPath: string, event: Record<string, unknown>): void {
  const dir = path.dirname(logPath);
  fs.mkdirSync(dir, { recursive: true });
  const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  const appended = existing + JSON.stringify(event) + '\n';
  const tmp = logPath + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, appended, 'utf8');
  fs.renameSync(tmp, logPath);
}

/** Parse all events from a log file. */
export function readLog(logPath: string): MessageEvent[] {
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    return content
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as MessageEvent);
  } catch {
    return [];
  }
}

/** Return the type of the last event (current status). */
export function currentStatus(logPath: string): MessageStatus | undefined {
  const events = readLog(logPath);
  return events.length > 0 ? events[events.length - 1].type : undefined;
}

/**
 * Create a new message in dir. Returns the message id (also the filename stem).
 * Writes a `created` event atomically.
 */
export function createMessage(dir: string, opts: CreateOptions): string {
  const at = new Date().toISOString();
  const id = `${Date.now()}-${opts.seq}-${crypto.randomBytes(4).toString('hex')}`;
  const logPath = path.join(dir, `${id}.log`);
  const event: Record<string, unknown> = {
    type: 'created',
    id,
    seq: opts.seq,
    schema: 1,
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    body: opts.body,
    at,
  };
  appendEventRaw(logPath, event);
  return id;
}

function leaseIsAlive(event: MessageEvent, nowEpoch: number, ttlSeconds: number): boolean {
  const claimed = event.claimed_by as string | undefined;
  if (!claimed) return false;
  const parts = claimed.split('@');
  if (parts.length !== 2) return false;
  const leaseEpoch = parseInt(parts[1], 10);
  return nowEpoch - leaseEpoch < ttlSeconds;
}

/**
 * Attempt to claim a message for `by`. Returns true if claimed (or already
 * held by `by` with a live lease). Returns false if another claimer holds a
 * live lease.
 */
export function claimMessage(
  logPath: string,
  by: string,
  nowEpoch: number,
  leaseTtlSeconds: number
): boolean {
  const events = readLog(logPath);
  // Find most recent received event
  const lastReceived = [...events].reverse().find((e) => e.type === 'received');

  if (lastReceived) {
    const alive = leaseIsAlive(lastReceived, nowEpoch, leaseTtlSeconds);
    if (alive) {
      const claimer = (lastReceived.claimed_by as string).split('@')[0];
      if (claimer === by) return true; // idempotent
      return false; // different claimer holds live lease
    }
  }

  const status = events.length > 0 ? events[events.length - 1].type : undefined;
  if (status === 'done') return false;

  const at = new Date().toISOString();
  appendEventRaw(logPath, {
    type: 'received',
    by,
    at,
    claimed_by: `${by}@${nowEpoch}`,
  });
  return true;
}

/**
 * Mark a message done. Appends a `done` event.
 */
export function completeMessage(logPath: string, by: string): void {
  appendEventRaw(logPath, {
    type: 'done',
    by,
    at: new Date().toISOString(),
  });
}
