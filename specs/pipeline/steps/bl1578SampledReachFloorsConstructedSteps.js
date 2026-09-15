'use strict';

// BL-1578: step handlers for "Three sampled reach floors are constructed".
// Drives the REAL property test files as real subprocesses (the
// bl1555ReachFloorsConstructedSteps.js shape) - never a reimplementation of
// their generators or of the printed reach maps (BL-233, BL-1371).
//
// Each file's real run is memoized: the three property files spawn real
// vitest subprocesses (one of them, bl1529, about 24s), so every scenario
// reads the SAME captured run per file rather than paying for repeats of it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1578 Three sampled reach floors are constructed';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');

const FILES = {
  'extension/test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js': {
    rel: 'test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js',
  },
  'extension/test/meanTicketTimeCost.property.test.js': {
    rel: 'test/meanTicketTimeCost.property.test.js',
  },
  'extension/test/bl622TelegramTokenSeparationInvariant.property.test.js': {
    rel: 'test/bl622TelegramTokenSeparationInvariant.property.test.js',
  },
};

// Matches the shape all three property files print: one line per reach map,
// `BL-1578 reach map (<test>): <json>`.
const REACH_MAP_RE = /BL-1578 reach map \(([^)]+)\):\s*(\{[^\n]*\})/g;

function reachMaps(output) {
  const maps = {};
  for (const match of output.matchAll(REACH_MAP_RE)) {
    maps[match[1]] = JSON.parse(match[2]);
  }
  return maps;
}

function runProperty(rel) {
  return spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', rel], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    timeout: 600000,
  });
}

function state(ctx, file) {
  const known = FILES[file];
  if (!known) {
    throw new Error(`unknown file example value: "${file}"`);
  }
  ctx.bl1578 = ctx.bl1578 || {};
  if (!ctx.bl1578[file]) {
    const result = runProperty(known.rel);
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    ctx.bl1578[file] = { result, output, maps: reachMaps(output) };
  }
  return ctx.bl1578[file];
}

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough.
const TEST_TO_MAP_KEY = {
  bl1529: 'bl1529',
  meanTicketTimeCost: 'meanTicketTimeCost',
  bl622: 'bl622',
};

const POPULATION_TO_FIELD = {
  cells: 'cells',
  'draws of the rarest cell': 'minDrawsPerCell',
  regimes: 'regimes',
  'draws of the rarest regime': 'minDrawsPerRegime',
  arms: 'arms',
  'draws of the rarest arm': 'minDrawsPerArm',
};

const SOURCE_FLOOR_RE = {
  'reached.queued >= STAGES.length': /reached\.queued\s*>=\s*STAGES\.length/,
  'reached.failed >= STAGES.length': /reached\.failed\s*>=\s*STAGES\.length/,
  'casesReachingLargeCorpus >= 2': /casesReachingLargeCorpus\s*>=\s*2/,
  'seenConflict.true > 0': /seenConflict\.true\s*>\s*0/,
  'seenConflict.false > 0': /seenConflict\.false\s*>\s*0/,
};

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Scenario 01: each property file, run alone, is green ────────────────
  scoped(/^(.+) runs alone under the properties config$/, (ctx, file) => {
    state(ctx, file);
    ctx.bl1578lastFile = file;
  });

  scoped(/^every test in it passes$/, (ctx) => {
    const files = Object.keys(ctx.bl1578 || {});
    for (const file of files) {
      const s = ctx.bl1578[file];
      assert.equal(s.result.status, 0, `expected ${file} to pass, got:\n${s.output.slice(-4000)}`);
    }
  });

  // ── Scenario 02: each constructed loop reports reaching its floor ───────
  scoped(/^the run prints a BL-1578 reach map for (.+)$/, (ctx, test) => {
    const mapKey = TEST_TO_MAP_KEY[test];
    if (!mapKey) {
      throw new Error(`unknown test example value: "${test}"`);
    }
    const file = ctx.bl1578lastFile;
    const s = ctx.bl1578[file];
    const map = s.maps[mapKey];
    assert.ok(map, `no reach map for "${mapKey}" in ${file}'s output:\n${s.output.slice(-4000)}`);
    ctx.bl1578current = map;
    ctx.bl1578currentTest = test;
  });

  scoped(/^that reach map counts at least (\d+) (.+)$/, (ctx, floor, population) => {
    const field = POPULATION_TO_FIELD[population];
    if (!field) {
      throw new Error(`unknown population example value: "${population}"`);
    }
    const map = ctx.bl1578current;
    // Exact, not >=: every one of these fields (cells/regimes/arms and each
    // rarest-cell/regime/arm draw count) is a fixed constant derived from the
    // file's own budget/cell-count at module load (runsPerCell, *.length) -
    // never a per-run sample - so the Examples table's floor is the value the
    // run must reach, not merely a lower bound. A ">=" check cannot tell the
    // declared floor apart from any smaller one when the constant already
    // clears it (BL-1578 hardening: gherkin mutant m13, 2 -> 0, survived a
    // ">=" check because meanTicketTimeCost's `regimes` is always exactly
    // REGIMES.length=2).
    assert.equal(
      map[field] || 0,
      Number(floor),
      `${ctx.bl1578currentTest} counted ${map[field] || 0} ${population}, expected exactly ${floor}: ${JSON.stringify(map)}`
    );
  });

  // ── Scenario 03: the reach-floor assertions are still present in source ──
  scoped(/^the source of (.+) is read$/, (ctx, file) => {
    const known = FILES[file];
    if (!known) {
      throw new Error(`unknown file example value: "${file}"`);
    }
    ctx.bl1578source = ctx.bl1578source || {};
    ctx.bl1578source[file] = fs.readFileSync(path.join(EXTENSION_DIR, known.rel), 'utf8');
    ctx.bl1578lastSourceFile = file;
  });

  scoped(/^it still asserts the floor (.+)$/, (ctx, floor) => {
    const re = SOURCE_FLOOR_RE[floor];
    if (!re) {
      throw new Error(`unknown floor example value: "${floor}"`);
    }
    const source = ctx.bl1578source[ctx.bl1578lastSourceFile];
    assert.ok(
      re.test(source),
      `${ctx.bl1578lastSourceFile} no longer asserts the floor "${floor}" (expected to match ${re})`
    );
  });
}

module.exports = { registerSteps };
