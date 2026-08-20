'use strict';

// BL-971: step handlers for "property lane is green again - no wall-clock
// exhaustion under swarm load". Scenario 01 runs the REAL property lane
// (real vitest, real config, real host load) scoped to each formerly
// timing-out file; scenario 02 inspects the real files' budget
// declarations. Nothing is mocked - the acceptance IS the outcome the
// ticket pins.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const LANE_CONFIG = path.join(EXTENSION_DIR, 'vitest.properties.config.mjs');

const FEATURE = 'BL-971 property lane is green again - no wall-clock exhaustion under swarm load';

// KNOWN_VALUES: the outline's <file> tokens, validated explicitly - never a
// passthrough into an arbitrary vitest invocation.
const KNOWN_LANE_FILES = new Set([
  'test/bl868PropertyLaneIsolationGuards.property.test.js',
  'test/bl632CommitTimeGuardInvariants.property.test.js',
]);

function knownLaneFile(token) {
  if (!KNOWN_LANE_FILES.has(token)) {
    throw new Error(`unknown <file> token: ${token}`);
  }
  return token;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the extension property lane runner and its config "([^"]+)"$/, (ctx, configRel) => {
    assert.equal(configRel, 'extension/vitest.properties.config.mjs', `unexpected config token: ${configRel}`);
    assert.ok(fs.existsSync(LANE_CONFIG), `property lane config missing at ${LANE_CONFIG}`);
  });

  scoped(/^the swarm host is under its normal live load$/, () => {
    // The live-load precondition is the HOST's state, not something a step
    // can conjure - assert the live swarm install marker so a run on a
    // non-swarm host cannot silently claim this scenario's evidence.
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, '..', '..', '.swarmforge', 'swarm-identity')) ||
        fs.existsSync(path.join(REPO_ROOT, '.swarmforge', 'swarm-identity')),
      'no .swarmforge/swarm-identity found - this scenario must run on the live swarm host'
    );
  });

  scoped(/^the property lane runs scoped to "([^"]+)"$/, (ctx, token) => {
    const file = knownLaneFile(token);
    const vitest = path.join(EXTENSION_DIR, 'node_modules', '.bin', 'vitest');
    const result = spawnSync(vitest, ['run', '--config', 'vitest.properties.config.mjs', file], {
      cwd: EXTENSION_DIR,
      encoding: 'utf8',
      timeout: 240000,
    });
    ctx.laneRun = { file, status: result.status, output: `${result.stdout || ''}${result.stderr || ''}` };
  });

  scoped(/^the run exits green with zero wall-clock exhausted tests$/, (ctx) => {
    const { file, status, output } = ctx.laneRun;
    assert.equal(status, 0, `expected a green scoped run for ${file}, got exit ${status}:\n${output.slice(-2000)}`);
    assert.ok(!/Test timed out in \d+ms/.test(output), `a test exhausted its wall-clock budget in ${file}:\n${output.slice(-2000)}`);
    assert.match(output, /Tests {2}\d+ passed/, `expected a passed-tests summary for ${file}:\n${output.slice(-2000)}`);
  });

  scoped(/^the two property test files named in scenario 01$/, (ctx) => {
    ctx.budgetFiles = [...KNOWN_LANE_FILES].map((rel) => ({
      rel,
      source: fs.readFileSync(path.join(EXTENSION_DIR, rel), 'utf8'),
    }));
  });

  scoped(/^their explicit per-test timeout declarations are inspected$/, (ctx) => {
    for (const f of ctx.budgetFiles) {
      // An explicit per-test budget: vitest's trailing timeout argument -
      // both the single-line `}, 90000);` and the split `},\n  60000\n);`
      // layouts.
      assert.match(f.source, /\}\s*,\s*\n?\s*\d{4,6}\s*\n?\s*\)/, `${f.rel}: no explicit per-test timeout declaration found`);
    }
  });

  scoped(/^each budget is accompanied by a stated measured per-case cost and headroom rationale$/, (ctx) => {
    for (const f of ctx.budgetFiles) {
      // Join comment continuation lines so the assertion checks the stated
      // basis, not where the prose happens to wrap.
      const prose = f.source.replace(/\n\s*\/\/ ?/g, ' ');
      assert.ok(prose.includes('Budget basis (measured'), `${f.rel}: budget comment must state its measured basis`);
      assert.ok(/headroom/.test(prose), `${f.rel}: budget comment must state its headroom rationale`);
      assert.ok(/measured\s+\d+|\d+s\b|\d+ms\b|\d+-\d+s/.test(prose), `${f.rel}: budget comment must carry an actual measured number`);
    }
  });
}

module.exports = { registerSteps };
