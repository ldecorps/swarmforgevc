'use strict';

// BL-1607: the unit lane's own heavy (subprocess-heavy) tests need the same
// load/fork-aware budget the property lane already carries
// (propertyLaneContentionBudget.js, BL-1579/BL-1588) - reused through its
// existing forksFn injection point rather than re-derived, fed the unit
// lane's OWN published fork count (vitest.config.mjs publishes it under
// UNIT_LANE_FORKS_ENV_KEY the same way vitest.properties.config.mjs
// publishes FORKS_ENV_KEY) so this lane's own concurrency - not the
// property lane's - is what the factor reads.
const { propertyLaneContentionFactor } = require('./propertyLaneContentionBudget');

const UNIT_LANE_FORKS_ENV_KEY = 'SWARMFORGE_UNIT_LANE_FORKS';

function unitLaneHeavyContentionFactor(opts = {}) {
  return propertyLaneContentionFactor({
    ...opts,
    forksFn: opts.forksFn ?? (() => process.env[UNIT_LANE_FORKS_ENV_KEY]),
  });
}

module.exports = {
  UNIT_LANE_FORKS_ENV_KEY,
  unitLaneHeavyContentionFactor,
};
