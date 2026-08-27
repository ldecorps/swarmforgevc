'use strict';

// BL-420: a Vitest setupFile (test.setupFiles in vitest.config.mjs), run
// once per test FILE before its own tests, so this afterEach is registered
// at COLLECTION time - the only time Vitest allows registering hooks -
// never from inside a running test body, which mkTmpDir() itself must
// remain safe to be called from.
const { sweepPendingTmpDirs, sweepSharedTmpDirs } = require('./tmpDir');

afterEach(() => {
  sweepPendingTmpDirs();
});

// mkSharedTmpDir's sibling sweep - once per file, after every test has run,
// not after each individual one (see tmpDir.js for why).
afterAll(() => {
  sweepSharedTmpDirs();
});
