import base from './vitest.config.mjs';

export default {
  ...base,
  test: {
    ...base.test,
    exclude: [
      ...(base.test?.exclude || []),
      'test/activePoolFreshnessAudit.test.js',
    ],
  },
};
