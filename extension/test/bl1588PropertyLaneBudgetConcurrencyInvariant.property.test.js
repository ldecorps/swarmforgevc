'use strict';

// BL-1588's declared invariant (property authorship rests with the coder,
// first pass - BL-654): "A property test that runs alone on a quiet host
// (1-minute load at or under the quiet ceiling, one fork) receives the same
// 20 s budget before and after this change: the budget grows only with
// measured concurrency or load, never by a bare raise."
//
// Pure in-process check of propertyLaneTimeoutMs (BL-1541 shape, same as
// scenario 03's own budget check) - no subprocess, no git fixture, no lane
// spawn: the function under test IS the mechanism the invariant quantifies
// over, and both its inputs (forks, load) are injected via its own DI seams
// (forksFn/loadavg1mFn) rather than sampled from this host, so the drawn
// cases are exactly the states the invariant is about, not a hoped-for
// approximation of them.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  propertyLaneTimeoutMs,
  QUIET_LOAD_CEILING,
  FORKS_ENV_KEY,
  explicitFileArgCount,
  resolveLaneForks,
} = require('./helpers/propertyLaneContentionBudget');

const BASE_MS = 20000;

// Realistic argv shape this lane is actually invoked with (probed live,
// 2026-09-16): `node <vitest-bin> run --config <cfg> [file ...]`. Built
// from a file COUNT rather than random file content - explicitFileArgCount
// counts positional arguments, it never reads what they name.
const NODE_AND_BIN = ['/usr/bin/node', '/repo/node_modules/.bin/vitest'];
const FILE_NAMES = ['test/a.property.test.js', 'test/b.property.test.js', 'test/c.property.test.js'];
const configArgv = (fileCount, extraFlags = []) => [
  ...NODE_AND_BIN,
  'run',
  '--config',
  'vitest.properties.config.mjs',
  ...extraFlags,
  ...FILE_NAMES.slice(0, fileCount),
];
const flagArb = fc.constantFrom('--reporter=verbose', '--silent', '--no-color', '--bail');

test('BL-1588/BL-654 invariant: one fork on a quiet host keeps the strict base; the budget never grows without measured concurrency or load', () => {
  // A file run alone (one fork) on a quiet host (load at or under the
  // ceiling) receives EXACTLY the base - the literal invariant, for the
  // whole quiet band, not one sampled point in it.
  fc.assert(
    fc.property(fc.float({ min: 0, max: QUIET_LOAD_CEILING, noNaN: true }), (load) => {
      const ms = propertyLaneTimeoutMs(BASE_MS, {
        forksFn: () => 1,
        loadavg1mFn: () => load,
      });
      assert.equal(ms, BASE_MS, `forks=1, load=${load} (quiet) raised the budget to ${ms}`);
    }),
    { numRuns: 50 },
  );

  // The budget is never BELOW base for any forks/load - "grows only", never
  // a bare lowering either.
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 64 }),
      fc.float({ min: 0, max: 100, noNaN: true }),
      (forks, load) => {
        const ms = propertyLaneTimeoutMs(BASE_MS, {
          forksFn: () => forks,
          loadavg1mFn: () => load,
        });
        assert.ok(ms >= BASE_MS, `forks=${forks}, load=${load} dropped the budget below base: ${ms}`);
      },
    ),
    { numRuns: 100 },
  );

  // Busier than the quiet ceiling STRICTLY raises the budget above base, and
  // MORE forks strictly raises it further - growth tracks the measured
  // concurrency, so a broken implementation that folds forks in as a no-op
  // (a bare raise independent of the input, or none at all) cannot pass
  // this: with a quiet load held fixed, only the forks term can be moving
  // the number at all. The [5, 24] band keeps both sides clear of the
  // absolute ceiling, where the linear step would otherwise clamp and two
  // draws could tie for a reason unrelated to the defect this guards.
  fc.assert(
    fc.property(
      fc.integer({ min: 5, max: 24 }),
      fc.integer({ min: 5, max: 24 }),
      (a, b) => {
        fc.pre(a !== b);
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const loMs = propertyLaneTimeoutMs(BASE_MS, { forksFn: () => lo, loadavg1mFn: () => 1.8 });
        const hiMs = propertyLaneTimeoutMs(BASE_MS, { forksFn: () => hi, loadavg1mFn: () => 1.8 });
        assert.ok(loMs > BASE_MS, `${lo} forks past the quiet ceiling did not raise the budget above base: ${loMs}`);
        assert.ok(hiMs > loMs, `${hi} forks (${hiMs}ms) did not budget more than ${lo} forks (${loMs}ms)`);
      },
    ),
    { numRuns: 50 },
  );
});

