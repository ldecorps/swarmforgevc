import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1383 hardening: scope the Stryker dry run to the tests covering
    // providerChatSeat.ts / providerChatSeatLive.ts and the front-desk
    // dispatch hook, per the vitest.bl1081.stryker.config.mjs precedent
    // (see the rule_proposal on vitest.bl1365.stryker.config.mjs for why:
    // a standing Stryker-sandbox-only red elsewhere in the suite must never
    // be dodged by editing the shared vitest.config.mjs).
    include: ['test/providerChatSeat.test.js', 'test/telegramFrontDeskBotCore.test.js'],
  },
};
