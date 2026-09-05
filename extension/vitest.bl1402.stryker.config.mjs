import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1402 hardening: scope the Stryker dry run to atomicWrite's own
    // test, per the vitest.bl1081/bl1365/bl1383.stryker.config.mjs
    // precedent - avoids the standing Stryker-sandbox-only reds elsewhere
    // in the suite without editing the shared vitest.config.mjs. The
    // ticket's other two touched files (telegramFrontDeskBotCore.ts,
    // telegram-front-desk-bot.ts) are BL-149 cooldown-gate skip-cooldown
    // this pass (committed <3 days ago, still actively churning) - not
    // mutated here.
    include: ['test/atomicWrite.test.js'],
  },
};
