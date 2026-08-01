'use strict';

// BL-720: registered via vitest.config.mjs's test.setupFiles, at collection
// time (the only time Vitest allows beforeEach/afterEach registration) -
// same idiom as tmpDirSetup.js (BL-420), which runs once per test FILE
// before its own tests. Wraps every test in every file sharing this worker
// (poolOptions.forks.isolate: false, BL-445) with a before/after
// process.env snapshot and fails loudly, naming the file, the test, and the
// leaked key(s), the moment a test leaves process.env different from what
// it found. See envRestoreGuard.js for the pure diff/format logic.
//
// afterEach hooks run in REVERSE registration order (Vitest's own
// documented behavior); this hook is registered first (setupFiles run
// before the test file's own top-level code), so it runs LAST among a
// file's afterEach hooks - after any of the test's own try/finally or
// afterEach cleanup already had its chance to restore the environment, so
// this measures the true final state a leak would hand to the next file.
const { snapshotEnv, diffEnvSnapshots, formatEnvLeakMessage } = require('./envRestoreGuard');

let before;

beforeEach(() => {
  before = snapshotEnv();
});

afterEach((context) => {
  const after = snapshotEnv();
  const leaks = diffEnvSnapshots(before, after);
  if (leaks.length === 0) {
    return;
  }
  const task = context && context.task;
  const filepath = task && task.file ? task.file.filepath : '(unknown file)';
  const name = task ? task.name : '(unknown test)';
  throw new Error(formatEnvLeakMessage(filepath, name, leaks));
});
