import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1468 (discharges BL-1452's deferred Stryker gate): scope the dry
    // run to the tests covering backlogTicketId.ts, bounceArgsCore.ts and
    // qa-sibling-check.ts, per the vitest.bl1441.stryker.config.mjs
    // precedent - avoids unrelated standing Stryker-sandbox-only reds
    // without editing the shared vitest.config.mjs.
    include: ['test/backlogTicketId.test.js', 'test/recordQaBounceCli.test.js', 'test/qaSiblingCheckCli.test.js'],
  },
};
