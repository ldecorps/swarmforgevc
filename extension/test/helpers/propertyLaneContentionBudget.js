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
const { resolveUnitLaneTimeout } = require('../../../specs/pipeline/steps/lib/contentionBudget');

const QUIET_LOAD_CEILING = 4;

function propertyLaneTimeoutMs(baseMs) {
  return resolveUnitLaneTimeout(baseMs, { cpuCountFn: () => QUIET_LOAD_CEILING }).effectiveMs;
}

module.exports = { propertyLaneTimeoutMs, QUIET_LOAD_CEILING };
