import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    include: [
      'test/acpHostPaneArgs.test.js',
      'test/acpSeatLaunch.test.js',
      'test/acpHostRuntime.test.js',
      'test/acpSeatState.test.js',
      'test/acpSessionEvents.test.js',
      'test/acpWireFields.test.js',
      'test/backendSwitch.test.js',
      'test/acpHostPane.test.js',
    ],
  },
};
