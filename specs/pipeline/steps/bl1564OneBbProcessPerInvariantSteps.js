'use strict';

// BL-1564: step handlers for "the bl1297 property costs one bb process per
// invariant". Drives the REAL property test file as a real subprocess (the
// bl1534BoundedSweepReachSteps.js shape, and BL-1556's own sibling for this
// same class) with a counting bb shim first on PATH - the only way to prove
// the LIVE file's own process count, not a reimplementation of it.
//
// The property run is memoized at module scope (lib/lazy.js): each scenario
// re-issues the same Given/When steps per Gherkin semantics, but the run
// spawns real bb processes and builds real git repositories, so every
// scenario reads the SAME captured run rather than paying for repeats.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');
const { lazy } = require('./lib/lazy');

const FEATURE = 'BL-1564 The bl1297 property costs one bb process per invariant';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION = path.join(REPO_ROOT, 'extension');
const PROPERTY_TEST_REL = 'test/bl1297MergeOwnPathsInvariants.property.test.js';

function resolveOnPath(bin) {
  return execFileSync('/bin/sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).trim();
}

// A shim dir first on PATH with a `bb` that appends one line to counterFile
// per invocation, then execs the REAL bb (resolved via the original PATH,
// never the shim dir itself).
const bbShimDir = lazy(() => {
  const dir = mkProcessTmpDir('bl1564-bb-shim-');
  const realBb = resolveOnPath('bb');
  const shim = path.join(dir, 'bb');
  fs.writeFileSync(shim, `#!/bin/sh\necho x >> "$BL1564_COUNT"\nexec "${realBb}" "$@"\n`);
  fs.chmodSync(shim, 0o755);
  return dir;
});

const counterFile = lazy(() => path.join(mkProcessTmpDir('bl1564-bb-count-'), 'count'));

// Matches the shape the property file itself prints: one line per invariant,
// `BL-1564 reach map (invariant N): <json>`.
const REACH_MAP_RE = /BL-1564 reach map \(invariant (\d)\):\s*(\{[^\n]*\})/g;

function reachMaps(output) {
  const maps = {};
  for (const match of output.matchAll(REACH_MAP_RE)) {
    maps[match[1]] = JSON.parse(match[2]);
  }
  return maps;
}

const runProperty = lazy(() => {
  const count = counterFile();
  fs.writeFileSync(count, '');
  const result = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', PROPERTY_TEST_REL], {
    cwd: EXTENSION,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bbShimDir()}:${process.env.PATH}`, BL1564_COUNT: count },
  });
  const output = `${result.stdout}${result.stderr}`;
  const lines = fs.readFileSync(count, 'utf8').split('\n').filter(Boolean);
  return { result, output, maps: reachMaps(output), processCount: lines.length };
});

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough.
const KNOWN_INVARIANTS = new Set(['1', '2', '3']);

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(/^a counting bb shim is first on PATH$/, () => {
    bbShimDir();
  });

  scoped(
    /^extension\/test\/bl1297MergeOwnPathsInvariants\.property\.test\.js runs alone under the properties config$/,
    (ctx) => {
      ctx.bl1564 = runProperty();
    }
  );

  scoped(/^every test in it passes$/, (ctx) => {
    const s = ctx.bl1564 || runProperty();
    assert.equal(s.result.status, 0, `expected the property file to pass, got:\n${s.output}`);
  });

  scoped(/^the shim counted at most (\d+) bb processes$/, (ctx, budget) => {
    const s = ctx.bl1564 || runProperty();
    assert.ok(
      s.processCount <= Number(budget),
      `expected at most ${budget} bb processes, the shim counted ${s.processCount}:\n${s.output}`
    );
  });

  scoped(/^the run prints a reach map for invariant (\d)$/, (ctx, invariant) => {
    if (!KNOWN_INVARIANTS.has(invariant)) {
      throw new Error(`unknown invariant example value: "${invariant}"`);
    }
    const s = ctx.bl1564 || runProperty();
    const map = s.maps[invariant];
    assert.ok(map, `no reach map for invariant ${invariant} in the run's output:\n${s.output}`);
    ctx.bl1564Map = map;
  });

  scoped(/^that reach map counts at least (\d+) cases$/, (ctx, floor) => {
    const map = ctx.bl1564Map;
    assert.ok(
      map.cases >= Number(floor),
      `reach map counted only ${map.cases} cases, floor is ${floor}: ${JSON.stringify(map)}`
    );
  });
}

module.exports = { registerSteps };
