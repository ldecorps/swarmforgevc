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
export const MAX_WORKERS = 6;
export const PER_WORKER_HEAP_MB = 1280;

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

// BL-792: MAX_WORKERS/PER_WORKER_HEAP_MB were sized against the reference
// 15360MB incident host and never actually checked against the REAL host's
// RAM anywhere - computeWorkerMemoryBudget above was exercised only by this
// module's own unit tests with a hardcoded 15360MB. A host with less RAM
// (this project's own dev/swarm box measures ~8192MB, shared with several
// resident swarm-agent processes) silently runs the full 6-worker x 1280MB
// footprint anyway, which does not fit: 6*1280=7680MB against a 4096MB safe
// budget on an 8192MB host. Neither cap is changed here - this derives how
// many of MAX_WORKERS actually fit the CALLER's real hostRamMB, capped at
// MAX_WORKERS and floored at 1 (a pool must always have at least one worker).
export function resolveWorkerPoolSize(hostRamMB: number, ceiling: number = MAX_WORKERS, perWorkerHeapMB: number = PER_WORKER_HEAP_MB): number {
  const safeCount = Math.floor((hostRamMB * SAFE_HOST_RAM_FRACTION) / perWorkerHeapMB);
  return Math.max(1, Math.min(ceiling, safeCount));
}

// BL-935: a full-forge pack on macOS runs 8 concurrent Claude sessions plus
// handoffd/front-desk on 2 physical cores before any test tooling starts -
// resolveWorkerPoolSize above sizes purely off RAM (BL-422/BL-792) and has
// no CPU-axis signal at all. This is a SECOND, independent ceiling, meant
// to be passed as resolveWorkerPoolSize's own `ceiling` argument (never a
// replacement for the memory floor) - composing the two there is what keeps
// invariant 1 ("this ticket adds a constraint, it does not relax one")
// structurally true rather than merely tested true.
export interface VitestForkCeilingInput {
  pack: string | undefined;
  platform: string;
  override?: string;
  defaultCeiling?: number;
}

const FULL_FORGE_PACK = 'full-forge';
const MACOS_PLATFORM = 'darwin';

// A positive integer only - "0", "-1", "1.5", "", whitespace-only, and any
// non-numeric text are all IGNORED (fall through to the pack rule), never
// floored to 1 or otherwise coerced. undefined (the override was never set)
// is the same "ignored" case, checked first so Number(undefined) (NaN) is
// never reached.
function parsePositiveIntOverride(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function resolveVitestForkCeiling({ pack, platform, override, defaultCeiling = MAX_WORKERS }: VitestForkCeilingInput): number {
  const parsedOverride = parsePositiveIntOverride(override);
  if (parsedOverride !== undefined) return parsedOverride;
  if (pack === FULL_FORGE_PACK && platform === MACOS_PLATFORM) return 1;
  return defaultCeiling;
}
