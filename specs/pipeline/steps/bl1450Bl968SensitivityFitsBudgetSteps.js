'use strict';

// BL-1450: step handlers for "The BL-968 guard-sensitivity property fits a
// budget with every cell and floor kept". Scenarios 01/02 drive the REAL
// property file (extension/test/bl968MaterializedGuardSensitivity.property.test.js)
// through the real property lane (npx vitest run --config
// vitest.properties.config.mjs) and read the coverage line it prints -
// never a reimplementation of the lane. Scenario 03 drives the SAME guard
// core the unit lane runs (extension/test/helpers/materializedRegistryGuard.js -
// materializeCurrentPipeline/plantOffender/registryLoadVerdict, the same
// import bl968StepRegistryMaterializedTreeSteps.js already uses) with a
// hand-built offender for each of the three named (class, depth) examples,
// matching the exact shapes the property file's own offenderSource
// constructs - never a reimplementation of the guard itself.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  materializeCurrentPipeline,
  registryLoadVerdict,
  plantOffender,
} = require('../../../extension/test/helpers/materializedRegistryGuard');

const FEATURE = 'BL-1450 The BL-968 guard-sensitivity property fits a budget with every cell and floor kept';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const TEST_FILE_REL = path.join('test', 'bl968MaterializedGuardSensitivity.property.test.js');
const BUDGET_MS = 60000;

// Mirrors the tuned property file's own constants (BL-1450's own "How":
// floors re-derived from RUNS_PER_CELL, never re-typed as literals) - kept
// here only to state what the acceptance run's coverage line is checked
// against, never re-fed into the property file itself.
const REQUIRED_CLASSES = ['git-root-resolve', 'live-repo-read', 'benign-subprocess'];
const REQUIRED_DEPTHS = ['direct', 'via-lib'];
const RUNS_PER_CELL = 1;
const CLASS_FLOOR = REQUIRED_DEPTHS.length * RUNS_PER_CELL;
const DEPTH_FLOOR = REQUIRED_CLASSES.length * RUNS_PER_CELL;

// BL-421/engineering.prompt: a Scenario Outline's Examples column is
// validated against an explicit KNOWN_VALUES lookup, never a bare
// passthrough.
const KNOWN_EXAMPLES = new Set(['git-root-resolve|direct', 'live-repo-read|via-lib', 'benign-subprocess|via-lib']);

function runPropertyFileAlone() {
  const startedAt = Date.now();
  const result = spawnSync(
    'npx',
    ['vitest', 'run', TEST_FILE_REL, '--config', 'vitest.properties.config.mjs'],
    { cwd: EXTENSION_DIR, encoding: 'utf8', timeout: 120000 }
  );
  return { durationMs: Date.now() - startedAt, result };
}

function parseCoverageLine(output) {
  const m = /BL-968 sensitivity coverage over \d+ draws:\s*(\{.*\})/.exec(output);
  assert.ok(m, `expected a "BL-968 sensitivity coverage..." line in the output, got:\n${output}`);
  return JSON.parse(m[1]);
}

// The exact offender shapes bl968MaterializedGuardSensitivity.property.test.js's
// own offenderSource constructs for these three (class, depth) pairs -
// restated here (never imported from the test file, which exports
// nothing) so this scenario proves the SAME sensitivity the unit property
// exercises, through the same guard core.
function buildOffenderFiles(cls, depth) {
  if (cls === 'git-root-resolve' && depth === 'direct') {
    return {
      files: {
        'bl1450PlantedSteps.js': [
          "const { resolveMainCheckout } = require('./lib/mainCheckout');",
          'const MAIN_CHECKOUT = resolveMainCheckout(__dirname);',
          'module.exports.MAIN_CHECKOUT = MAIN_CHECKOUT;',
          'module.exports.registerSteps = function registerSteps() {};',
          '',
        ].join('\n'),
      },
      expectNamed: 'bl1450PlantedSteps.js',
    };
  }
  if (cls === 'live-repo-read' && depth === 'via-lib') {
    return {
      files: {
        'lib/bl1450PlantedLib.js': [
          "const path = require('node:path');",
          "const LIVE = require('node:fs').readFileSync(path.join(__dirname, '..', '..', '..', '..', 'swarmforge/scripts/swarm_ensure.bb'), 'utf8');",
          'module.exports.LIVE = LIVE;',
          '',
        ].join('\n'),
        'bl1450PlantedSteps.js': [
          "require('./lib/bl1450PlantedLib');",
          'module.exports.registerSteps = function registerSteps() {};',
          '',
        ].join('\n'),
      },
      expectNamed: 'bl1450PlantedLib.js',
    };
  }
  if (cls === 'benign-subprocess' && depth === 'via-lib') {
    return {
      files: {
        'lib/bl1450PlantedLib.js': [
          "const { execFileSync } = require('node:child_process');",
          "const PROBE = execFileSync('git', ['--version'], { encoding: 'utf8' }).trim();",
          'module.exports.PROBE = PROBE;',
          '',
        ].join('\n'),
        'bl1450PlantedSteps.js': [
          "require('./lib/bl1450PlantedLib');",
          'module.exports.registerSteps = function registerSteps() {};',
          '',
        ].join('\n'),
      },
      expectNamed: 'bl1450PlantedLib.js',
    };
  }
  throw new Error(`bl1450: no fixture built for (${cls}, ${depth})`);
}

