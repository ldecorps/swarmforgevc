import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1365 hardening: scope the Stryker dry run to just this file's own
    // unit test, per the vitest.bl1081.stryker.config.mjs precedent. Needed
    // because test/activePoolFreshnessAudit.test.js fails its dry run
    // whenever it runs from inside a Stryker sandbox (documented, standing,
    // pre-existing Stryker-only red - see the "git rev-parse --show-toplevel
    // is the WRONG repair for it" rule in engineering.prompt/hardender.prompt:
    // resolveDeprecateCheckCliPath needs a root with an extension/ child,
    // which no Stryker sandbox has, so it fails loud there by design rather
    // than silently reading the unmutated build). Including only the test
    // file relevant to out/metrics/closingCeremonyRun.js avoids that file
    // entirely instead of editing the shared vitest.config.mjs.
    include: ['test/closingCeremonyRun.test.js'],
  },
};
