'use strict';

// Focused steps entry for BL-694 acceptance (avoids loading the full steps/index.js).
const { registerSteps } = require('./bl694ResidualAllowlistSteps');

module.exports = { registerSteps };
