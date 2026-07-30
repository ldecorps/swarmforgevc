import base from './vitest.config.mjs';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: [
        'test/letsTalk*.test.js',
        'test/cursorBridge*.test.js',
        'test/telegramCursorBridge*.test.js',
        'test/startBridgeHeadlessCli.test.js',
        'test/bridgeAuth.test.js',
        'test/swarmEnv.test.js',
        'test/cursorBridgeProgress.test.js',
      ],
    },
  })
);
