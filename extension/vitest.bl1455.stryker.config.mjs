import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1455 hardening: scope the Stryker dry run to the tests covering
    // approvalAskReconcile.ts and the updateApprovalAskMessageText close
    // writer, per the vitest.bl1081/bl1348/bl1365/bl1383/bl1402/bl1441
    // .stryker.config.mjs precedent - avoids the standing Stryker-sandbox-
    // only red in test/activePoolFreshnessAudit.test.js (and any other
    // unrelated file) without editing the shared vitest.config.mjs.
    include: ['test/approvalAskReconcile.test.js', 'test/conciergeTick.test.js', 'test/telegramFrontDeskBotCli.test.js'],
  },
};
