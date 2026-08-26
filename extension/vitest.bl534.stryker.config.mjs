import base from './vitest.config.mjs';
import { defineConfig, mergeConfig, configDefaults } from 'vitest/config';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: [
        'test/thinMainGate.test.js',
        'test/thinMainGateCli.test.js',
      ],
      // Keep property tests on the properties lane; clear the base exclude that
      // would otherwise fight an explicit include of *.property.test.js.
      exclude: [...configDefaults.exclude, '**/.stryker-tmp/**', '**/out/**', 'test/fixtures/**'],
    },
  })
);
