// BL-703: durable autopilot/land batch flight lock under .swarmforge/operator/.

import * as fs from 'node:fs';
import * as path from 'node:path';

export type OperatorBatchMode = 'autopilot' | 'land' | 'hydrate';

export interface OperatorBatchState {
  mode: OperatorBatchMode;
  queue: string[];
  index: number;
  askLandSleep?: boolean;
  hydrateTarget?: string;
  hydrateMode?: 'hydrate' | 'mint';
  startedAtMs: number;
}

function batchPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', 'cursor-batch.json');
}

function atomicWrite(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function readOperatorBatch(repoRoot: string): OperatorBatchState | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(batchPath(repoRoot), 'utf8')) as OperatorBatchState;
    if (!raw || !Array.isArray(raw.queue) || typeof raw.index !== 'number') {
      return undefined;
    }
    return raw;
  } catch {
    return undefined;
  }
}

export function writeOperatorBatch(repoRoot: string, state: OperatorBatchState): void {
  atomicWrite(batchPath(repoRoot), `${JSON.stringify(state, null, 2)}\n`);
}

export function clearOperatorBatch(repoRoot: string): void {
  try {
    fs.unlinkSync(batchPath(repoRoot));
  } catch {
    // absent is fine
  }
}

export function isOperatorBatchInFlight(repoRoot: string): boolean {
  return readOperatorBatch(repoRoot) !== undefined;
}

/** Verbs that must not overlap an in-flight autopilot/land/hydrate batch. */
export function isBatchExclusiveVerb(verb: string): boolean {
  const v = verb.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return (
    v === '/pilot' ||
    v === '/expedite' ||
    v === '/reexpedite' ||
    v === '/autopilot' ||
    v === '/land' ||
    v === '/hydrate' ||
    v === '/mint'
  );
}

export function formatBatchBusyRefuse(batch: OperatorBatchState, verb: string): string {
  const current = batch.queue[batch.index] ?? '(none)';
  return [
    `Cannot ${verb}: ${batch.mode} in flight (${batch.index + 1}/${batch.queue.length || 1}, current ${current}).`,
    'Wait for the batch to finish, or /confirm-off will not clear it — finish or bounce the bridge.',
  ].join('\n');
}

/**
 * After one pilot ticket finishes, advance index. Returns next ticket id,
 * or undefined when the queue is complete (caller should clear + maybe land-sleep).
 */
export function advanceOperatorBatch(
  repoRoot: string
): { nextTicket?: string; completed: boolean; askLandSleep: boolean; batch?: OperatorBatchState } {
  const batch = readOperatorBatch(repoRoot);
  if (!batch) {
    return { completed: true, askLandSleep: false };
  }
  if (batch.mode === 'hydrate') {
    clearOperatorBatch(repoRoot);
    return { completed: true, askLandSleep: false, batch };
  }
  const nextIndex = batch.index + 1;
  if (nextIndex >= batch.queue.length) {
    const askLandSleep = Boolean(batch.askLandSleep);
    clearOperatorBatch(repoRoot);
    return { completed: true, askLandSleep, batch };
  }
  const next: OperatorBatchState = { ...batch, index: nextIndex };
  writeOperatorBatch(repoRoot, next);
  return {
    nextTicket: next.queue[nextIndex],
    completed: false,
    askLandSleep: false,
    batch: next,
  };
}
