import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1880 hardening: scope the Stryker dry run to the two unit-test
    // files that exercise extension/src/tools/qa-bounce-line.ts (BL-1911's
    // precedent shape, itself citing BL-1753).
    include: [
      'test/qaBounceLineCli.test.js',
      'test/bl990BounceCorrectionStore.test.js',
    ],
  },
};
