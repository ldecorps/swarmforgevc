'use strict';

// BL-1534: step handlers for "the bl1373 property bounds its sweeps and
// counts decisive draws". Drives the REAL property test file as a real
// subprocess (the only way to prove the LIVE file's own budget and reach
// floor, not a restatement of them) - never a reimplementation of its
// generator or of babysitter_check.bb.
//
// The real run is memoized (lib/lazy.js): Background re-enters once per
// scenario per Gherkin semantics, but the property file spawns real
// babysitter_check.bb sweeps and takes real wall-clock seconds, so every
// scenario in this feature reads the SAME captured run rather than paying
// for seven repeats of it.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { lazy } = require('./lib/lazy');

const FEATURE = 'BL-1534 The bl1373 property bounds its sweeps and counts decisive draws';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION = path.join(REPO_ROOT, 'extension');
const PROPERTY_TEST_REL = 'test/bl1373PathSetCacheInvariants.property.test.js';

const runProperty = lazy(() =>
  spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', PROPERTY_TEST_REL], {
    cwd: EXTENSION,
    encoding: 'utf8',
  })
);

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough.
const KNOWN_TESTS = new Set(['invariant 1', 'invariant 2', 'cache invalidation']);

// Matches the shape the property file itself prints: one line per test,
// `BL-1534 reach map (<test>): <json>`.
const REACH_MAP_RE = /BL-1534 reach map \(([^)]+)\):\s*(\{[^\n]*\})/g;

function reachMaps(output) {
  const maps = {};
  for (const match of output.matchAll(REACH_MAP_RE)) {
    maps[match[1]] = JSON.parse(match[2]);
  }
  return maps;
}

function state(ctx) {
  if (!ctx.bl1534) {
    const result = runProperty();
    const output = `${result.stdout}${result.stderr}`;
    ctx.bl1534 = { result, output, maps: reachMaps(output) };
  }
  return ctx.bl1534;
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(
    /^extension\/test\/bl1373PathSetCacheInvariants\.property\.test\.js runs alone under the properties config$/,
    (ctx) => {
      state(ctx);
    }
  );

  scoped(/^every test in it passes$/, (ctx) => {
    const s = state(ctx);
    assert.equal(s.result.status, 0, `expected the property file to pass, got:\n${s.output}`);
  });

  scoped(/^the run prints a reach map for the (.+) test$/, (ctx, test) => {
    if (!KNOWN_TESTS.has(test)) {
      throw new Error(`unknown test example value: "${test}"`);
    }
    const s = state(ctx);
    const map = s.maps[test];
    assert.ok(map, `no reach map for "${test}" in the run's output:\n${s.output}`);
    s.current = map;
    s.currentTest = test;
  });

  scoped(/^that reach map stays within a budget of (\d+) sweeps$/, (ctx, budget) => {
    const s = state(ctx);
    assert.ok(
      s.current.sweeps <= Number(budget),
      `${s.currentTest} swept ${s.current.sweeps} times, over the budget of ${budget}: ${JSON.stringify(s.current)}`
    );
  });

  scoped(/^that reach map counts at least (\d+) decisive draws$/, (ctx, floor) => {
    const s = state(ctx);
    assert.ok(
      s.current.decisive >= Number(floor),
      `${s.currentTest} counted only ${s.current.decisive} decisive draws, floor is ${floor}: ${JSON.stringify(s.current)}`
    );
  });

  scoped(/^that reach map counts no draw that swept without being decisive$/, (ctx) => {
    const s = state(ctx);
    assert.equal(
      s.current.decisive,
      s.current.draws,
      `${s.currentTest} swept ${s.current.draws} draws but only ${s.current.decisive} were decisive: ${JSON.stringify(s.current)}`
    );
  });
}

module.exports = { registerSteps };
