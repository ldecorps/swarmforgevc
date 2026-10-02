'use strict';

// BL-1867: a vitest fork worker that seeds sharedRepoFixture.js's BL-1039
// template is torn down (recycled or killed by the pool) without ever
// firing mkProcessTmpDir's own `process.once('exit')` handler, so every
// template a worker seeded stayed in the temp directory - 445,231 of them
// on 2026-10-01, growing about 40,000 a day.
//
// Vitest's globalSetup runs once in the MAIN process, before any worker is
// spawned, and (via its returned function) once more after every worker has
// finished - the one process in a `vitest run` invocation that reliably
// reaches a normal exit. Its teardown sweeps every bl1039 template whose
// owning pid is no longer alive (tmpDir.js's sweepStaleTmpDirs, the same
// owner-aware sweep BL-971/BL-1385/BL-1390 standardized on): by teardown
// time every one of THIS run's own worker forks has already ended, so their
// templates sweep, while a concurrent sibling `vitest` invocation's still-
// alive worker's template is left untouched. The naming scheme this
// targets (`<prefix><pid>-<random>`) cannot match the 445,231 already-
// leaked templates (a bare mkdtemp random suffix, no embedded pid) - this
// sweeps only what THIS fix's own naming convention produces, never the
// pre-existing leak (out of scope; a one-time host cleanup for the human).
const { sweepStaleTmpDirs } = require('./tmpDir');
const { TEMPLATE_PREFIX } = require('./sharedRepoFixture');

module.exports = function setup() {
  return function teardown() {
    sweepStaleTmpDirs({ prefix: TEMPLATE_PREFIX });
  };
};
