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
  // BL-1336: the swarm's rotation mode, exported into the role env by
  // swarmforge.sh beside SWARMFORGE_PACK. Undefined outside a swarm, which is
  // the ordinary developer case and behaves exactly as before.
  rotation?: string;
}

const FULL_FORGE_PACK = 'full-forge';
const MACOS_PLATFORM = 'darwin';
const ROUTER_ROTATION = 'router';

// BL-1336, human ruling: a FIXED ceiling above the default, with the memory
// budget still the binding cap. Fixed rather than derived from the host's core
// count on purpose - deriving would make this function host-sensitive, which
// turns a deterministic unit test into a flaky one, and the RAM budget below
// is what actually protects a small host either way.
//
// Why a router pack may run wider at all: under `config rotation router` the
// launcher starts the coordinator and ONE resident pane that rotates in place
// through the pipeline roles; every other role is a dormant launch artifact
// with no session and no process. A vitest run inside the resident contends
// with the coordinator alone, not with seven sibling role sessions - and that
// sibling contention is the only thing this CPU ceiling exists to guard
// against.
export const ROUTER_FORK_CEILING = 10;

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

export function resolveVitestForkCeiling({
  pack,
  platform,
  override,
  defaultCeiling = MAX_WORKERS,
  rotation,
}: VitestForkCeilingInput): number {
  const parsedOverride = parsePositiveIntOverride(override);
  if (parsedOverride !== undefined) return parsedOverride;
  // The full-forge-on-darwin ceiling is untouched by BL-1336 and stays ahead
  // of the router rule: that pack is not a router pack, so the two can never
  // both apply, and keeping the order explicit means a future router variant
  // of full-forge could not silently widen it.
  if (pack === FULL_FORGE_PACK && platform === MACOS_PLATFORM) return 1;
  // Keyed on ROTATION, never on pack names: router packs are not a fixed
  // enum and new ones are minted regularly, so a name-matching predicate
  // would silently miss every future one.
  if (rotation === ROUTER_ROTATION) return ROUTER_FORK_CEILING;
  return defaultCeiling;
}

// BL-935 cleaner pass: both vitest lanes composed the ceiling and the
// memory-derived pool size themselves, in eight identical lines each
// (vitest.config.mjs and vitest.properties.config.mjs). That duplication was
// the whole risk invariant 3 names - "neither lane may size its pool by a
// route the other does not share" - and a duplicated composition can only be
// KEPT true by parallel maintenance, which is exactly the drift the property
// test cannot see (a property over the pure function cannot distinguish
// "both configs compose it the same way" from "one config was miswired").
// Composing once here makes invariant 3 true BY CONSTRUCTION: there is one
// route, so there is nothing for a second lane to diverge from. Kept pure -
// every environment input (pack, platform, override, hostRamMB) is passed in
// by the caller, so this stays unit-testable with no process.env or os read
// inside the module (engineering.prompt's design-and-testability rule).
export interface VitestWorkerPoolInput extends VitestForkCeilingInput {
  hostRamMB: number;
}

export function resolveVitestWorkerPool({ pack, platform, override, defaultCeiling, hostRamMB, rotation }: VitestWorkerPoolInput): number {
  // resolveWorkerPoolSize takes the MINIMUM of the RAM-derived size and this
  // ceiling, so a raised ceiling can never widen the pool past what the host's
  // memory allows (BL-1336 invariant 2, BL-422/BL-792's floor untouched).
  return resolveWorkerPoolSize(hostRamMB, resolveVitestForkCeiling({ pack, platform, override, defaultCeiling, rotation }));
}
