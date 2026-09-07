import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1348 hardening: scope the Stryker dry run to the tests covering
    // vitest-worker-memory-budget.ts, per the vitest.bl1081/bl1365/
    // bl1383/bl1402/bl1441.stryker.config.mjs precedent - avoids the
    // standing Stryker-sandbox-only red in test/activePoolFreshnessAudit.test.js
    // (and any other unrelated file) without editing the shared
    // vitest.config.mjs.
    include: ['test/vitestWorkerMemoryBudget.test.js', 'test/bl1336RouterForkCeiling.test.js'],
  },
};
