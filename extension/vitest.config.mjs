import { defineConfig } from 'vitest/config';

// BL-124: Vitest replaces `node --test` so Stryker can run coverage-aware
// (perTest) mutation. globals:true keeps the 88 migrated files working with a
// bare `test(...)` call (node:test module-as-function style) — no per-test
// import churn. Assertions stay on node:assert/strict, which Vitest runs as-is.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Vitest's default include already matches test/*.test.js. An explicit
    // include here gets mangled to [] by the Stryker vitest-runner's config
    // merge (dry run then finds no tests), so rely on the default.
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
      all: false,
    },
  },
});
