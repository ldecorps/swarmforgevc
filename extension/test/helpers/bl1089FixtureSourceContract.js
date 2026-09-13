'use strict';

// BL-1502: the single implementation of the BL-1089 fixture-source contract.
//
// extension/test/bl1089FrontDeskLivenessFixture.property.test.js and
// specs/pipeline/steps/bl1502FixtureSourceContractFollowsFixtureSteps.js both
// evaluate this SAME predicate over the SAME fixture text (invariant 1) -
// neither hand-writes its own copy of the regexes.
//
// BL-1285 (9021f12bb2) renamed the served-then-stopped helper from
// stamp_own_heartbeat_then_age_past_stall to
// stamp_own_heartbeat_immediately_stale while keeping its substance (an age-0
// stamp). Pinning the helper NAME made that rename read as a regression. This
// contract pins the property BL-1089 actually owns instead: the stamp line
// itself, never the name of the function that writes it.
const RULES = [
  {
    name: 'served-stamp-age-0',
    test: (src) => /write_heartbeat "\$root" 0/.test(src),
    message: 'the served-then-stopped helper must stamp write_heartbeat "$root" 0, never a backdate',
  },
  {
    name: 'no-5000ms-backdate',
    test: (src) => !/write_heartbeat "\$F" 5000/.test(src),
    message: 'stall paths must not backdate by 5000ms (predecessor-shaped)',
  },
  {
    name: 'healthy-poll-retained',
    test: (src) => /write_heartbeat "\$F" 10/.test(src),
    message: 'fresh-poll healthy check must remain (write_heartbeat "$F" 10)',
  },
];

/**
 * Evaluates the BL-1089 fixture-source contract over fixture TEXT.
 * Returns { ok: true } when every rule holds, or { ok: false, rule, message }
 * naming the first failing rule.
 */
function checkFixtureSourceContract(src) {
  for (const rule of RULES) {
    if (!rule.test(src)) {
      return { ok: false, rule: rule.name, message: rule.message };
    }
  }
  return { ok: true, rule: null, message: null };
}

module.exports = { checkFixtureSourceContract, RULES };
