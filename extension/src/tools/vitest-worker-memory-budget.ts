/**
 * BL-422: caps the vitest worker pool and per-worker heap so a test run's
 * worst-case memory footprint is bounded instead of sizing to the CPU-count
 * default with no per-worker heap limit. One run ballooned four workers to
 * ~13GB on a 15GB box and drove the kernel OOM-killer into a death-spiral
 * that killed swarm agents twice in one day. Exported here (not buried only
 * inside vitest.config.mjs) so both the config AND a unit test read the same
 * values - mirrors check-suite-file-budget.ts's pattern.
 *
 * Stryker's vitest-runner hardcodes pool:'threads' + maxThreads:1
 * (engineering.prompt's worker-thread rule) and overrides these caps
 * entirely - mutation runs were never the offender and are unaffected by
 * this ticket.
 */

// The one named place for both cap numbers. A small maxForks with a modest
// per-worker heap keeps the full suite green while bounding the worst case
// well under the reference 15360MB host - see vitestWorkerMemoryBudget.test.js's
// own "the exported caps stay within budget" assertion.
export const MAX_WORKERS = 2;
export const PER_WORKER_HEAP_MB = 2048;

// Worst-case footprint must stay within this fraction of the host's total
// RAM, leaving headroom for the OS and every other swarm agent process
// sharing the same box - not the whole box, which is what actually spiralled.
export const SAFE_HOST_RAM_FRACTION = 0.5;

export interface WorkerMemoryBudgetInput {
  maxWorkers: number;
  perWorkerHeapMB: number;
  hostRamMB: number;
}

export interface WorkerMemoryBudgetResult {
  totalMB: number;
  withinBudget: boolean;
}

// Pure: BL-422 vitest-mem-budget-03's whole decision table. A footprint
// exactly at the safe-fraction boundary counts as within budget (<=, not <)
// - the boundary is a chosen safety margin, not a strict inequality to
// tiptoe around.
export function computeWorkerMemoryBudget({ maxWorkers, perWorkerHeapMB, hostRamMB }: WorkerMemoryBudgetInput): WorkerMemoryBudgetResult {
  const totalMB = maxWorkers * perWorkerHeapMB;
  const budgetMB = hostRamMB * SAFE_HOST_RAM_FRACTION;
  return { totalMB, withinBudget: totalMB <= budgetMB };
}
