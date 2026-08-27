import base from './vitest.config.mjs';
import { defineConfig, mergeConfig, configDefaults } from 'vitest/config';

const baseExclude = base.test?.exclude ?? configDefaults.exclude;
const bl941Exclude = baseExclude.filter((pattern) => pattern !== '**/*.property.test.js');

/** BL-941: Stryker lane scoped to classifier tests only (not full lets-talk bridge suite). */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: [
        'test/telegramCursorBridgeCore.test.js',
        'test/bl941CursorGoneAgentClassifierInvariants.property.test.js',
      ],
      exclude: bl941Exclude,
    },
  })
);
