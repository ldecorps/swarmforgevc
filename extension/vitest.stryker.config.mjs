import base from './vitest.config.mjs';

// BL-1771: the default Stryker run's own vitest config. Extends
// vitest.config.mjs (never a second copy of its own setup) and excludes
// exactly one file this ticket's own dry run needs excluded:
// test/activePoolFreshnessAudit.test.js's `../..` walk-up from __dirname
// resolves outside the extension root inside a Stryker sandbox (BL-1066),
// a standing, known Stryker-only red the file's own comment already calls
// out for exclusion (2026-09-02 resolution: exclude, never "fix", since
// the walk-up is CORRECT outside Stryker and the file spawns the
// compiled, Stryker-mutated CLI on purpose). It keeps running in the unit
// lane - vitest.config.mjs itself is untouched.
//
// Deliberately no explicit `include` here: vitest.config.mjs's own
// comment on its `exclude` key warns that an explicit include is mangled
// to [] by the Stryker vitest-runner ("no tests found") - this config
// inherits the base's unset include (Vitest's own default glob)
// unchanged, and only appends to `exclude`.
const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    exclude: [...cfg.test.exclude, 'test/activePoolFreshnessAudit.test.js'],
  },
};
