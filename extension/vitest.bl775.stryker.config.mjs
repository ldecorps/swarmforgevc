import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1638 (discharges BL-775's deferred Stryker gate): scope the dry
    // run to the tests covering residentPaneLive.ts and bubbleLiveUiHtml.ts,
    // per the vitest.bl1468.stryker.config.mjs precedent - avoids unrelated
    // standing Stryker-sandbox-only reds without editing the shared
    // vitest.config.mjs.
    include: [
      'test/residentPaneLive.test.js',
      'test/bridgeServer.test.js',
      'test/bl1243PaneActivitySignal.test.js',
      'test/bl775BubbleLiveScreenShell.test.js',
    ],
  },
};
