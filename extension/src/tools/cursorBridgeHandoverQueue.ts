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
import { appendJsonlUpdate, drainJsonlUpdates, drainJsonlUpdatesDurable, type DurableDrain } from './jsonlUpdateQueueLib';

export function cursorBridgeHandoverQueuePath(opDir: string): string {
  return path.join(opDir, 'cursor-bridge-handover.jsonl');
}

export function appendCursorBridgeHandoverUpdate(opDir: string, update: { update_id?: number } & Record<string, unknown>): void {
  appendJsonlUpdate(cursorBridgeHandoverQueuePath(opDir), update);
}

/**
 * Same atomic-rename drain as cursorBridgeInboundQueue.ts, via
 * jsonlUpdateQueueLib - a drained entry is gone from THIS file the instant
 * the call returns, never double-returned by this function alone. Callers
 * still need readAppliedHandoverIds/recordAppliedHandoverId for invariant 2:
 * the SAME update_id can legitimately reach this function twice, from two
 * different retries - the bridge itself re-appending it after a crash
 * before persisting its own advanced offset (Telegram redelivers), and
 * applyHandoverUpdates (telegramFrontDeskBotCore.ts) explicitly re-appending
 * a drained entry whose delivery failed or threw (BL-2061 D2) - either way
 * the dedupe is what makes handing the same id back safe.
 */
export function drainCursorBridgeHandoverUpdates(opDir: string): Array<{ update_id: number } & Record<string, unknown>> {
  return drainJsonlUpdates(cursorBridgeHandoverQueuePath(opDir));
}

/**
 * BL-2061 D3 (QA bounce 2026-10-09, "kill mid-apply loses drained
 * hand-overs"): the front desk's own applyHandoverUpdates is the ONLY
 * production caller of this - drainCursorBridgeHandoverUpdates above
 * stays wired for tests that do not need kill-safety. See
 * drainJsonlUpdatesDurable's own doc for why an immediate, unconditional
 * unlink (what the non-durable drain above does) loses every entry still
 * sitting in a killed process's memory, and how recovery makes that safe.
 */
export function drainCursorBridgeHandoverUpdatesDurable(opDir: string): DurableDrain {
  return drainJsonlUpdatesDurable(cursorBridgeHandoverQueuePath(opDir));
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
