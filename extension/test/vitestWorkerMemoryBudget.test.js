const assert = require('node:assert/strict');
const {
  computeWorkerMemoryBudget,
  resolveWorkerPoolSize,
  resolveVitestForkCeiling,
  resolveVitestWorkerPool,
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

// ── resolveWorkerPoolSize (pure) - BL-792 ───────────────────────────────────
// MAX_WORKERS/PER_WORKER_HEAP_MB were never actually checked against a REAL
// host's RAM anywhere in the production path (only against a hardcoded
// 15360MB in this file's own tests above) - a smaller real host silently ran
// the full footprint anyway. resolveWorkerPoolSize is what vitest.config.mjs
// now calls instead of reading MAX_WORKERS directly.

test('on the 15360MB reference host, resolves to the full MAX_WORKERS ceiling (unchanged behavior)', () => {
  assert.equal(resolveWorkerPoolSize(15360), MAX_WORKERS);
});

test('on a 4096MB host, shrinks below the ceiling to fit the safe budget', () => {
  // BL-1348: PER_WORKER_HEAP_MB dropped from 1280 to 640 (measured 298MB
  // peak, real margin) - an 8192MB host no longer demonstrates a shrink
  // below MAX_WORKERS=6 at all (floor(8192*0.5/640) is exactly 6), so this
  // moved to a smaller host that still genuinely clamps below the ceiling.
  // floor(4096 * 0.5 / 640) = 3
  assert.equal(resolveWorkerPoolSize(4096), 3);
});

test('never resolves below 1, even on a host too small to fit even one worker heap', () => {
  assert.equal(resolveWorkerPoolSize(100), 1);
});

test('never resolves above the ceiling, even on a host with abundant RAM', () => {
  assert.equal(resolveWorkerPoolSize(100000), MAX_WORKERS);
});

test('respects an explicit ceiling/perWorkerHeapMB override rather than only the module defaults', () => {
  assert.equal(resolveWorkerPoolSize(4096, 2, 1024), 2);
});

// ── resolveVitestForkCeiling (pure) - BL-935 ────────────────────────────────
// A second, independent (CPU-axis) ceiling layered alongside the memory
// budget via resolveWorkerPoolSize's existing `ceiling` parameter - never a
// replacement for it. Precedence (ticket's own table):
//   1. an explicit positive-integer override replaces the pack rule
//   2. otherwise, full-forge pack on macOS -> 1
//   3. otherwise, the module default ceiling (MAX_WORKERS), unchanged
// The composed clamp-to-memory-and-floor-at-1 step is resolveWorkerPoolSize's
// own job, exercised separately above - this function only ever answers
// "what ceiling to hand it", never applies the memory floor itself.

test('a full-forge pack on macOS resolves the ceiling to 1', () => {
  assert.equal(resolveVitestForkCeiling({ pack: 'full-forge', platform: 'darwin' }), 1);
});

test('a full-forge pack on a non-macOS platform does not lower the ceiling', () => {
  assert.equal(resolveVitestForkCeiling({ pack: 'full-forge', platform: 'linux' }), MAX_WORKERS);
});

test('a non-full-forge pack on macOS does not lower the ceiling', () => {
  assert.equal(resolveVitestForkCeiling({ pack: 'mono-router', platform: 'darwin' }), MAX_WORKERS);
});

test('no pack at all (a solo human, SWARMFORGE_PACK unset) does not lower the ceiling', () => {
  assert.equal(resolveVitestForkCeiling({ pack: undefined, platform: 'darwin' }), MAX_WORKERS);
});

test('an explicit positive-integer override replaces the pack rule, even under full-forge on macOS', () => {
  assert.equal(resolveVitestForkCeiling({ pack: 'full-forge', platform: 'darwin', override: '2' }), 2);
});

test('an explicit override also applies with no pack rule in play', () => {
  assert.equal(resolveVitestForkCeiling({ pack: undefined, platform: 'darwin', override: '5' }), 5);
});

for (const bad of ['0', '-1', 'nope', '', '1.5', '  ']) {
  test(`a non-positive or non-numeric override (${JSON.stringify(bad)}) is ignored, not floored`, () => {
    assert.equal(resolveVitestForkCeiling({ pack: 'full-forge', platform: 'darwin', override: bad }), 1);
    assert.equal(resolveVitestForkCeiling({ pack: undefined, platform: 'darwin', override: bad }), MAX_WORKERS);
  });
}

test('override absent (undefined) falls through to the pack rule, same as an ignored malformed value', () => {
  assert.equal(resolveVitestForkCeiling({ pack: 'full-forge', platform: 'darwin', override: undefined }), 1);
});

test('the resolved ceiling is never below 1 for any combination of inputs', () => {
  for (const pack of ['full-forge', 'mono-router', undefined]) {
    for (const platform of ['darwin', 'linux']) {
      for (const override of [undefined, '0', '-3', 'x', '1']) {
        assert.ok(resolveVitestForkCeiling({ pack, platform, override }) >= 1);
      }
    }
  }
});

// ── resolveVitestWorkerPool (pure) - BL-935 cleaner pass ────────────────────
// The one route both vitest lanes now take. These assert it is EXACTLY the
// composition the two configs each used to spell out for themselves, so the
// DRY move is pinned as behavior-preserving rather than merely believed to
// be: any drift between this and resolveWorkerPoolSize(ram, ceiling) fails
// here instead of silently resizing a lane's pool.

test('resolveVitestWorkerPool equals resolveWorkerPoolSize composed with resolveVitestForkCeiling, across the decision table', () => {
  const RAMS = [0, 512, 2048, 8192, 15360, 65536];
  const PACKS = ['full-forge', 'mono-router', undefined];
  const PLATFORMS = ['darwin', 'linux'];
  const OVERRIDES = [undefined, '', 'abc', '0', '-5', '1', '4', '99'];
  for (const hostRamMB of RAMS) {
    for (const pack of PACKS) {
      for (const platform of PLATFORMS) {
        for (const override of OVERRIDES) {
          const expected = resolveWorkerPoolSize(hostRamMB, resolveVitestForkCeiling({ pack, platform, override }));
          assert.equal(
            resolveVitestWorkerPool({ pack, platform, override, hostRamMB }),
            expected,
            `pack=${pack} platform=${platform} override=${override} ram=${hostRamMB}`
          );
        }
      }
    }
  }
});

test('a full-forge pack on macOS resolves the pool to exactly 1, at every host RAM size', () => {
  for (const hostRamMB of [0, 512, 2048, 8192, 15360, 65536]) {
    assert.equal(resolveVitestWorkerPool({ pack: 'full-forge', platform: 'darwin', hostRamMB }), 1);
  }
});

test('the resolved pool is never below 1, including absent/malformed/zero/negative overrides', () => {
  for (const hostRamMB of [0, 1, 512, 15360]) {
    for (const override of [undefined, '', 'abc', '0', '-5']) {
      assert.ok(resolveVitestWorkerPool({ pack: undefined, platform: 'linux', override, hostRamMB }) >= 1);
    }
  }
});

test('an explicit defaultCeiling is carried through the composition, not dropped', () => {
  assert.equal(resolveVitestWorkerPool({ pack: undefined, platform: 'linux', defaultCeiling: 2, hostRamMB: 15360 }), 2);
});