function rmTreeQuietly(root) {
  if (root) require('node:fs').rmSync(root, { recursive: true, force: true });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── the-file-completes-alone-within-the-budget-01 ─────────────────────
  scoped(/^the property lane's own config$/, (ctx) => {
    ctx.extensionDir = EXTENSION_DIR;
  });

  scoped(/^bl968MaterializedGuardSensitivity runs alone$/, (ctx) => {
    if (ctx.run) return; // already run earlier in this scenario
    ctx.run = runPropertyFileAlone();
  });

  scoped(/^it passes$/, (ctx) => {
    assert.equal(
      ctx.run.result.status,
      0,
      `expected the file to pass, got exit ${ctx.run.result.status}:\n${ctx.run.result.stdout}${ctx.run.result.stderr}`
    );
  });

  scoped(/^it completes within 60 seconds$/, (ctx) => {
    assert.ok(
      ctx.run.durationMs <= BUDGET_MS,
      `expected bl968MaterializedGuardSensitivity to complete within ${BUDGET_MS}ms alone, took ${ctx.run.durationMs}ms`
    );
  });

  // ── every-cell-and-floor-is-still-exercised-02 ────────────────────────
  scoped(/^its coverage line reports every required class and every required depth drawn at least once$/, (ctx) => {
    const output = `${ctx.run.result.stdout || ''}${ctx.run.result.stderr || ''}`;
    ctx.coverage = parseCoverageLine(output);
    for (const cls of REQUIRED_CLASSES) {
      assert.ok((ctx.coverage.cls[cls] || 0) >= 1, `class ${cls} never drawn: ${JSON.stringify(ctx.coverage)}`);
    }
    for (const depth of REQUIRED_DEPTHS) {
      assert.ok((ctx.coverage.depth[depth] || 0) >= 1, `depth ${depth} never drawn: ${JSON.stringify(ctx.coverage)}`);
    }
  });

  scoped(/^the reach floors asserted after the run equal the counts the cell iteration guarantees by construction$/, (ctx) => {
    for (const cls of REQUIRED_CLASSES) {
      assert.equal(ctx.coverage.cls[cls], CLASS_FLOOR, `class ${cls} count not exactly the constructed floor: ${JSON.stringify(ctx.coverage)}`);
    }
    for (const depth of REQUIRED_DEPTHS) {
      assert.equal(ctx.coverage.depth[depth], DEPTH_FLOOR, `depth ${depth} count not exactly the constructed floor: ${JSON.stringify(ctx.coverage)}`);
    }
  });

  // ── a-planted-module-still-turns-the-guard-red-03 (Scenario Outline) ──
  scoped(/^a materialized pipeline tree with a (.+) module planted at depth (.+)$/, (ctx, cls, depth) => {
    const key = `${cls}|${depth}`;
    if (!KNOWN_EXAMPLES.has(key)) {
      throw new Error(`bl1450: unrecognized <class>/<depth> example pair "${key}"`);
    }
    const made = materializeCurrentPipeline();
    ctx.guardRoot = made.root;
    ctx.pipelineDir = made.pipelineDir;
    const { files, expectNamed } = buildOffenderFiles(cls, depth);
    ctx.expectNamed = expectNamed;
    try {
      plantOffender(ctx.pipelineDir, { registerRelPath: 'bl1450PlantedSteps', files });
    } catch (err) {
      rmTreeQuietly(ctx.guardRoot);
      ctx.guardRoot = null;
      throw err;
    }
  });

  scoped(/^the BL-761 gate's registry load runs against that tree$/, (ctx) => {
    try {
      ctx.verdict = registryLoadVerdict(ctx.pipelineDir, ctx.guardRoot);
    } finally {
      rmTreeQuietly(ctx.guardRoot);
      ctx.guardRoot = null;
    }
  });

  scoped(/^the guard is red and names the planted module$/, (ctx) => {
    assert.equal(ctx.verdict.loadable, false, `expected the planted offender to make the registry unloadable, got: ${JSON.stringify(ctx.verdict)}`);
    assert.ok(
      (ctx.verdict.detail || '').includes(ctx.expectNamed),
      `the guard's detail must NAME ${ctx.expectNamed}:\n${ctx.verdict.detail}`
    );
  });
}

module.exports = { registerSteps };
