'use strict';

// Focused steps entry for BL-739 acceptance (avoids loading the full
// steps/index.js when it requires modules not present on this seat).
const { registerSteps } = require('./bl739PilotVacuousPropertyGateSteps');

module.exports = { registerSteps };
