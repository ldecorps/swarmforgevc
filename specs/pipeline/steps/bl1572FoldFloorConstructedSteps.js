'use strict';

// BL-1572: step handlers for "the bl1429 fold property constructs its
// combination floor". Drives the REAL property test file as a real vitest
// subprocess (the bl1555ReachFloorsConstructedSteps.js shape) - never a
// reimplementation of its generators or of the printed reach map (BL-233,
// BL-1371).
//
// The run is memoized per scenario: Background re-enters once per scenario
// per Gherkin semantics, but this file spawns one real vitest subprocess, so
// every scenario in this feature reads the SAME captured run rather than
// paying for repeats of it (BL-1358 per-mutant ceiling: one 3s run plus a
// file read for the whole feature).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1572 The bl1429 fold property constructs its combination floor';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const REL = 'test/bl1429StandingRedThrottleFoldInvariants.property.test.js';

// Matches the shape the file prints: `BL-1572 reach map (<test>): <json>`.
const REACH_MAP_RE = /BL-1572 reach map \(([^)]+)\):\s*(\{[^\n]*\})/g;

function reachMaps(output) {
  const maps = {};
  for (const match of output.matchAll(REACH_MAP_RE)) {
    maps[match[1]] = JSON.parse(match[2]);
  }
  return maps;
}

function runProperty() {
  return spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', REL], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    timeout: 600000,
  });
}

function state(ctx) {
  if (!ctx.bl1572) {
    const result = runProperty();
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    ctx.bl1572 = { result, output, maps: reachMaps(output) };
  }
  return ctx.bl1572;
}

// Every Examples column value validated against an explicit KNOWN_VALUES
// lookup (engineering.prompt's Scenario Outline rule) - never a bare
// passthrough.
const POPULATION_TO_FIELD = {
  combinations: 'combinations',
  'draws of the rarest combination': 'minDrawsPerCombination',
};

const SOURCE_FLOOR_RE = {
  'seen.size equals all 12 combinations': /seen\.size,\s*ALL_COMBINATIONS\.length/,
  'every combination drawn at least 5': /assertReachFloor\(counts,\s*ALL_COMBINATIONS,\s*INVARIANT_1_CELL_RUNS,\s*'combination'\)/,
};

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Scenario 01: the file, run alone, is green ───────────────────────────
  scoped(/^the bl1429 fold property file runs alone under the properties config$/, (ctx) => {
    state(ctx);
  });

  scoped(/^every test in the fold property file passes$/, (ctx) => {
    const s = state(ctx);
    assert.equal(s.result.status, 0, `expected ${REL} to pass, got:\n${s.output.slice(-4000)}`);
  });

  // ── Scenario 02: the constructed loop reports reaching its floor ────────
  scoped(/^the run prints a reach map for invariant 1 of the fold property$/, (ctx) => {
    const s = state(ctx);
    const map = s.maps['invariant 1'];
    assert.ok(map, `no reach map for "invariant 1" in ${REL}'s output:\n${s.output.slice(-4000)}`);
    ctx.bl1572current = map;
  });

  scoped(/^that fold reach map counts at least (\d+) (.+)$/, (ctx, floor, population) => {
    const field = POPULATION_TO_FIELD[population];
    if (!field) {
      throw new Error(`unknown population example value: "${population}"`);
    }
    const map = ctx.bl1572current;
    assert.ok(
      (map[field] || 0) >= Number(floor),
      `reach map counted only ${map[field] || 0} ${population}, floor is ${floor}: ${JSON.stringify(map)}`
    );
  });

  // ── Scenario 03: the reach-floor assertions are still present in source ──
  scoped(/^the source of the bl1429 fold property file is read$/, (ctx) => {
    ctx.bl1572source = fs.readFileSync(path.join(EXTENSION_DIR, REL), 'utf8');
  });

  scoped(/^it still asserts the fold floor (.+)$/, (ctx, floor) => {
    const re = SOURCE_FLOOR_RE[floor];
    if (!re) {
      throw new Error(`unknown floor example value: "${floor}"`);
    }
    assert.ok(re.test(ctx.bl1572source), `${REL} no longer asserts the fold floor "${floor}" (expected to match ${re})`);
  });
}

module.exports = { registerSteps };
