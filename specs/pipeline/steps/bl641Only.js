'use strict';

// Focused steps entry for BL-641 acceptance (avoids loading the full
// steps/index.js, which requires a compiled extension/out tree).
const { registerSteps } = require('./bl641PagesDeploySteps');

module.exports = { registerSteps };
