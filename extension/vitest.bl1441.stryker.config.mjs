import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1441 hardening (BL-954's mutation gate): scope the Stryker dry run
    // to the tests covering bounceRevertGitAdapter.ts, bounceRevertVerdict.ts
    // and record-bounce.ts, per the vitest.bl1081/bl1365/bl1383/bl1402.stryker.config.mjs
    // precedent - avoids the standing Stryker-sandbox-only red in
    // test/activePoolFreshnessAudit.test.js (and any other unrelated file)
    // without editing the shared vitest.config.mjs. Found by import path
    // (quality/bounceRevertVerdict, metrics/bounceRevertGitAdapter,
    // tools/record-bounce), never by a `record-bounce` substring grep alone -
    // that also matches the unrelated "record-bounce-by-role-NN" scenario
    // label convention used throughout the bounce test suite.
    include: ['test/bounceRevertCheck.test.js', 'test/bounceRevertRestoration.test.js', 'test/recordBounceCli.test.js'],
  },
};
