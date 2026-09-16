'use strict';

// BL-1579: a load-relative per-test timeout for the property lane's
// fixture-spawning tests (bl1343/bl1323), in the same shape the unit lane
// already uses (BL-871/BL-1007's contentionBudget.js) - reused unmodified,
// via its own supported injection points, rather than re-derived.
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
// would have caught: the lane's own resolved fork ceiling (known before any
// file loads - vitest.properties.config.mjs's WORKER_POOL_SIZE) does not
// lag the way the load average does. A single fork (a file run alone)
// contributes forks/QUIET_LOAD_CEILING = 0.25, under the factor>1
// threshold, so a lone file on a quiet host still resolves to the strict
// base (invariant 1) exactly as before this change.
const { resolveUnitLaneTimeout, sampleContentionFactor, usableFactor } = require('../../../specs/pipeline/steps/lib/contentionBudget');

const QUIET_LOAD_CEILING = 4;

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

function propertyLaneContentionFactor(opts = {}) {
  const loadFactor = usableFactor(sampleContentionFactor(opts.loadavg1mFn, () => QUIET_LOAD_CEILING));
  const forksFn = typeof opts.forksFn === 'function' ? opts.forksFn : forksFromEnv;
  const forks = Number(forksFn());
  const forkFactor = Number.isFinite(forks) && forks > 0 ? forks / QUIET_LOAD_CEILING : 0;
  const factor = Math.max(loadFactor ?? 0, forkFactor);
  return factor > 0 ? factor : null;
}

function propertyLaneTimeoutMs(baseMs, opts = {}) {
  return resolveUnitLaneTimeout(baseMs, { factor: propertyLaneContentionFactor(opts) }).effectiveMs;
}

module.exports = { propertyLaneTimeoutMs, propertyLaneContentionFactor, QUIET_LOAD_CEILING, FORKS_ENV_KEY };
