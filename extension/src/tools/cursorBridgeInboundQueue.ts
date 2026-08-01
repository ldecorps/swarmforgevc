/**
 * Front desk → Host/Bubble bridge inbound fan-out.
 *
 * When front desk and telegram-cursor-bridge share one bot token, only the
 * front desk may call getUpdates. Host/Bubble (and poll_answer) updates are
 * appended here; the bridge drains them instead of competing on Telegram.
 */
import * as fs from 'fs';
import * as path from 'path';

export function cursorBridgeInboundQueuePath(opDir: string): string {
  return path.join(opDir, 'cursor-bridge-inbound.jsonl');
}

export function appendCursorBridgeInboundUpdate(opDir: string, update: { update_id?: number } & Record<string, unknown>): void {
  const file = cursorBridgeInboundQueuePath(opDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(update)}\n`, 'utf8');
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
export function drainCursorBridgeInboundUpdates(opDir: string): Array<{ update_id: number } & Record<string, unknown>> {
  const file = cursorBridgeInboundQueuePath(opDir);
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
  const out: Array<{ update_id: number } & Record<string, unknown>> = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as { update_id?: unknown } & Record<string, unknown>;
      if (typeof parsed.update_id === 'number') {
        out.push(parsed as { update_id: number } & Record<string, unknown>);
      }
    } catch {
      // skip malformed
    }
  }
  return out;
}
