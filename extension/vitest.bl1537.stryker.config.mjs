import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1537 hardening: scope the Stryker dry run to the four files this
    // ticket changed - avoids the standing Stryker-sandbox-only red in
    // test/activePoolFreshnessAudit.test.js (BL-1066, `../..` from __dirname
    // resolves outside extension/ inside the sandbox) without editing the
    // shared vitest.config.mjs.
    include: [
      'test/draftPathUnder.test.js',
      'test/closingCeremonyRun.test.js',
      'test/closingCeremonyRunCli.test.js',
      'test/nightClosingCeremonyRun.test.js',
      'test/tracerBulletLauncher.test.js',
      'test/tracer.test.js',
    ],
  },
};
