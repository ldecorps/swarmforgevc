import { defineConfig } from 'vitest/config';

// BL-479: property tests are a SEPARATE explicit command from normal
// verification (engineering.prompt: "Keep property tests separate from
// normal verification... unless the role owns property-test verification"
// - the architect, per this ticket's own role-prompt amendment). This
// config is used ONLY by `npm run test:properties`; the default
// `vitest.config.mjs` (unit/coverage run, and Stryker's mutation run,
// which reuses that same config) explicitly EXCLUDES `**/*.property.test.js`
// so property files are never picked up by any of those runs. This
// config's own `include` is scoped to exactly that glob, nothing else -
// it deliberately does not share vitest.config.mjs's worker/coverage
// settings, since a small, separate command has no need of them.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.property.test.js'],
    testTimeout: 20000,
  },
});
