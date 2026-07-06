import { defineConfig, configDefaults } from 'vitest/config';

// BL-124: Vitest replaces `node --test` so Stryker can run coverage-aware
// (perTest) mutation. globals:true keeps the 88 migrated files working with a
// bare `test(...)` call (node:test module-as-function style) — no per-test
// import churn. Assertions stay on node:assert/strict, which Vitest runs as-is.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Keep Vitest's DEFAULT include: an explicit include gets mangled to [] by
    // the Stryker vitest-runner ("no tests found"). But the default glob also
    // matches the test copies under .stryker-tmp/sandbox-*/, so a standalone
    // `vitest run` would pull in hundreds of files — exclude those here. The
    // runner runs FROM within a sandbox (root = sandbox), where its own tests
    // sit at the root and this exclude does not apply.
    exclude: [...configDefaults.exclude, '**/.stryker-tmp/**', '**/out/**'],
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
