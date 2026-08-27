'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'the chunking property test can actually fail';
const REPO = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO, 'extension');
const PROPERTY_FILE = 'test/cursorBridgeLive.property.test.js';
const PROPERTY_TEST =
  'property: splitTelegramChunks reassembles without loss across chunk boundaries';

const { splitTelegramChunks } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorBridgeCore'));
const {
  runChunkingProperty,
  brokenSplitDropsContinuationHead,
} = require(path.join(EXT_DIR, 'test', 'helpers', 'chunkingPropertyProbe'));

function ensure(ctx) {
  if (!ctx.bl738) ctx.bl738 = {};
  return ctx.bl738;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the chunking property test as committed$/, (ctx) => {
    ensure(ctx).propertyFile = PROPERTY_FILE;
  });

  scoped(/^the property lane runs the chunking property$/, (ctx) => {
    const vitest = path.join(EXT_DIR, 'node_modules', '.bin', 'vitest');
    const result = spawnSync(
      vitest,
      ['run', '--config', 'vitest.properties.config.mjs', PROPERTY_FILE, '-t', PROPERTY_TEST],
      { cwd: EXT_DIR, encoding: 'utf8', timeout: 120000 }
    );
    ensure(ctx).lane = {
      status: result.status,
      output: `${result.stdout || ''}${result.stderr || ''}`,
    };
  });

  scoped(/^at least one generated input is split into more than one chunk$/, (ctx) => {
    const probe = runChunkingProperty(splitTelegramChunks);
    assert.equal(probe.passed, true);
    assert.equal(probe.sawMultiChunk, true);
    const lane = ensure(ctx).lane;
    assert.equal(lane.status, 0, `property lane must pass:\n${lane.output.slice(-2000)}`);
  });

  scoped(
    /^a splitTelegramChunks whose multi-chunk branch drops the first character of each continuation$/,
    (ctx) => {
      ensure(ctx).brokenSplit = brokenSplitDropsContinuationHead(splitTelegramChunks);
    }
  );

  scoped(/^the property fails and names the losing input$/, (ctx) => {
    const result = runChunkingProperty(ensure(ctx).brokenSplit);
    assert.equal(result.passed, false);
    assert.ok(result.losingInput !== undefined, 'counterexample must name the losing input');
  });
}

module.exports = { registerSteps };
