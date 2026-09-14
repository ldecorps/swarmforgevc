'use strict';

// BL-1556: step handlers for "the bl1272 property costs one bb process per
// query". Scenarios 01-03 drive the REAL property test file as a real
// subprocess (the bl1534BoundedSweepReachSteps.js shape) with a counting
// bb shim first on PATH - the only way to prove the LIVE file's own
// process count, not a reimplementation of it. Scenario 04 drives the REAL
// CLI directly with a git shim that fails every push, to prove a fixture
// git step failure is loud instead of surfacing later as an unexplained
// ref error.
//
// The property run is memoized at module scope (lib/lazy.js): each of
// scenarios 01-03 re-issues the same Given/When steps per Gherkin
// semantics, but the run spawns real bb processes and takes real
// wall-clock seconds, so every scenario reads the SAME captured run
// rather than paying for three repeats of it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');
const { lazy } = require('./lib/lazy');

const FEATURE = 'BL-1556 The bl1272 property costs one bb process per query';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION = path.join(REPO_ROOT, 'extension');
const PROPERTY_TEST_REL = 'test/bl1272LandedSiblingInvariants.property.test.js';
const CLI = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'bl1272LandDecisionCli.bb');

function resolveOnPath(bin) {
  return execFileSync('/bin/sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).trim();
}

// A shim dir first on PATH with a `bb` that appends one line to counterFile
// per invocation, then execs the REAL bb (resolved via the original PATH,
// never the shim dir itself).
const bbShimDir = lazy(() => {
  const dir = mkProcessTmpDir('bl1556-bb-shim-');
  const realBb = resolveOnPath('bb');
  const shim = path.join(dir, 'bb');
  fs.writeFileSync(shim, `#!/bin/sh\necho x >> "$BL1556_COUNT"\nexec "${realBb}" "$@"\n`);
  fs.chmodSync(shim, 0o755);
  return dir;
});

const counterFile = lazy(() => path.join(mkProcessTmpDir('bl1556-bb-count-'), 'count'));

const REACH_MAP_RE = /BL-1556 reach map \(([^)]+)\):\s*(\{[^\n]*\})/g;

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
    env: { ...process.env, PATH: `${bbShimDir()}:${process.env.PATH}`, BL1556_COUNT: count },
  });
  const output = `${result.stdout}${result.stderr}`;
  const lines = fs.readFileSync(count, 'utf8').split('\n').filter(Boolean);
  return { result, output, maps: reachMaps(output), processCount: lines.length };
});

// A shim dir first on PATH with a `git` that exits 1 naming itself on
// `push`, and delegates every other subcommand to the REAL git.
function makeFailingPushGitShim() {
  const dir = mkProcessTmpDir('bl1556-git-shim-');
  const realGit = resolveOnPath('git');
  const shim = path.join(dir, 'git');
  fs.writeFileSync(
    shim,
    `#!/bin/sh\nif [ "$1" = "push" ]; then\n  echo "bl1556 shim: refusing push" >&2\n  exit 1\nfi\nexec "${realGit}" "$@"\n`
  );
  fs.chmodSync(shim, 0o755);
  return dir;
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(/^a counting bb shim is first on PATH$/, () => {
    bbShimDir();
  });

  scoped(
    /^extension\/test\/bl1272LandedSiblingInvariants\.property\.test\.js runs alone under the properties config$/,
    (ctx) => {
      ctx.bl1556 = runProperty();
    }
  );

  scoped(/^every test in it passes$/, (ctx) => {
    const s = ctx.bl1556 || runProperty();
    assert.equal(s.result.status, 0, `expected the property file to pass, got:\n${s.output}`);
  });

  scoped(/^the shim counted at most (\d+) bb processes$/, (ctx, budget) => {
    const s = ctx.bl1556 || runProperty();
    assert.ok(
      s.processCount <= Number(budget),
      `expected at most ${budget} bb processes, the shim counted ${s.processCount}:\n${s.output}`
    );
  });

  scoped(/^the run prints a reach map for invariant 1$/, (ctx) => {
    const s = ctx.bl1556 || runProperty();
    const map = s.maps['invariant 1'];
    assert.ok(map, `no reach map for invariant 1 in the run's output:\n${s.output}`);
    ctx.bl1556Map = map;
  });

  scoped(/^that reach map counts at least (\d+) cases$/, (ctx, floor) => {
    const map = ctx.bl1556Map;
    assert.ok(
      map.cases >= Number(floor),
      `reach map counted only ${map.cases} cases, floor is ${floor}: ${JSON.stringify(map)}`
    );
  });

  scoped(/^a git shim first on PATH that fails every push$/, (ctx) => {
    ctx.bl1556GitShimDir = makeFailingPushGitShim();
  });

  scoped(/^the bl1272 land decision CLI answers action-batch for one case$/, (ctx) => {
    const shimDir = ctx.bl1556GitShimDir;
    assert.ok(shimDir, 'a git shim must be set up first');
    const result = spawnSync('bb', [CLI, 'action-batch', JSON.stringify([{ land: [] }])], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
    });
    ctx.bl1556CliResult = result;
  });

  scoped(/^it exits non-zero$/, (ctx) => {
    const r = ctx.bl1556CliResult;
    assert.notEqual(r.status, 0, `expected a non-zero exit, got ${r.status}:\n${r.stdout}${r.stderr}`);
  });

  scoped(/^its stderr names the git step that failed$/, (ctx) => {
    const r = ctx.bl1556CliResult;
    assert.match(
      r.stderr,
      /fixture step failed: git .*push/,
      `expected stderr to name the failed push step, got:\n${r.stderr}`
    );
  });
}

module.exports = { registerSteps };
