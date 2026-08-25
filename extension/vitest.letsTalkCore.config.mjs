import base from './vitest.config.mjs';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['test/letsTalkCore.test.js'],
    },
  })
);
