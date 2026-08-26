'use strict';

// Focused steps entry for BL-627 acceptance (avoids loading the full
// steps/index.js when running this feature alone).
const { registerSteps } = require('./bl627PricingTableCorrectnessSteps');

module.exports = { registerSteps };
