'use strict';

// Focused steps entry for BL-637 acceptance (avoids loading the full
// project registry when running this feature alone).
const { registerSteps } = require('./bl637LifecycleScriptScopeSteps');
module.exports = { registerSteps };
