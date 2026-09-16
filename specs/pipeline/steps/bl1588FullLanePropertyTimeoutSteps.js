'use strict';

// BL-1588: step handlers for "Fixture-spawning property files are green in a
// full lane run" (specifier-authored feature, lands with this handler in the
// same parcel - BL-233, BL-1371). Scenarios 01/02 follow BL-1579's own shape
// exactly (bl1579FixtureSpawningPropertiesUnderLoadSteps.js): scenario 01
// drives the REAL property files as real vitest subprocesses, scenario 02
// reads the REAL evidence file this parcel writes. Scenario 03 is a pure
// in-process check of propertyLaneContentionBudget.js's own budget
// resolution (BL-1541 shape) - no subprocess, since the mechanism under test
// IS the function, never a restatement of its arithmetic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { propertyLaneTimeoutMs } = require('../../../extension/test/helpers/propertyLaneContentionBudget');

const FEATURE = 'BL-1588 Fixture-spawning property files are green in a full lane run';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'backlog', 'evidence');

const FILES = {
  'extension/test/bl1308SiblingDetectorCoversReplay.property.test.js': {
    rel: 'test/bl1308SiblingDetectorCoversReplay.property.test.js',
    basename: 'bl1308SiblingDetectorCoversReplay.property.test.js',
  },
  'extension/test/bl1315OwnPathsFullRangeInvariants.property.test.js': {
    rel: 'test/bl1315OwnPathsFullRangeInvariants.property.test.js',
    basename: 'bl1315OwnPathsFullRangeInvariants.property.test.js',
  },
  'extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js': {
    rel: 'test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js',
    basename: 'bl1343ReplayNeverDropsOwnPathInvariants.property.test.js',
  },
  'extension/test/bl1354SharedPathLandedSiblingInvariants.property.test.js': {
    rel: 'test/bl1354SharedPathLandedSiblingInvariants.property.test.js',
    basename: 'bl1354SharedPathLandedSiblingInvariants.property.test.js',
  },
};

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
  ctx.bl1588 = ctx.bl1588 || {};
  if (!ctx.bl1588[file]) {
    const result = runProperty(known.rel);
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    ctx.bl1588[file] = { result, output };
  }
  return ctx.bl1588[file];
}

// Every evidence file this parcel could write for a given basename - either
// a "reproduced and fixed" file or a "retired, no repro" file (BL-1588's own
// acceptance criteria are disjunctive, same shape as BL-1579's).
function evidenceCandidates(basename) {
  return fs
    .readdirSync(EVIDENCE_DIR)
    .filter((f) => f.startsWith('BL-1588-') && f.endsWith('.md'))
    .map((f) => path.join(EVIDENCE_DIR, f))
    .filter((full) => fs.readFileSync(full, 'utf8').includes(basename));
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Scenario 01: each property file, run alone, is green ────────────────
  scoped(/^(.+) runs alone under the properties config$/, (ctx, file) => {
    state(ctx, file);
    ctx.bl1588lastFile = file;
  });

  scoped(/^every test in it passes$/, (ctx) => {
    const files = Object.keys(ctx.bl1588 || {});
    for (const file of files) {
      const s = ctx.bl1588[file];
      assert.equal(s.result.status, 0, `expected ${file} to pass, got:\n${s.output.slice(-4000)}`);
    }
  });

  // ── Scenario 02: the parcel's evidence records the outcome per file ─────
  scoped(/^the parcel's evidence for (.+) is read$/, (ctx, file) => {
    const known = FILES[file];
    if (!known) {
      throw new Error(`unknown file example value: "${file}"`);
    }
    const candidates = evidenceCandidates(known.basename);
    assert.ok(candidates.length > 0, `no BL-1588 evidence file mentions ${known.basename}`);
    ctx.bl1588evidence = ctx.bl1588evidence || {};
    ctx.bl1588evidence[file] = candidates.map((c) => fs.readFileSync(c, 'utf8')).join('\n---\n');
    ctx.bl1588lastEvidenceFile = file;
  });

  scoped(
    /^it records the failing test name and the timeout message verbatim from a full property-lane run and the change that removed it, or it records at least 5 full lane runs and 20 runs alone all green and the register row retired on that evidence$/,
    (ctx) => {
      const file = ctx.bl1588lastEvidenceFile;
      const text = ctx.bl1588evidence[file];

      const firedRoute = /test timed out/i.test(text) && /removed|fixed|remedy|resolved/i.test(text);
      const retiredRoute =
        /\b5\b[^\n]*full[- ]lane runs?/is.test(text) &&
        /\b20\b[^\n]*(alone|runs alone)/is.test(text) &&
        /retired/i.test(text);

      assert.ok(
        firedRoute || retiredRoute,
        `evidence for ${file} names neither a fired-and-fixed red nor a retired-on-green-runs outcome:\n${text.slice(0, 2000)}`,
      );
    },
  );

  // ── Scenario 03: the budget reflects the lane's own concurrency ─────────
  scoped(/^the property lane is running (\d+) worker forks$/, (ctx, forks) => {
    ctx.bl1588forks = Number(forks);
  });

  scoped(/^the host's 1-minute load average reads ([\d.]+), inside the quiet band$/, (ctx, load) => {
    ctx.bl1588load = Number(load);
  });

  scoped(/^the per-test budget for a fixture-spawning property test is resolved from a 20000 ms base$/, (ctx) => {
    assert.ok(Number.isFinite(ctx.bl1588forks), 'forks was never set by the Given step');
    assert.ok(Number.isFinite(ctx.bl1588load), 'load was never set by the And step');
    ctx.bl1588budgetMs = propertyLaneTimeoutMs(20000, {
      forksFn: () => ctx.bl1588forks,
      loadavg1mFn: () => ctx.bl1588load,
    });
  });

  scoped(/^the effective budget is (.+)$/, (ctx, outcome) => {
    const ms = ctx.bl1588budgetMs;
    if (outcome === 'exactly 20000 ms') {
      assert.equal(ms, 20000, `expected exactly 20000ms, got ${ms}`);
    } else if (outcome === 'more than 20000 ms') {
      assert.ok(ms > 20000, `expected more than 20000ms, got ${ms}`);
    } else if (outcome === 'more than the 8-fork budget') {
      const eightForkMs = propertyLaneTimeoutMs(20000, {
        forksFn: () => 8,
        loadavg1mFn: () => ctx.bl1588load,
      });
      assert.ok(ms > eightForkMs, `expected more than the 8-fork budget (${eightForkMs}ms), got ${ms}`);
    } else {
      throw new Error(`unknown outcome example value: "${outcome}"`);
    }
  });
}

module.exports = { registerSteps };
