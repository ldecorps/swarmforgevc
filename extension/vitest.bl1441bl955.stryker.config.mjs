import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1441 hardening (BL-955's mutation gate): scope the Stryker dry run
    // to the tests covering negotiationTelegramRelay.ts,
    // negotiationTelegramRouting.ts and telegramFrontDeskBotCore.ts (shared
    // with BL-620's own row), per the vitest.bl1081/bl1348/bl1365/bl1383/
    // bl1402/bl1441/bl1475/bl1476/bl1477.stryker.config.mjs precedent -
    // avoids the standing Stryker-sandbox-only red in
    // test/activePoolFreshnessAudit.test.js without editing the shared
    // vitest.config.mjs. Found by import path, never by a bare substring
    // grep.
    include: [
      'test/bl1036RestartConflictWindow.test.js',
      'test/bl1147ProbeLegacyTopicAdoption.test.js',
      'test/bl1368ApprovalCommitByline.test.js',
      'test/bl621FrontDeskSustainedOutage.test.js',
      'test/contractPhaseRelay.test.js',
      'test/negotiationTelegramRelay.test.js',
      'test/negotiationTelegramRouting.test.js',
      'test/staleApprovalAskReconcile.test.js',
      'test/telegramFrontDeskBotCore.test.js',
    ],
  },
};
