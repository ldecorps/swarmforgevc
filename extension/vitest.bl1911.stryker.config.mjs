import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1911 hardening: scope the Stryker dry run to the files this ticket
    // touched (and their direct siblings) - the full-suite dry run (perTest
    // coverage, 622 files) timed out at the 15-minute cap under host load
    // 8-30 on 20 cores; this ticket carries no full-suite requirement (that
    // is BL-1676's own, distinct FIRM clause), so a scoped include is the
    // ordinary shape (BL-1753's precedent).
    include: [
      'test/bl1911LocalSeatRepoRead.test.js',
      'test/bl1235LocalQwenSeatLive.test.js',
    ],
  },
};