// BL-1606's declared invariant 1 (property authorship rests with the
// coder, first pass - BL-654): "The property lane's per-test budget never
// resolves below the base the test declares, at any published fork count
// and any load: a lane-level ceiling caps growth, never the base." The
// test above only ever drove BASE_MS=20000 (fixed) - a base at or above
// the shared UNIT_LANE_BUDGET_CEILING_MS (120000) is exactly the state
// that test never covered, and exactly the state BL-1606 found broken
// (240000's base, once factor >= 1, clamped to the FIXED 120000 ceiling
// propertyLaneTimeoutMs passed through unmodified - half the declared
// budget). This generalizes the "never below base" half of the invariant
// across the whole base range BL-1596's census actually uses.
//
// Non-vacuity, proven by hand: reverted propertyLaneTimeoutMs to call
// resolveUnitLaneTimeout without a ceilingMs override (the pre-fix shape)
// - this property failed immediately for a base at or above 120000 with
// forks/load producing factor >= 1 (e.g. base=240000, forks=9). Restored
// and reconfirmed green.
test('BL-1606 invariant 1: the budget never resolves below the base, for every base 20000-300000 and every fork count 1-64', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 20000, max: 300000 }),
      fc.integer({ min: 1, max: 64 }),
      fc.float({ min: 0, max: 100, noNaN: true }),
      (base, forks, load) => {
        const ms = propertyLaneTimeoutMs(base, { forksFn: () => forks, loadavg1mFn: () => load });
        assert.ok(ms >= base, `base=${base}, forks=${forks}, load=${load} resolved below base: ${ms}`);
      }
    ),
    { numRuns: 200 },
  );
});

// BL-1588 architect bounce (2026-09-16): the property above injects
// forksFn directly, so it never observes what the REAL
// vitest.properties.config.mjs -> env-var -> forksFromEnv() wiring
// actually publishes. WORKER_POOL_SIZE is the lane's static pool CEILING
// (sized from host RAM/cores alone, identical for 408 files or 1) - a
// genuinely solo run on a host with enough free capacity resolved a
// >1 pool ceiling and silently received more than the declared-strict
// base. explicitFileArgCount/resolveLaneForks are the fix: exactly one
// explicit file forces forks=1 regardless of the pool ceiling; 0 (the
// full lane's own glob) or >1 still uses it.
test('BL-1588 architect bounce: explicitFileArgCount counts positional file arguments, never a flag or --config value', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: FILE_NAMES.length }), fc.array(flagArb, { maxLength: 3 }), (fileCount, flags) => {
      const argv = configArgv(fileCount, flags);
      assert.equal(
        explicitFileArgCount(argv),
        fileCount,
        `argv ${JSON.stringify(argv)} counted ${explicitFileArgCount(argv)} files, expected ${fileCount}`
      );
    }),
    { numRuns: 50 },
  );
});

test('BL-1588 architect bounce: resolveLaneForks forces 1 for exactly one explicit file, regardless of the pool ceiling', () => {
  fc.assert(
    fc.property(fc.integer({ min: 2, max: 64 }), (poolSize) => {
      const solo = resolveLaneForks(configArgv(1), poolSize);
      assert.equal(solo, 1, `a single explicit file used the pool ceiling (${poolSize}) instead of forcing 1: got ${solo}`);
    }),
    { numRuns: 30 },
  );

  // 0 (the full lane's own glob) or >1 named together: the pool ceiling is
  // the real concurrency signal for THOSE shapes, so it is used as-is -
  // never forced down to 1 just because a fix exists for the solo case.
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: FILE_NAMES.length }).filter((n) => n !== 1),
      fc.integer({ min: 2, max: 64 }),
      (fileCount, poolSize) => {
        const forks = resolveLaneForks(configArgv(fileCount), poolSize);
        assert.equal(
          forks,
          poolSize,
          `${fileCount} explicit files did not use the pool ceiling ${poolSize}: got ${forks}`
        );
      },
    ),
    { numRuns: 30 },
  );
});

