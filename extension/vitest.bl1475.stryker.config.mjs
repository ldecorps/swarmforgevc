import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1475 hardening: scope the Stryker dry run to the tests covering
    // gitCommitScopedFile.ts, commitIntegrityRunner.ts, blTopicStore.ts,
    // repair-bl-topic-records.ts and emit-cost-health-sidecar.ts, per the
    // vitest.bl1081/bl1348/bl1365/bl1383/bl1402/bl1441/bl1477.stryker.config.mjs
    // precedent - avoids the standing Stryker-sandbox-only red in
    // test/activePoolFreshnessAudit.test.js without editing the shared
    // vitest.config.mjs.
    include: [
      'test/gitCommitScopedFile.test.js',
      'test/commitIntegrityRunner.test.js',
      'test/blTopicStore.test.js',
      'test/backfillBlTopicStore.test.js',
      'test/repairBlTopicRecordsCli.test.js',
      'test/emitCostHealthSidecarCli.test.js',
      'test/costHealthSidecar.test.js',
      'test/bl1368ApprovalCommitByline.test.js',
    ],
  },
};
