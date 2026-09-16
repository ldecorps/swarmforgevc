'use strict';

// BL-1589: step handlers for "bl1030 draw kind is constructed". Drives the
// REAL property test file as a real subprocess (the
// bl1580RevertAttributionArmsConstructedSteps.js shape) - never a
// reimplementation of its generator or of the printed reach map (BL-233,
// BL-1371).
//
// The file's real run is memoized: it shells out to bash and bb for every
// draw, so every scenario reads the SAME captured run rather than paying
// for repeats of it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1589 bl1030 draw kind is constructed';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const FILE = 'extension/test/bl1030StopFlagTokenBoundary.property.test.js';
const FILE_REL = 'test/bl1030StopFlagTokenBoundary.property.test.js';

// Matches the shape this file prints: one line for the reach map,
// `BL-1589 reach map (bl1030): <json>`.
const REACH_MAP_RE = /BL-1589 reach map \(([^)]+)\):\s*(\{[^\n]*\})/g;

function reachMaps(output) {
  const maps = {};
  for (const match of output.matchAll(REACH_MAP_RE)) {
    maps[match[1]] = JSON.parse(match[2]);
  }
  return maps;
}

function runProperty() {
  return spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', FILE_REL], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    timeout: 600000,
  });
}

function state(ctx, file) {
  if (file !== FILE) {
    throw new Error(`unknown property file value: "${file}"`);
  }
  if (!ctx.bl1589) {
    const result = runProperty();
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    ctx.bl1589 = { result, output, maps: reachMaps(output) };
  }
  return ctx.bl1589;
}

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough.
const TEST_TO_MAP_KEY = {
  bl1030: 'bl1030',
};

const POPULATION_TO_FIELD = {
  kinds: 'kinds',
  'draws of the rarest kind': 'minDrawsPerKind',
};

const SOURCE_FLOOR_RE = {
  'refusedCount >= 12': /refusedCount\s*>=\s*12/,
  'lookalikeCount >= 12': /lookalikeCount\s*>=\s*12/,
  'hits >= 5': /hits\s*>=\s*5/,
};

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  // Anchored to the exact known file text (never a bare `(.+)` capture) so
  // this never shadows the "runs alone under the properties config" step
  // below, which also starts with "the property file ".
  const FILE_ESCAPED = FILE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  scoped(new RegExp(`^the property file (${FILE_ESCAPED})$`), (ctx, file) => {
    ctx.bl1589File = file;
  });

  // ── Scenario 01: the property file, run alone, is green ──────────────────
  scoped(/^the property file runs alone under the properties config$/, (ctx) => {
    state(ctx, ctx.bl1589File);
  });

  scoped(/^every test in it passes$/, (ctx) => {
    const s = ctx.bl1589;
    assert.equal(s.result.status, 0, `expected ${ctx.bl1589File} to pass, got:\n${s.output.slice(-4000)}`);
  });

  // ── Scenario 02: the constructed loop reports reaching its floor ─────────
  scoped(/^the run prints a BL-1589 reach map for (.+)$/, (ctx, test) => {
    const mapKey = TEST_TO_MAP_KEY[test];
    if (!mapKey) {
      throw new Error(`unknown test example value: "${test}"`);
    }
    const s = ctx.bl1589;
    const map = s.maps[mapKey];
    assert.ok(map, `no reach map for "${mapKey}" in ${ctx.bl1589File}'s output:\n${s.output.slice(-4000)}`);
    ctx.bl1589current = map;
    ctx.bl1589currentTest = test;
  });

  scoped(/^that reach map counts at least (\d+) (.+)$/, (ctx, floor, population) => {
    const field = POPULATION_TO_FIELD[population];
    if (!field) {
      throw new Error(`unknown population example value: "${population}"`);
    }
    const map = ctx.bl1589current;
    // Exact, not >=: both fields (kinds/minDrawsPerKind) are fixed constants
    // derived from the file's own kind count and runsPerCell budget at
    // module load - never a per-run sample (BL-1578 hardening precedent) -
    // so the Examples table's floor is the value the run must reach, not
    // merely a lower bound.
    assert.equal(
      map[field] || 0,
      Number(floor),
      `${ctx.bl1589currentTest} counted ${map[field] || 0} ${population}, expected exactly ${floor}: ${JSON.stringify(map)}`
    );
  });

  // ── Scenario 03: the reach-floor assertions are still present in source ──
  scoped(/^the source of the property file is read$/, (ctx) => {
    ctx.bl1589source = fs.readFileSync(path.join(EXTENSION_DIR, FILE_REL), 'utf8');
  });

  scoped(/^it still asserts the floor (.+)$/, (ctx, floor) => {
    const re = SOURCE_FLOOR_RE[floor];
    if (!re) {
      throw new Error(`unknown floor example value: "${floor}"`);
    }
    assert.ok(
      re.test(ctx.bl1589source),
      `${ctx.bl1589File} no longer asserts the floor "${floor}" (expected to match ${re})`
    );
  });
}

module.exports = { registerSteps };
