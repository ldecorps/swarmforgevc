'use strict';

// BL-1579: a load-relative per-test timeout for the property lane's
// fixture-spawning tests (bl1343/bl1323; BL-1592 added bl1375/bl1309/
// bl1389/bl1529), in the same shape the unit lane already uses
// (BL-871/BL-1007's contentionBudget.js) - reused unmodified, via its own
// supported injection points, rather than re-derived.
//
// contentionBudgetSetup.js (the unit lane's setupFile) samples
// `loadavg / cpuCount` and only scales past `factor > 1` - right for sizing
// a worker POOL against this host's real 20 cores, but wrong for "is this
// box busy enough right now to slow a subprocess-heavy test": 20 cores means
// that factor stays under 1 well past the point real contention already
// timed these tests out. Measured this ticket (2026-09-15, evidence
// backlog/evidence/BL-1579-*.md): idle 1-minute load on this host sits
// 2.3-3.6; a single concurrent `npm test` run alone pushed it to 7-10 and
// reproduced both files' 20s-timeout reds. QUIET_LOAD_CEILING is that idle
// band, rounded up - the denominator this lane's own contention is actually
// sensitive to, supplied through resolveUnitLaneTimeout's existing
// `cpuCountFn` injection (never a copy of its math).
//
// BL-1588: the load average above lags the lane's own ramp by up to a
// minute, and vitest's own sequencer runs unknown/failed/larger files FIRST
// (BaseSequencer.sort) - so a fixture-spawning file can be running while the
// lane's forks are ALL busy and the 1-minute average still reads the
// pre-run quiet band. A second factor, forks/QUIET_LOAD_CEILING, is folded
// in by max() so neither reading can under-report contention the other
// would have caught.
//
// BL-1588 architect bounce (2026-09-16): "forks" must NOT be the lane's
// static pool CEILING (vitest.properties.config.mjs's WORKER_POOL_SIZE,
// resolved from host RAM/cores alone - identical whether the invocation
// targets 408 files or 1). Publishing that ceiling unconditionally violated
// invariant 1 on any host with enough free cores/RAM: a genuinely lone-file
// run on a 20-core review host resolved forks=12, forkFactor=3, and a
// declared-strict-20s run silently received 60000ms. The signal that
// actually distinguishes "many files, lane concurrency in play" from "one
// file, alone" is how many explicit file arguments the invoking command
// line named - see resolveLaneForks below - never the pool's own sizing.
const {
  resolveUnitLaneTimeout,
  sampleContentionFactor,
  usableFactor,
  UNIT_LANE_BUDGET_CEILING_MS,
} = require('../../../specs/pipeline/steps/lib/contentionBudget');

const QUIET_LOAD_CEILING = 4;

// BL-1606: resolveUnitLaneTimeout's own effectiveBudgetMs is
// min(ceilingMs, base * max(1, factor)) - passing NO ceilingMs (as this
// module did before) defaults to the unit lane's shared
// UNIT_LANE_BUDGET_CEILING_MS (120000), a FIXED ceiling under some
// property bases (BL-1450 set bl968MaterializedGuardSensitivity's base to
// 240000 after 120000 was hit twice under real pooled load). A fixed
// ceiling below a file's own base means any factor >= 1 clamps the result
// to the ceiling - HALF the declared budget, under the exact load the
// budget-scaling exists to survive, and never below the base only by
// accident (whenever the ceiling itself happens to sit above it).
//
// The fix: the ceiling this lane supplies is never fixed - it grows with
// the base itself, `max(UNIT_LANE_BUDGET_CEILING_MS, baseMs *
// PROPERTY_LANE_MAX_GROWTH)`, so a base under the shared ceiling keeps
// today's exact arithmetic (the ceiling is unchanged, 120000) and a base
// at or above it gains the same multiplicative headroom every other base
// already has. PROPERTY_LANE_MAX_GROWTH is the worst contention factor
// this host has measured (2.7 at load 10.8, BL-1579's own evidence; 12
// forks resolves exactly 3.0) - never a copy of effectiveBudgetMs's math,
// only its existing ceilingMs injection point.
const PROPERTY_LANE_MAX_GROWTH = 3;

// vitest.properties.config.mjs sets this to its own resolved WORKER_POOL_SIZE
// before any worker fork spawns - the lane's real concurrency ceiling, known
// in the main process at config-load time. A worker reads it back through
// this same key; unset (the module required outside the configured lane,
// e.g. a plain unit test) reads as a single fork, never a multiplier this
// file did not measure.
const FORKS_ENV_KEY = 'SWARMFORGE_PROPERTY_LANE_FORKS';

function forksFromEnv() {
  const n = Number(process.env[FORKS_ENV_KEY]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// The number of explicit test-file arguments on the vitest CLI invocation,
// e.g. `vitest run --config <cfg> test/a.js test/b.js` -> 2; `vitest run
// --config <cfg>` (no filter, the full lane) -> 0. `--config`'s own value
// is the one flag this lane's invocations ever pass with a value, so it is
// the only one skipped by name; any other `-`-prefixed token is a bare
// flag, never counted as a file.
function explicitFileArgCount(argv) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  let count = 0;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--config') {
      i += 1; // skip its value
      continue;
    }
    if (a === 'run' || (typeof a === 'string' && a.startsWith('-'))) continue;
    count += 1;
  }
  return count;
}

// The lane's real concurrency signal for propertyLaneTimeoutMs's forks
// input: the pool ceiling only when more than one file could actually be
// running concurrently (0 explicit files = the full lane's own glob, >1 =
// several named together); exactly one explicit file is indistinguishable
// from a genuinely solo run, so it is forced to 1 regardless of how large
// the host-sized pool ceiling resolved.
function resolveLaneForks(argv, poolSize) {
  return explicitFileArgCount(argv) === 1 ? 1 : poolSize;
}

function propertyLaneContentionFactor(opts = {}) {
  const loadFactor = usableFactor(sampleContentionFactor(opts.loadavg1mFn, () => QUIET_LOAD_CEILING));
  const forksFn = typeof opts.forksFn === 'function' ? opts.forksFn : forksFromEnv;
  const forks = Number(forksFn());
  const forkFactor = Number.isFinite(forks) && forks > 0 ? forks / QUIET_LOAD_CEILING : 0;
  const factor = Math.max(loadFactor ?? 0, forkFactor);
  return factor > 0 ? factor : null;
}

function propertyLaneTimeoutMs(baseMs, opts = {}) {
  const ceilingMs = Math.max(UNIT_LANE_BUDGET_CEILING_MS, Number(baseMs) * PROPERTY_LANE_MAX_GROWTH);
  return resolveUnitLaneTimeout(baseMs, { factor: propertyLaneContentionFactor(opts), ceilingMs }).effectiveMs;
}

module.exports = {
  propertyLaneTimeoutMs,
  propertyLaneContentionFactor,
  QUIET_LOAD_CEILING,
  PROPERTY_LANE_MAX_GROWTH,
  FORKS_ENV_KEY,
  explicitFileArgCount,
  resolveLaneForks,
};
