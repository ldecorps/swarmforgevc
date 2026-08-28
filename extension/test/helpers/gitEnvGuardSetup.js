'use strict';

// BL-1196: registered via vitest.config.mjs's AND vitest.properties.config.mjs's
// test.setupFiles, alongside tmpDirSetup.js/envRestoreGuardSetup.js. A
// setupFiles module's top-level code runs once per test file it is loaded
// for, before that file's own top-level code and before any test in it -
// so calling the strip here, unconditionally, at module load, closes the
// ambient-GIT_DIR-redirect door for every current AND future local
// `git(cwd, args)` helper in the file, with nothing to remember per file.
const { stripAmbientGitDirRedirect } = require('./gitEnvGuard');

stripAmbientGitDirRedirect();
