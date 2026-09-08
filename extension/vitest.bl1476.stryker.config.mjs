import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1476 hardening: scope the Stryker dry run to transcriptSummaryStore.ts
    // (the only touched file eligible under the mutation cooldown gate -
    // turnProfileProducer.ts/transcriptWalker.ts/run-turn-profile-producer.ts
    // are deferred, backlog/hardening-debt-ledger.yaml) - avoids the standing
    // Stryker-sandbox-only red in test/activePoolFreshnessAudit.test.js
    // without editing the shared vitest.config.mjs.
    include: [
      'test/turnProfileProducer.test.js',
      'test/runTurnProfileProducer.test.js',
      'test/transcriptWalker.test.js',
      'test/transcriptSummaryStore.test.js',
    ],
  },
};
