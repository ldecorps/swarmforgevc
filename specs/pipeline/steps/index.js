'use strict';

// The project step registry: every step handler in this directory, found by
// its own file name.
//
// BL-1371 replaced the hand-maintained `DOMAINS` array of 947
// `require('./blNNNSteps')` lines that used to live here. Adding a scenario
// no longer edits this file - it adds one `*Steps.js` file and nothing else -
// so this path stopped being a co-owner of every ticket in the project.
//
// Both runners load THIS module (run_acceptance.sh and
// run_gherkin_mutation.sh both default STEPS_MODULE to it), so the two lanes
// moved together by construction.
const { registerDiscoveredSteps } = require('./discoverStepHandlers');

function registerSteps(registry) {
  registerDiscoveredSteps(registry, __dirname);
}

module.exports = { registerSteps };
