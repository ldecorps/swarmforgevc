import { createRequire } from 'node:module';
import { defineConfig, configDefaults } from 'vitest/config';

// BL-124: Vitest replaces `node --test` so Stryker can run coverage-aware
// (perTest) mutation. globals:true keeps the 88 migrated files working with a
// bare `test(...)` call (node:test module-as-function style) — no per-test
// import churn. Assertions stay on node:assert/strict, which Vitest runs as-is.

// BL-422: the pool/heap caps below are read from the SAME compiled module
// vitestWorkerMemoryBudget.test.js unit-tests, not a second copy of the
// numbers - this file is ESM, the caps module is CommonJS (tsconfig's
// "commonjs" output), hence createRequire. `npm test`/`npm run coverage`
// always run `tsc` before Vitest (see package.json), so out/ already exists
// by the time this config loads.
const require = createRequire(import.meta.url);
const { MAX_WORKERS, PER_WORKER_HEAP_MB } = require('./out/tools/vitest-worker-memory-budget');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // BL-422: an unbounded `vitest run` sizes its worker pool to the CPU
    // count (20 on the reference host) with no per-worker heap limit - one
    // run ballooned four workers to ~13GB and drove the kernel OOM-killer
    // into a death-spiral that killed swarm agents twice in one day. Caps
    // the DEFAULT forked-process pool only; Stryker's vitest-runner
    // hardcodes pool:'threads'+maxThreads:1 and overrides both of these
    // (engineering.prompt's worker-thread rule), so mutation runs are
    // unaffected.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: MAX_WORKERS,
        execArgv: [`--max-old-space-size=${PER_WORKER_HEAP_MB}`],
      },
    },
    // Keep Vitest's DEFAULT include: an explicit include gets mangled to [] by
    // the Stryker vitest-runner ("no tests found"). But the default glob also
    // matches the test copies under .stryker-tmp/sandbox-*/, so a standalone
    // `vitest run` would pull in hundreds of files — exclude those here. The
    // runner runs FROM within a sandbox (root = sandbox), where its own tests
    // sit at the root and this exclude does not apply.
    // BL-340: test/fixtures/** holds pinned task fixtures (e.g. the
    // coder-role benchmark task), which legitimately contain their OWN
    // *.test.js files run by the harness itself via a real `node --test`
    // child process - never Vitest's own collector. Without this exclude,
    // Vitest's default include glob picks the fixture file up as one of
    // its own suites and fails it ("No test suite found") because the
    // fixture calls node:test's own test() directly rather than relying
    // on Vitest's globals.
    exclude: [...configDefaults.exclude, '**/.stryker-tmp/**', '**/out/**', 'test/fixtures/**'],
    // node --test had no default per-test timeout. paneTailerScrollback (the
    // one 30s+ offender, BL-125) now runs in-process via a spy double, so a
    // normal cap is fine; the rest still spawn a fake-tmux binary and stay
    // comfortably under this.
    testTimeout: 20000,
    // BL-124: replace the old `c8 + node --test` coverage path. The v8
    // provider's `json` reporter writes coverage/coverage-final.json in the
    // same Istanbul shape crapReport.js already reads.
    coverage: {
      provider: 'v8',
      reporter: ['json'],
      reportsDirectory: 'coverage',
      include: ['out/**/*.js'],
      // BL-340: Vitest's OWN built-in coverage.exclude (unset here before,
      // so its default applied) matches any `*-benchmark.js` file - its
      // own bench-file heuristic. out/tools/run-role-benchmark.js is a
      // legitimately-named PRODUCTION CLI (this project's role-benchmark
      // harness entry point, not a Vitest bench file), so that default
      // silently dropped it from coverage-final.json entirely - not
      // under-reported, ABSENT - scoring every function in the file at a
      // false 0% for CRAP purposes despite dedicated passing unit tests
      // (confirmed by renaming a byte-identical copy of the same file,
      // which then appeared normally). `include` above already scopes
      // collection to compiled output only (rootDir is `src`, so `out/`
      // never contains a compiled test/spec/bench file to begin with),
      // which makes Vitest's test/spec/bench-suffix exclusion glob
      // redundant here anyway - drop it and keep only the excludes that
      // still make sense for this project's own layout.
      exclude: ['coverage/**', '**/node_modules/**', '**/*.d.ts'],
      all: false,
    },
  },
});
