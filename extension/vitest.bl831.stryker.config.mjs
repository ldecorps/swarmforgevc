import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1638 (discharges BL-831's deferred Stryker gate): scope the dry
    // run to the tests covering bubblePipelinePage.ts, per the
    // vitest.bl1468.stryker.config.mjs precedent - avoids unrelated
    // standing Stryker-sandbox-only reds without editing the shared
    // vitest.config.mjs.
    include: ['test/bubblePipelinePage.test.js'],
  },
};
