/**
 * BL-2061 cleanup: shared append/parse/drain primitives for a durable
 * single-file JSONL update queue, keyed by Telegram's update_id. Both
 * cursorBridgeInboundQueue.ts (front desk → bridge) and
 * cursorBridgeHandoverQueue.ts (bridge → front desk) are the same queue
 * shape in opposite directions; this module is their one implementation.
 */
import * as fs from 'fs';
import * as path from 'path';

export type QueuedUpdate = { update_id: number } & Record<string, unknown>;

export function appendJsonlUpdate(file: string, update: { update_id?: number } & Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(update)}\n`, 'utf8');
}

/**
 * A single queue line, parsed and validated - undefined for blank/malformed/
 * id-less lines. No separate blank-line check: JSON.parse throws on an empty
 * or whitespace-only string exactly like it does on any other malformed
 * input, so the catch below already covers it - a dedicated trim/blank guard
 * would be dead code ahead of an identical fallback.
 */
function parseJsonlUpdateLine(line: string): QueuedUpdate | undefined {
  try {
    const parsed = JSON.parse(line) as { update_id?: unknown } & Record<string, unknown>;
    return typeof parsed.update_id === 'number' ? (parsed as QueuedUpdate) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Drain via atomic rename rather than read-then-truncate: a truncating write
 * issued after the read has a window where a concurrent appendFileSync lands
 * in the file just before it gets overwritten with '' — that update is lost.
 * Renaming the file out from under the appender is atomic (same filesystem):
 * any append that raced the rename either landed in the file we just moved
 * (and is included below) or recreates `file` afterward and is picked up
 * whole by the next drain. Either way nothing appended is ever lost, and
 * nothing is returned twice.
 */
export function drainJsonlUpdates(file: string): QueuedUpdate[] {
  const draining = `${file}.draining-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    fs.renameSync(file, draining);
  } catch {
    return [];
  }
  let raw: string;
  try {
    raw = fs.readFileSync(draining, 'utf8');
  } finally {
    try {
      fs.unlinkSync(draining);
    } catch {
      // best-effort cleanup
    }
  }
  const out: QueuedUpdate[] = [];
  for (const line of raw.split('\n')) {
    const parsed = parseJsonlUpdateLine(line);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}
