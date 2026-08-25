'use strict';

/**
 * BL-988 invariant: every scenario step in a live specs/features/*.feature
 * has a matching step handler — this contract was orphaned once; the
 * binding must stay load-bearing.
 *
 * Decision recorded on the ticket: RESTORE (behaviour still ships in
 * bounceLib.js / start-extension-dev.js; handlers live in
 * bl578DevhostBounceWslWindowLeakSteps.js and are registered in index.js).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { createStepRegistry } = require('../stepRegistry');
const { registerSteps } = require('../steps/bl578DevhostBounceWslWindowLeakSteps');

const FEATURE_NAME =
  'dev-host bounce under WSL terminates the prior Windows-side window instead of leaking it';
const FEATURE_PATH = path.join(
  __dirname,
  '..',
  '..',
  'features',
  'BL-578-devhost-bounce-wsl-window-leak.feature'
);
const INDEX_PATH = path.join(__dirname, '..', 'steps', 'index.js');

function extractStepTexts(featureSource) {
  const steps = [];
  for (const line of featureSource.split('\n')) {
    const m = line.match(/^\s*(Given|When|Then|And)\s+(.+?)\s*$/);
    if (!m) continue;
    let text = m[2].trim();
    // Outline placeholders become concrete example strings at run time;
    // resolve against a representative instantiation for binding checks.
    text = text
      .replace(/"<extension path>"/g, '"/home/dev/swarmforgevc"')
      .replace(/"<[^>]+>"/g, '"example"');
    steps.push(text);
  }
  return steps;
}

describe('BL-988 BL-578 acceptance contract binding', () => {
  it('index.js registers the BL-578 step module', () => {
    const indexSrc = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.match(
      indexSrc,
      /bl578DevhostBounceWslWindowLeakSteps/,
      'BL-578 step module must stay required from the pipeline step index'
    );
  });

  it('every step text in the live feature resolves under the feature scope', () => {
    const registry = createStepRegistry();
    registerSteps(registry);
    const featureSource = fs.readFileSync(FEATURE_PATH, 'utf8');
    assert.match(featureSource, new RegExp(`Feature:\\s*${FEATURE_NAME}`));
    const steps = extractStepTexts(featureSource);
    assert.ok(steps.length >= 10, `expected many steps, got ${steps.length}`);
    const seen = new Set();
    for (const stepText of steps) {
      if (seen.has(stepText)) continue;
      seen.add(stepText);
      const resolved = registry.resolve(stepText, FEATURE_NAME);
      assert.ok(
        resolved,
        `no step handler matched "${stepText}" for feature "${FEATURE_NAME}"`
      );
    }
  });
});
