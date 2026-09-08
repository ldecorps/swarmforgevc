import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1477 hardening: scope the Stryker dry run to the tests covering
    // contextTelemetryProducer.ts, contextTelemetryStore.ts and
    // run-context-telemetry-producer.ts, per the vitest.bl1081/bl1348/
    // bl1365/bl1383/bl1402/bl1441.stryker.config.mjs precedent - avoids the
    // standing Stryker-sandbox-only red in test/activePoolFreshnessAudit.test.js
    // without editing the shared vitest.config.mjs.
    include: ['test/contextTelemetryProducer.test.js', 'test/runContextTelemetryProducerCli.test.js'],
  },
};
