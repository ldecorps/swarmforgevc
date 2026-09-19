/**
 * BL-1651: the property lane's per-file heap ceiling gate's pure decision.
 * Five parcels' property lanes crashed on the V8 per-worker heap cap
 * mid-file (FATAL ERROR: JavaScript heap out of memory) with no file name
 * and no number in the report. This is the ONE decision a worker-resident
 * afterEach hook (extension/test/helpers/propertyLaneHeapGuardSetup.js)
 * calls with process.memoryUsage().heapUsed - kept pure so it is unit- and
 * property-testable without spawning a real vitest worker, mirroring
 * check-suite-file-budget.ts's own gate-as-pure-function shape.
 */

export interface HeapCeilingVerdict {
  exceeded: boolean;
  message?: string;
}

// ceilingMB <= 0 or non-finite means no ceiling is configured (the env key
// absent, e.g. outside the property lane entirely) - never exceeded, the
// gate is simply off. A heapUsedMB exactly at the ceiling is NOT exceeded
// (the ceiling is the last MB still inside budget, same "<=, not <" posture
// computeWorkerMemoryBudget already uses for its own boundary).
export function heapCeilingVerdict(heapUsedMB: number, ceilingMB: number): HeapCeilingVerdict {
  if (!Number.isFinite(ceilingMB) || ceilingMB <= 0) return { exceeded: false };
  if (!Number.isFinite(heapUsedMB) || heapUsedMB <= ceilingMB) return { exceeded: false };
  return {
    exceeded: true,
    message: `PROPERTY_LANE_HEAP_CEILING_EXCEEDED: heapUsed ${heapUsedMB.toFixed(1)}MB exceeds the per-file ceiling ${ceilingMB}MB`,
  };
}
