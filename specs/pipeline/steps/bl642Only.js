'use strict';

// Focused steps entry for BL-642 acceptance (avoids loading the full
// steps/index.js, which requires a compiled extension/out tree for every domain).
const { registerSteps } = require('./bl642GateSnippetTerminalChromeSteps');

module.exports = { registerSteps };
