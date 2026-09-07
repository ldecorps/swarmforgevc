'use strict';

// BL-1349: step handlers for "the slowest spawn-heavy property files fit a
// per-file budget". Drives the REAL property lane (npx vitest run <file>
// --config vitest.properties.config.mjs) for the per-file budget scenario,
// and diffs the REAL working-tree file against the REAL pre-tuning commit
// for the no-deletion scenario - never a reimplementation of either the
// lane or git.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'BL-1349 The slowest spawn-heavy property files fit a per-file budget';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const TEST_DIR = path.join(EXTENSION_DIR, 'test');
const BUDGET_MS = 15000;

// The coder commit that tuned the three files below. The "before" state
// must be read from immediately before THIS commit, never from HEAD:
// every pipeline stage after coder already has this commit merged into
// its own worktree, so by the time any later stage runs this scenario
// `HEAD:<path>` and the on-disk file are byte-identical and the
// comparison can never fail (BL-1349 architect bounce, 2026-09-06).
const TUNING_COMMIT = '7f0e5766c9';

// BL-421/engineering.prompt: a Scenario Outline's Examples column is
// validated against an explicit KNOWN_VALUES lookup, never a bare
// passthrough - so an Examples row this ticket never named cannot silently
// pass by resolving to a path nobody asked to budget.
const KNOWN_FILES = [
  'onboarderLauncherPidGuard.property.test.js',
  'bl1252CommitGuardAggregationInvariants.property.test.js',
  'bl787NamedTunnelInvariants.property.test.js',
];
function knownFile(name) {
  if (!KNOWN_FILES.includes(name)) {
    throw new Error(`bl1349: unrecognized <file> example value "${name}"`);
  }
  return name;
}

// A test's own name, wherever it falls relative to `test(` (bare on the
// same line, or on its own line when a third timeout argument follows) -
// \s already spans the newline between `test(` and the opening quote.
function testNames(source) {
  const names = [];
  const re = /\btest\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source))) {
    names.push(m[1]);
  }
  return names;
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function registerBl1349SpawnHeavyPropertyBudgetSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^the property lane runs from the extension directory$/, (ctx) => {
    ctx.extensionDir = EXTENSION_DIR;
  });

  // ── spawn-heavy-file-fits-budget-01 (Scenario Outline) ────────────────
  scoped(/^the property file (.+)$/, (ctx, file) => {
    ctx.propertyFile = knownFile(file);
  });

  scoped(/^it is run alone in the property lane$/, (ctx) => {
    const startedAt = Date.now();
    const result = spawnSync(
      'npx',
      ['vitest', 'run', path.join(TEST_DIR, ctx.propertyFile), '--config', 'vitest.properties.config.mjs'],
      { cwd: ctx.extensionDir, encoding: 'utf8', timeout: 120000 }
    );
    ctx.runDurationMs = Date.now() - startedAt;
    ctx.runResult = result;
  });

  scoped(/^it completes within 15 seconds$/, (ctx) => {
    assert.ok(
      ctx.runDurationMs <= BUDGET_MS,
      `expected ${ctx.propertyFile} to complete within ${BUDGET_MS}ms alone, took ${ctx.runDurationMs}ms`
    );
  });

  scoped(/^it reports no failing test$/, (ctx) => {
    assert.equal(
      ctx.runResult.status,
      0,
      `expected ${ctx.propertyFile} to report no failing test, got exit ${ctx.runResult.status}:\n${ctx.runResult.stdout}${ctx.runResult.stderr}`
    );
  });

  // ── no-property-is-dropped-02 ──────────────────────────────────────────
  scoped(/^the three tuned property files$/, (ctx) => {
    ctx.tunedFiles = KNOWN_FILES.slice();
  });

  scoped(/^their properties are compared with the parent commit$/, (ctx) => {
    ctx.propertyDiffs = ctx.tunedFiles.map((file) => {
      const relPath = path.join('extension', 'test', file).split(path.sep).join('/');
      const before = execFileSync('git', ['show', `${TUNING_COMMIT}^:${relPath}`], { cwd: REPO_ROOT, encoding: 'utf8' });
      const after = require('node:fs').readFileSync(path.join(TEST_DIR, file), 'utf8');
      return {
        file,
        namesBefore: testNames(before),
        namesAfter: testNames(after),
        propertyCallsBefore: countOccurrences(before, 'fc.property('),
        propertyCallsAfter: countOccurrences(after, 'fc.property('),
        assertCallsBefore: countOccurrences(before, 'fc.assert('),
        assertCallsAfter: countOccurrences(after, 'fc.assert('),
      };
    });
  });

  scoped(/^every property present before is still present$/, (ctx) => {
    for (const diff of ctx.propertyDiffs) {
      const missingNames = diff.namesBefore.filter((n) => !diff.namesAfter.includes(n));
      assert.equal(
        missingNames.length,
        0,
        `${diff.file}: test(s) present at HEAD but missing now: ${JSON.stringify(missingNames)}`
      );
      assert.ok(
        diff.propertyCallsAfter >= diff.propertyCallsBefore,
        `${diff.file}: fc.property( call count dropped from ${diff.propertyCallsBefore} to ${diff.propertyCallsAfter}`
      );
      assert.ok(
        diff.assertCallsAfter >= diff.assertCallsBefore,
        `${diff.file}: fc.assert( call count dropped from ${diff.assertCallsBefore} to ${diff.assertCallsAfter}`
      );
    }
  });
}

module.exports = { registerSteps: registerBl1349SpawnHeavyPropertyBudgetSteps };
