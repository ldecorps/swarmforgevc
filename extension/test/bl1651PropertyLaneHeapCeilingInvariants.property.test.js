'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { heapCeilingVerdict } = require('../out/tools/property-lane-heap-gate');
const {
  resolvePropertyLaneHeapMB,
  resolvePropertyLaneFileHeapCeilingMB,
  PER_WORKER_HEAP_MB,
  SAFE_HOST_RAM_FRACTION,
} = require('../out/tools/vitest-worker-memory-budget');

// BL-1651's two declared invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).

// ─── Invariant 1: "A property file that exceeds its heap ceiling fails as
// that file, by name, with its peak heap in the report; it never takes
// the worker or the lane down with it." ───────────────────────────────
//
// heapCeilingVerdict is the pure decision propertyLaneHeapGuardSetup.js's
// afterEach hook calls with process.memoryUsage().heapUsed - this
// generalizes it far past the acceptance feature's two fixed fixture
// scenarios (over vs. under the ceiling). The process-level half of the
// invariant (a crossing file fails BY NAME and the worker survives to run
// the next file) is what the acceptance feature's scenario 01 proves
// against a real spawned worker - a pure function cannot observe its own
// caller's process surviving, so that half is deliberately not re-proven
// here (BL-671's own split: decision table here, real-tool proof there).
//
// Generator reach: heapUsedMB is drawn both below and above ceilingMB
// (never only one side - a generator confined to one side could pass
// vacuously), and ceilingMB is drawn across the valid range PLUS the
// "no ceiling configured" band (<=0, NaN via Infinity's negation is not
// representable so a dedicated cell covers it) - four cells, each reached
// by construction via the cycled index below, never left to chance.
const RATIO_CELLS = ['under', 'at', 'over'];
const CEILING_CELLS = ['valid', 'unconfigured'];
const CELLS = RATIO_CELLS.flatMap((r) => CEILING_CELLS.map((c) => `${r}:${c}`));
const DRAWS = 60;

test('property (BL-1651 invariant 1): a file only fails the heap gate when a real ceiling is configured and its heap usage exceeds it, and the report always names both numbers', () => {
  const cellCoverage = {};
  for (let i = 0; i < DRAWS; i += 1) {
    const ratio = RATIO_CELLS[i % RATIO_CELLS.length];
    const ceilingKind = CEILING_CELLS[Math.floor(i / RATIO_CELLS.length) % CEILING_CELLS.length];
    const cell = `${ratio}:${ceilingKind}`;
    cellCoverage[cell] = (cellCoverage[cell] || 0) + 1;

    // A fresh, varied ceiling per draw (never one fixed number) so the
    // property covers the whole valid range, not one lucky boundary.
    const validCeilingMB = 100 + (i % 17) * 37;
    const ceilingMB = ceilingKind === 'unconfigured' ? [0, -5, -1][i % 3] : validCeilingMB;
    const effectiveCeiling = ceilingKind === 'unconfigured' ? ceilingMB : validCeilingMB;
    const heapUsedMB =
      ratio === 'under' ? effectiveCeiling - 10 - (i % 5) : ratio === 'at' ? effectiveCeiling : effectiveCeiling + 10 + (i % 5);

    const verdict = heapCeilingVerdict(heapUsedMB, ceilingMB);
    const expectedExceeded = ceilingKind === 'valid' && ratio === 'over';
    assert.equal(
      verdict.exceeded,
      expectedExceeded,
      `cell ${cell}: heapUsedMB=${heapUsedMB} ceilingMB=${ceilingMB} expected exceeded=${expectedExceeded}, got ${verdict.exceeded}`
    );
    if (verdict.exceeded) {
      assert.match(verdict.message, new RegExp(heapUsedMB.toFixed(1).replace('.', '\\.')), 'message must name the peak heap');
      assert.match(verdict.message, new RegExp(String(ceilingMB)), 'message must name the ceiling');
    } else {
      assert.equal(verdict.message, undefined);
    }
  }
  for (const cell of CELLS) {
    assert.ok((cellCoverage[cell] || 0) > 0, `cell ${cell} never reached over ${DRAWS} draws`);
  }
});

test('property (BL-1651 invariant 1) non-vacuity: heapCeilingVerdict is not a constant function', () => {
  assert.equal(heapCeilingVerdict(100, 200).exceeded, false);
  assert.equal(heapCeilingVerdict(300, 200).exceeded, true);
});

// ─── Invariant 2: "The per-worker heap cap the lane spawns with is
// derived from this host's memory and the resolved fork count so that
// forks times cap never exceeds the host's available memory at spawn,
// and the derivation is printed once per run." ─────────────────────────
//
// The "printed once" half is a real-process property the acceptance
// feature's scenario 03 proves by spawning the real config once and
// counting its own stdout line - a pure function has no process to
// observe printing from, so only the numeric half is generalized here.
// Generator reach: freeRamMB spans from far below a single worker's floor
// (the floor must bind) to generously above it (the derivation must
// bind instead) across a wide spread of fork counts, via fast-check's own
// arbitrary shrinking/exploration rather than a fixed cell list - this
// invariant is a single inequality over a continuous numeric domain, not
// a small enumerable shape the way invariant 1's decision table is.
test('property (BL-1651 invariant 2): forks times the derived cap never exceeds the safe fraction of free memory, unless the proven-safe floor binds', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 64 }),
      fc.integer({ min: 0, max: 200000 }),
      (forks, freeRamMB) => {
        const workerHeapMB = resolvePropertyLaneHeapMB(freeRamMB, forks);
        assert.ok(workerHeapMB >= PER_WORKER_HEAP_MB, `derived cap ${workerHeapMB} must never sit below the proven-safe floor ${PER_WORKER_HEAP_MB}`);
        const totalMB = forks * workerHeapMB;
        const safeBudgetMB = freeRamMB * SAFE_HOST_RAM_FRACTION;
        const floorBound = workerHeapMB === PER_WORKER_HEAP_MB;
        assert.ok(
          totalMB <= safeBudgetMB || floorBound,
          `forks(${forks}) * cap(${workerHeapMB}) = ${totalMB} exceeds the safe budget ${safeBudgetMB} (freeRamMB=${freeRamMB}) with the floor not binding`
        );
        // The per-file gate ceiling always sits strictly below the
        // worker's own cap - the headroom this whole mechanism exists for.
        const fileCeilingMB = resolvePropertyLaneFileHeapCeilingMB(workerHeapMB);
        assert.ok(fileCeilingMB < workerHeapMB, `file ceiling ${fileCeilingMB} must sit below the worker cap ${workerHeapMB}`);
        assert.ok(fileCeilingMB > 0, 'file ceiling must be positive');
      }
    ),
    { numRuns: 200 }
  );
});

test('property (BL-1651 invariant 2) non-vacuity: the derived cap actually varies with free memory and fork count, never a constant', () => {
  const small = resolvePropertyLaneHeapMB(2000, 20);
  const large = resolvePropertyLaneHeapMB(200000, 2);
  assert.notEqual(small, large);
  assert.equal(small, PER_WORKER_HEAP_MB, 'a tight host with many forks must fall back to the floor');
  assert.ok(large > PER_WORKER_HEAP_MB, 'a generous host with few forks must exceed the floor');
});
