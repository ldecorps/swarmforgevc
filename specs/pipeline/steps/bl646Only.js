'use strict';

// Focused steps entry for BL-646 acceptance (avoids loading the full steps/index.js).
const { registerSteps } = require('./bl646DaemonAlarmFixtureLeakSteps');

module.exports = { registerSteps };
