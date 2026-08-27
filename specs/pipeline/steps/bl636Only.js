'use strict';

// Focused steps entry for BL-636 acceptance (avoids loading the full
// steps/index.js, which requires a compiled extension/out tree).
const { registerSteps } = require('./bl636RotatePreferenceParcelPrioritySteps');

module.exports = { registerSteps };
