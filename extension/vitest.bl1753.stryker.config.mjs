import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1753 hardening: scope the Stryker dry run to the files this ticket
    // touched (and their direct siblings) - avoids the standing
    // Stryker-sandbox-only red in test/activePoolFreshnessAudit.test.js
    // (BL-1066, `../..` from __dirname resolves outside extension/ inside
    // the sandbox) without editing the shared vitest.config.mjs.
    include: [
      'test/nightClosingCeremony.test.js',
      'test/nightClosingCeremonyLive.test.js',
      'test/nightClosingCeremonyGate.test.js',
      'test/nightClosingCeremonyRotateDocumenterFallback.test.js',
      'test/nightClosingCeremonyRotateDocumenterMissingScript.test.js',
      'test/nightClosingCeremonyRun.test.js',
    ],
  },
};