test('BL-1588 architect bounce: a genuinely solo invocation keeps the strict base through the REAL forksFromEnv() wiring, even under a large pool ceiling', () => {
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, FORKS_ENV_KEY);
  const before = process.env[FORKS_ENV_KEY];
  try {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 64 }), (largePoolSize) => {
        // The exact sequence vitest.properties.config.mjs runs at config
        // load, for a solo single-file invocation: resolve forks, publish
        // to the env key, then propertyLaneTimeoutMs (no forksFn override,
        // called as a worker actually calls it) reads it back for real.
        process.env[FORKS_ENV_KEY] = String(resolveLaneForks(configArgv(1), largePoolSize));
        const ms = propertyLaneTimeoutMs(BASE_MS, { loadavg1mFn: () => 1.8 });
        assert.equal(
          ms,
          BASE_MS,
          `a solo invocation with pool ceiling ${largePoolSize} received ${ms}ms through the real env wiring, not the strict base`
        );
      }),
      { numRuns: 30 },
    );

    // The inverse, same real wiring: several files named together (or the
    // full lane's own glob, fileCount 0) DOES let the pool ceiling raise
    // the budget - the fix narrows the signal, it does not disable it.
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 24 }), (largePoolSize) => {
        process.env[FORKS_ENV_KEY] = String(resolveLaneForks(configArgv(0), largePoolSize));
        const ms = propertyLaneTimeoutMs(BASE_MS, { loadavg1mFn: () => 1.8 });
        assert.ok(
          ms > BASE_MS,
          `the full lane's own glob (0 explicit files) with pool ceiling ${largePoolSize} did not raise the budget above base: ${ms}`
        );
      }),
      { numRuns: 30 },
    );
  } finally {
    if (hadKey) {
      process.env[FORKS_ENV_KEY] = before;
    } else {
      delete process.env[FORKS_ENV_KEY];
    }
  }
});

// BL-1588 hardener pass (2026-09-16): forksFromEnv()'s own fallback - what
// forks resolves to when SWARMFORGE_PROPERTY_LANE_FORKS is UNSET, e.g. this
// module required outside vitest.properties.config.mjs's own load (a plain
// unit test, or a worker that started before the config's env write landed)
// - had zero coverage. Every test above either injects forksFn directly or
// sets the env key itself, so a hand mutant changing the fallback from 1 to
// 5 (forkFactor 5/4 = 1.25, past the scaling threshold) survived every
// existing assertion. The header comment on forksFromEnv's call site already
// declares the invariant ("unset ... reads as a single fork, never a
// multiplier this file did not measure"); this pins it.
test('BL-1588 hardener: an unset FORKS_ENV_KEY resolves through forksFromEnv() to a single fork, not a multiplier', () => {
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, FORKS_ENV_KEY);
  const before = process.env[FORKS_ENV_KEY];
  try {
    delete process.env[FORKS_ENV_KEY];
    fc.assert(
      fc.property(fc.float({ min: 0, max: QUIET_LOAD_CEILING, noNaN: true }), (load) => {
        // No forksFn override: propertyLaneTimeoutMs falls through to the
        // module's real forksFromEnv(), which must read the now-deleted key
        // as absent and default to 1, not any larger fallback.
        const ms = propertyLaneTimeoutMs(BASE_MS, { loadavg1mFn: () => load });
        assert.equal(
          ms,
          BASE_MS,
          `unset ${FORKS_ENV_KEY} with quiet load=${load} raised the budget to ${ms} via forksFromEnv()'s fallback`
        );
      }),
      { numRuns: 30 },
    );
  } finally {
    if (hadKey) {
      process.env[FORKS_ENV_KEY] = before;
    } else {
      delete process.env[FORKS_ENV_KEY];
    }
  }
});
