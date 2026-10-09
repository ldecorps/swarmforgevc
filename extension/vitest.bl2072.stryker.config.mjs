import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
const baseExclude = Array.isArray(cfg.test?.exclude) ? cfg.test.exclude : [];

export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-2072 hardening: scope the Stryker dry run to the tests covering
    // the changed timing code (timePhase, runStartupTopicChecks, the
    // poll-cycle phase wrappers) - the full-suite dry run is not
    // required by this ticket.
    include: [
      'test/telegramFrontDeskBotCore.test.js',
      'test/telegramFrontDeskBotCli.test.js',
      'test/bl2072FrontDeskPhaseTimingInvariants.property.test.js',
    ],
    // The base config's `**/*.property.test.js` exclude wins over
    // `include` (Vitest filters exclude first), silently dropping the
    // one file that pins the threshold/phase-wrapper invariants from
    // this scoped mutation run. Drop just that glob here so the explicit
    // include above is honored.
    exclude: baseExclude.filter((p) => p !== '**/*.property.test.js'),
  },
};
