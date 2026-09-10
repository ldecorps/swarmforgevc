import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1441 hardening (BL-620's mutation gate): scope the Stryker dry run
    // to the tests covering telegram-front-desk-bot.ts, telegramFrontDeskBotCore.ts
    // and telegramTopicDecisions.ts, per the vitest.bl1081/bl1348/bl1365/
    // bl1383/bl1402/bl1441/bl1475/bl1476/bl1477.stryker.config.mjs precedent -
    // avoids the standing Stryker-sandbox-only red in
    // test/activePoolFreshnessAudit.test.js without editing the shared
    // vitest.config.mjs. Found by import path (require(...telegram-front-desk-bot),
    // require(...telegramFrontDeskBotCore), require(...telegramTopicDecisions)),
    // never by a bare substring grep.
    include: [
      'test/applyCooldownPauseCli.test.js',
      'test/backfillStandingTopicIconsCli.test.js',
      'test/bl1036RestartConflictWindow.test.js',
      'test/bl1147ProbeLegacyTopicAdoption.test.js',
      'test/bl1201DeliverRoleAnswer.test.js',
      'test/bl1368ApprovalCommitByline.test.js',
      'test/bl1402FrontDeskPhotoPassthrough.test.js',
      'test/bl586PipelineBoardTopicIdentity.test.js',
      'test/bl621FrontDeskSustainedOutage.test.js',
      'test/deliverRoleAnswerCli.test.js',
      'test/notifyResidentSpyTunnelCli.test.js',
      'test/readLiveRoleHeldTicketsCli.test.js',
      'test/resumeExpiredPausesCli.test.js',
      'test/runOneConciergeTick.test.js',
      'test/staleApprovalAskReconcile.test.js',
      'test/telegramFrontDeskBotCli.test.js',
      'test/telegramFrontDeskBotCore.test.js',
    ],
  },
};
