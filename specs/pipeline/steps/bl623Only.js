'use strict';

// Focused steps entry for BL-623 acceptance (avoids loading the full
// steps/index.js, which requires a compiled extension/out tree).
const { registerSteps } = require('./bl623RoutingSkipTrailSteps');

module.exports = { registerSteps };
