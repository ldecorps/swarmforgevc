'use strict';

// BL-1972: the vitest globalSetup entry that stops a run before any test
// when extension/out/ is stale. Runs once in the MAIN process, before any
// worker is spawned (vitest.config.mjs's globalSetup, first entry); a throw
// here aborts the run before a single test executes. The pure check lives in
// staleBuildGuard.js; this file only wires it to the real fs.
const { assertBuildIsFresh } = require('./staleBuildGuard');

module.exports = function setup() {
  assertBuildIsFresh();
  return function teardown() {
    // nothing to clean up - the check is read-only
  };
};
