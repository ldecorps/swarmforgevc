'use strict';

// BL-1555: step handlers for "the bl1253 and bl956 properties construct
// their reach floors". Drives the REAL property test files as real
// subprocesses (the bl1534BoundedSweepReachSteps.js / bl1553DamageKindReachSteps.js
// shape) - never a reimplementation of their generators or of the printed
// reach maps (BL-233, BL-1371).
//
// Each file's real run is memoized (lib/lazy.js): Background re-enters once
// per scenario per Gherkin semantics, but the two property files spawn real
// vitest subprocesses, so every scenario reads the SAME captured run per
// file rather than paying for repeats of it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { lazy } = require('./lib/lazy');

const FEATURE = 'BL-1555 The bl1253 and bl956 properties construct their reach floors';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');

const FILES = {
  'extension/test/bl1253TokenOwnershipInvariants.property.test.js': {
    rel: 'test/bl1253TokenOwnershipInvariants.property.test.js',
  },
  'extension/test/bl956PipelineBoardCaptionCapInvariants.property.test.js': {
    rel: 'test/bl956PipelineBoardCaptionCapInvariants.property.test.js',
  },
};

// Matches the shape both property files print: one line per reach map,
// `BL-1555 reach map (<test>): <json>`.
const REACH_MAP_RE = /BL-1555 reach map \(([^)]+)\):\s*(\{[^\n]*\})/g;

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
  ctx.bl1555 = ctx.bl1555 || {};
  if (!ctx.bl1555[file]) {
    const result = runProperty(known.rel);
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    ctx.bl1555[file] = { result, output, maps: reachMaps(output) };
  }
  return ctx.bl1555[file];
}

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough.
const TEST_TO_MAP_KEY = {
  'the flapping test': 'flapping',
  'invariant 3': 'invariant 3',
};

const POPULATION_TO_FIELD = {
  sequences: 'sequences',
  'grid overflow boards': 'gridOverflow',
  'parked overflow boards': 'parkedOverflow',
  'epic overflow boards': 'epicsOverflow',
};

const SOURCE_FLOOR_RE = {
  'handovers >= 1': /handovers\s*>=\s*1/,
  'gridOverflowSeen >= 20': /gridOverflowSeen\s*>=\s*20/,
  'parkedOverflowSeen >= 20': /parkedOverflowSeen\s*>=\s*20/,
  'epicsOverflowSeen >= 20': /epicsOverflowSeen\s*>=\s*20/,
};

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Scenario 01: each property file, run alone, is green ────────────────
  scoped(/^(.+) runs alone under the properties config$/, (ctx, file) => {
    state(ctx, file);
    ctx.bl1555lastFile = file;
  });

  scoped(/^every test in it passes$/, (ctx) => {
    const files = Object.keys(ctx.bl1555 || {});
    for (const file of files) {
      const s = ctx.bl1555[file];
      assert.equal(s.result.status, 0, `expected ${file} to pass, got:\n${s.output.slice(-4000)}`);
    }
  });

  // ── Scenario 02: each constructed arm reports reaching its floor ────────
  scoped(/^the run prints a reach map for (.+)$/, (ctx, test) => {
    const mapKey = TEST_TO_MAP_KEY[test];
    if (!mapKey) {
      throw new Error(`unknown test example value: "${test}"`);
    }
    const file = ctx.bl1555lastFile;
    const s = ctx.bl1555[file];
    const map = s.maps[mapKey];
    assert.ok(map, `no reach map for "${mapKey}" in ${file}'s output:\n${s.output.slice(-4000)}`);
    ctx.bl1555current = map;
    ctx.bl1555currentTest = test;
  });

  scoped(/^that reach map counts at least (\d+) (.+)$/, (ctx, floor, population) => {
    const field = POPULATION_TO_FIELD[population];
    if (!field) {
      throw new Error(`unknown population example value: "${population}"`);
    }
    const map = ctx.bl1555current;
    assert.ok(
      (map[field] || 0) >= Number(floor),
      `${ctx.bl1555currentTest} counted only ${map[field] || 0} ${population}, floor is ${floor}: ${JSON.stringify(map)}`
    );
  });

  // ── Scenario 03: the reach-floor assertions are still present in source ──
  scoped(/^the source of (.+) is read$/, (ctx, file) => {
    const known = FILES[file];
    if (!known) {
      throw new Error(`unknown file example value: "${file}"`);
    }
    ctx.bl1555source = ctx.bl1555source || {};
    ctx.bl1555source[file] = fs.readFileSync(path.join(EXTENSION_DIR, known.rel), 'utf8');
    ctx.bl1555lastSourceFile = file;
  });

  scoped(/^it still asserts the floor (.+)$/, (ctx, floor) => {
    const re = SOURCE_FLOOR_RE[floor];
    if (!re) {
      throw new Error(`unknown floor example value: "${floor}"`);
    }
    const source = ctx.bl1555source[ctx.bl1555lastSourceFile];
    assert.ok(
      re.test(source),
      `${ctx.bl1555lastSourceFile} no longer asserts the floor "${floor}" (expected to match ${re})`
    );
  });
}

module.exports = { registerSteps };
