import * as fs from 'fs';
import * as path from 'path';
import { readLog, MessageEvent, claimMessage } from './messageBus';

export interface PendingMessage {
  id: string;
  logPath: string;
  status: string;
  body: string;
}

function isEligible(events: MessageEvent[], nowEpoch: number, leaseTtlSeconds: number): boolean {
  if (events.length === 0) return false;
  const last = events[events.length - 1];
  const status = last.type;
  if (status === 'done' || status === 'dead-letter') return false;
  if (status === 'created' || status === 'chased') return true;
  if (status === 'received') {
    const claimed = last.claimed_by as string | undefined;
    if (!claimed) return true;
    const parts = claimed.split('@');
    if (parts.length !== 2) return true;
    const leaseEpoch = parseInt(parts[1], 10);
    if (isNaN(leaseEpoch)) return true;
    return nowEpoch - leaseEpoch >= leaseTtlSeconds;
  }
  return false;
}

/**
 * Scan dir for message logs addressed to role that are claimable.
 * Each returned message has been atomically claimed via claimMessage.
 */
export function pickupPendingMessages(
  dir: string,
  role: string,
  nowEpoch: number,
  leaseTtlSeconds: number
): PendingMessage[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.log'));
  } catch {
    return [];
  }
  const results: PendingMessage[] = [];
  for (const file of files) {
    const logPath = path.join(dir, file);
    const events = readLog(logPath);
    if (events.length === 0) continue;
    const created = events[0];
    if (created.type !== 'created') continue;
    if (created.to !== role) continue;
    if (!isEligible(events, nowEpoch, leaseTtlSeconds)) continue;
    // Atomically claim before including in results
    const claimed = claimMessage(logPath, role, nowEpoch, leaseTtlSeconds);
    if (!claimed) continue;
    const id = file.replace(/\.log$/, '');
    results.push({ id, logPath, status: 'received', body: created.body as string });
  }
  return results;
}
