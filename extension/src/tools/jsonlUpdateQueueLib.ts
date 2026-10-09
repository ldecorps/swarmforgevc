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

const DRAINING_PREFIX_SEP = '.draining-';

function leftoverDrainingFiles(file: string): string[] {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}${DRAINING_PREFIX_SEP}`;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  // Lexicographic sort is chronological too: the fresh name below puts
  // Date.now() right after the prefix, and a millisecond epoch stamp stays
  // a fixed 13 digits until the year ~2286, so no name is ever a different
  // width. Putting the pid first instead (as drainJsonlUpdates's own
  // non-durable naming does - unrelated here) would sort by PID, not time,
  // across leftover files from different process incarnations.
  return names
    .filter((name) => name.startsWith(prefix))
    .sort()
    .map((name) => path.join(dir, name));
}

function readAndParseDrainingFile(drainingPath: string): QueuedUpdate[] {
  let raw: string;
  try {
    raw = fs.readFileSync(drainingPath, 'utf8');
  } catch {
    return [];
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

export interface DurableDrain {
  updates: QueuedUpdate[];
  /**
   * Unlinks every draining file this drain read from (the one freshly
   * renamed off `file` here, plus any leftover recovered below). Call this
   * only once every returned update has itself been durably applied or
   * requeued elsewhere - calling it earlier (or not at all) reopens the
   * exact loss window this exists to close.
   */
  commit: () => void;
}

/**
 * Durable counterpart to drainJsonlUpdates: unlike that function, nothing
 * is unlinked here - the caller must call back the returned commit()
 * explicitly, once every returned update has been durably applied or
 * requeued elsewhere. A process killed between this call returning and
 * commit() running leaves its draining file(s) on disk instead of losing
 * them. The NEXT durable drain recovers any such leftover (oldest first,
 * ahead of whatever is freshly renamed off the live file this call), so
 * an update read here is never lost to a kill mid-apply the way an
 * immediate, unconditional unlink would lose it. Recovering an id that was
 * already applied before the kill is safe: callers dedupe on update_id
 * before acting on a drained entry a second time (see
 * cursorBridgeHandoverQueue.ts's isHandoverUpdateApplied).
 *
 * drainJsonlUpdates itself is unchanged and keeps its own immediate,
 * unconditional cleanup - the front-desk -> bridge inbound queue's own
 * contract (a drain leaves nothing behind, no caller ever commits) relies
 * on exactly that, and must not gain a durability caller it never asked for.
 */
export function drainJsonlUpdatesDurable(file: string): DurableDrain {
  const pending = leftoverDrainingFiles(file);
  const recovered = pending.flatMap(readAndParseDrainingFile);

  const fresh = `${file}${DRAINING_PREFIX_SEP}${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
  let freshUpdates: QueuedUpdate[] = [];
  try {
    fs.renameSync(file, fresh);
    freshUpdates = readAndParseDrainingFile(fresh);
    pending.push(fresh);
  } catch {
    // Nothing live to drain; any recovered leftovers still apply below.
  }

  return {
    updates: [...recovered, ...freshUpdates],
    commit: () => {
      for (const drainingPath of pending) {
        try {
          fs.unlinkSync(drainingPath);
        } catch {
          // best-effort cleanup
        }
      }
    },
  };
}
