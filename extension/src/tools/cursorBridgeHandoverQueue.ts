/**
 * BL-2061: Bridge → front-desk hand-over, the reverse of
 * cursorBridgeInboundQueue.ts's front-desk → bridge fan-out.
 *
 * While the cursor bridge holds getUpdates on the shared bot token (its
 * BL-1253 dead-feeder fallback), every update it reads that is not its own
 * must still reach the front desk rather than being answered and dropped.
 * The bridge appends the raw update here; the front desk drains it at the
 * top of its own poll cycle and applies it through the same per-update
 * pipeline a normal getUpdates update goes through.
 */
import * as fs from 'fs';
import * as path from 'path';

export function cursorBridgeHandoverQueuePath(opDir: string): string {
  return path.join(opDir, 'cursor-bridge-handover.jsonl');
}

export function appendCursorBridgeHandoverUpdate(opDir: string, update: { update_id?: number } & Record<string, unknown>): void {
  const file = cursorBridgeHandoverQueuePath(opDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(update)}\n`, 'utf8');
}

function parseHandoverLine(line: string): ({ update_id: number } & Record<string, unknown>) | undefined {
  try {
    const parsed = JSON.parse(line) as { update_id?: unknown } & Record<string, unknown>;
    return typeof parsed.update_id === 'number' ? (parsed as { update_id: number } & Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Atomic-rename drain, same rationale as drainCursorBridgeInboundUpdates:
 * a concurrent append either lands in the file we just moved out (and is
 * included below) or recreates `file` afterward for the next drain - never
 * lost, never double-counted by this function alone (callers still need
 * readAppliedHandoverIds/recordAppliedHandoverId for invariant 2, since a
 * crash between drain and apply can hand the same update_id back twice).
 */
export function drainCursorBridgeHandoverUpdates(opDir: string): Array<{ update_id: number } & Record<string, unknown>> {
  const file = cursorBridgeHandoverQueuePath(opDir);
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
    const parsed = parseHandoverLine(line);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

function appliedHandoverIdsPath(opDir: string): string {
  return path.join(opDir, 'cursor-bridge-handover-applied.json');
}

// Bounded so a long-running front desk never grows this file without limit;
// 500 is far more than any plausible dead-feeder window's update count.
const MAX_TRACKED_APPLIED_IDS = 500;

export function readAppliedHandoverIds(opDir: string): Set<number> {
  try {
    const raw = JSON.parse(fs.readFileSync(appliedHandoverIdsPath(opDir), 'utf8')) as unknown;
    return Array.isArray(raw) ? new Set(raw.filter((id): id is number => typeof id === 'number')) : new Set();
  } catch {
    return new Set();
  }
}

export function isHandoverUpdateApplied(opDir: string, updateId: number): boolean {
  return readAppliedHandoverIds(opDir).has(updateId);
}

export function recordAppliedHandoverId(opDir: string, updateId: number): void {
  const ids = readAppliedHandoverIds(opDir);
  ids.add(updateId);
  const bounded = Array.from(ids).slice(-MAX_TRACKED_APPLIED_IDS);
  const file = appliedHandoverIdsPath(opDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(bounded), 'utf8');
}
