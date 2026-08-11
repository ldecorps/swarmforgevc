import * as os from 'node:os';
import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

// BL-479: property tests are a SEPARATE explicit command from normal
// verification (engineering.prompt: "Keep property tests separate from
// normal verification... unless the role owns property-test verification"
// - the architect, per this ticket's own role-prompt amendment). This
// config is used ONLY by `npm run test:properties`; the default
// `vitest.config.mjs` (unit/coverage run, and Stryker's mutation run,
// which reuses that same config) explicitly EXCLUDES `**/*.property.test.js`
// so property files are never picked up by any of those runs. This
// config's own `include` is scoped to exactly that glob, nothing else.

// BL-871: this lane used to size its worker pool to Vitest's CPU-count
// default with no per-worker heap limit at all - the exact BL-422 failure
// mode the unit lane already guards against, just never wired here. A full
// 65-file run's verdict was a function of host load (which file lost the
// contention moved between runs) rather than of the code under test. Both
// lanes now read the SAME shared budget module - this file carries no copy
// of its own numbers, so a change to the caps applies to both lanes at
// once. `npm run test:properties` runs `npm run compile` first (see
// package.json), so out/ already exists by the time this config loads,
// same createRequire bridge vitest.config.mjs's own ESM-to-CommonJS load
// uses (this config is ESM, the budget module is CommonJS).
const require = createRequire(import.meta.url);
const { PER_WORKER_HEAP_MB, resolveWorkerPoolSize } = require('./out/tools/vitest-worker-memory-budget');
const WORKER_POOL_SIZE = resolveWorkerPoolSize(os.totalmem() / (1024 * 1024));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // BL-868: this lane silently ran without the two shared isolation
    // guards vitest.config.mjs wires (BL-420's temp-dir sweep, BL-720's
    // env-restore guard) - a property test's mkTmpDir() calls were never
    // swept and a leaked process.env key had nothing to catch it. Same two
    // setupFiles, same paths, as vitest.config.mjs.
    setupFiles: ['./test/helpers/tmpDirSetup.js', './test/helpers/envRestoreGuardSetup.js'],
    include: ['test/**/*.property.test.js'],
    testTimeout: 20000,
    // BL-871: same forks pool + per-worker heap cap as vitest.config.mjs,
    // sourced from the same resolveWorkerPoolSize/PER_WORKER_HEAP_MB. This
    // lane deliberately leaves Vitest's default per-file isolation ON
    // (unlike vitest.config.mjs's isolate:false) - bringing the lanes to
    // parity there rests on a precondition (every test restores what it
    // stubs) not yet established for property files, and is out of this
    // ticket's scope.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: WORKER_POOL_SIZE,
        execArgv: [`--max-old-space-size=${PER_WORKER_HEAP_MB}`],
      },
    },
  },
});
