'use strict';

// Focused steps entry for BL-723 acceptance (avoids loading the full
// steps/index.js when running this feature alone).
const { registerSteps } = require('./bl723PilotReviewSteps');

module.exports = { registerSteps };
