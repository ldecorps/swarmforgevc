'use strict';

// BL-932: the ONE declaration of the property lane's "outer per-test
// timeout" (test()'s third argument) for a property that spawns real
// subprocesses across many numRuns. BL-871 established the treatment - see
// bl760DuplicateChainGuard.property.test.js, bl787NamedTunnelInvariants
// .property.test.js and bl797MutationGateProbeCrashFallback.property.test.js
// for each adopter's own measured-cost narrative. All three (and now
// onboarderLauncherPidGuard.property.test.js) previously hand-copied this
// same 240000 value into their own file; adopting a fourth file by copying
// the line again was the wrong direction (BL-932), so it moved here and
// every adopter imports it instead.
const SUBPROCESS_HEAVY_TIMEOUT_MS = 240000;

module.exports = { SUBPROCESS_HEAVY_TIMEOUT_MS };
