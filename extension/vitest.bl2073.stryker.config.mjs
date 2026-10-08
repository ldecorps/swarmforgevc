import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-2073 hardening: scope the Stryker dry run to the unit-test file
    // that exercises extension/src/quality/qaGather.ts.
    include: [
      'test/qaGather.test.js',
    ],
  },
};
