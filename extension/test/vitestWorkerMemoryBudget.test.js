const assert = require('node:assert/strict');
const {
  computeWorkerMemoryBudget,
  MAX_WORKERS,
  PER_WORKER_HEAP_MB,
  SAFE_HOST_RAM_FRACTION,
} = require('../out/tools/vitest-worker-memory-budget');

// ── computeWorkerMemoryBudget (pure) - BL-422 vitest-mem-budget-03 ─────────

test('a bounded config (2 workers x 2048MB on a 15360MB host) is reported within budget', () => {
  const result = computeWorkerMemoryBudget({ maxWorkers: 2, perWorkerHeapMB: 2048, hostRamMB: 15360 });
  assert.equal(result.totalMB, 4096);
  assert.equal(result.withinBudget, true);
});

test('an oversized config (8 workers x 4096MB on a 15360MB host) is reported over budget', () => {
  const result = computeWorkerMemoryBudget({ maxWorkers: 8, perWorkerHeapMB: 4096, hostRamMB: 15360 });
  assert.equal(result.totalMB, 32768);
  assert.equal(result.withinBudget, false);
});

test('totalMB is exactly maxWorkers times perWorkerHeapMB', () => {
  const result = computeWorkerMemoryBudget({ maxWorkers: 3, perWorkerHeapMB: 1024, hostRamMB: 15360 });
  assert.equal(result.totalMB, 3072);
});

test('a footprint exactly at the safe-fraction boundary is within budget (not a strict exceedance)', () => {
  const hostRamMB = 15360;
  const boundaryMB = hostRamMB * SAFE_HOST_RAM_FRACTION;
  const result = computeWorkerMemoryBudget({ maxWorkers: 1, perWorkerHeapMB: boundaryMB, hostRamMB });
  assert.equal(result.withinBudget, true);
});

test('one MB over the safe-fraction boundary is reported over budget', () => {
  const hostRamMB = 15360;
  const boundaryMB = hostRamMB * SAFE_HOST_RAM_FRACTION;
  const result = computeWorkerMemoryBudget({ maxWorkers: 1, perWorkerHeapMB: boundaryMB + 1, hostRamMB });
  assert.equal(result.withinBudget, false);
});

// ── exported caps - BL-422 vitest-mem-budget-01/02 ─────────────────────────

test('MAX_WORKERS is an explicit finite cap, not the CPU-count default', () => {
  assert.equal(typeof MAX_WORKERS, 'number');
  assert.ok(Number.isFinite(MAX_WORKERS));
  assert.ok(MAX_WORKERS > 0);
  // The reference incident host has 20 CPUs; a real cap must sit well below
  // that CPU-count default, not merely happen to be a number.
  assert.ok(MAX_WORKERS < 20);
});

test('PER_WORKER_HEAP_MB is an explicit finite per-worker heap cap', () => {
  assert.equal(typeof PER_WORKER_HEAP_MB, 'number');
  assert.ok(Number.isFinite(PER_WORKER_HEAP_MB));
  assert.ok(PER_WORKER_HEAP_MB > 0);
});

test('the exported caps themselves stay within the safe budget on the reference 15360MB host', () => {
  const result = computeWorkerMemoryBudget({ maxWorkers: MAX_WORKERS, perWorkerHeapMB: PER_WORKER_HEAP_MB, hostRamMB: 15360 });
  assert.equal(result.withinBudget, true);
});
