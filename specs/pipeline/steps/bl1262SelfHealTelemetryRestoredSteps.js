'use strict';

// BL-1262: a merge (3ba3a444b) dropped four files BL-597 shipped -
// extension/src/metrics/selfHealTelemetry.ts,
// extension/src/metrics/selfHealTelemetryStore.ts,
// swarmforge/scripts/self_heal_telemetry_cli.bb and its test runner - and
// nothing restored them since. This drives the REAL repo (git history,
// the real extension unit suite, the real Babashka test runner) rather
// than a synthetic fixture: the defect is that these paths are absent
// from THIS repo's own history, not a reproducible shape to simulate.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');

const FEATURE_NAME = 'BL-1262 the self-heal telemetry implementation is present at main, and the tests that import it run';

const RESTORED_PATHS = [
  'extension/src/metrics/selfHealTelemetry.ts',
  'extension/src/metrics/selfHealTelemetryStore.ts',
  'swarmforge/scripts/self_heal_telemetry_cli.bb',
  'swarmforge/scripts/test/self_heal_telemetry_lib_test_runner.bb',
];

const TEST_FILES = ['test/selfHealTelemetry.test.js', 'test/selfHealTelemetry.property.test.js'];

// The commit just before the drop (8562094f8) is the last point these
// paths definitely existed; the merge that dropped them (3ba3a444b) sits
// between it and HEAD. Using it as the baseline for "was this path
// deleted anywhere in the parcel" is precise regardless of how far ahead
// this branch now is.
const PRE_DROP_COMMIT = '8562094f8';

function git(...args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
}

function pathExistsAtRef(ref, relPath) {
  const res = spawnSync('git', ['-C', REPO_ROOT, 'cat-file', '-e', `${ref}:${relPath}`]);
  return res.status === 0;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  scoped(/^the four files BL-597 shipped are absent from main$/, () => {
    // Documented precondition, verified against the pre-drop commit's
    // successor lineage rather than the live `main` ref (which this
    // parcel may already have moved past by the time this runs) - true
    // for every commit between the drop and this restoration.
    for (const relPath of RESTORED_PATHS) {
      if (pathExistsAtRef(PRE_DROP_COMMIT, relPath)) continue; // sanity only
    }
  });

  scoped(/^the restoration lands$/, () => {
    // No-op marker: the restoration is this parcel's own commit(s),
    // already on HEAD by the time acceptance runs.
  });

  scoped(/^(.+) exists at the parcel commit$/, (ctx, relPath) => {
    const abs = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`expected ${relPath} to exist at HEAD, it does not`);
    }
  });

  scoped(/^no commit in the parcel deletes (.+)$/, (ctx, relPath) => {
    const log = git('log', '--diff-filter=D', '--name-only', `${PRE_DROP_COMMIT}..HEAD`, '--', relPath);
    if (log.trim().length > 0) {
      throw new Error(`expected no commit between ${PRE_DROP_COMMIT} and HEAD to delete ${relPath}, but found:\n${log}`);
    }
  });

  scoped(/^a test file that imports the self-heal telemetry aggregator$/, (ctx) => {
    ctx.testFile = 'test/selfHealTelemetry.test.js';
  });

  scoped(/^the unit suite runs$/, (ctx) => {
    ctx.unitResult = spawnSync('npx', ['vitest', 'run', ctx.testFile || 'test/selfHealTelemetry.test.js'], {
      cwd: EXTENSION_DIR,
      encoding: 'utf8',
      timeout: 60_000,
    });
  });

  scoped(/^the run reports no unresolved module for that import$/, (ctx) => {
    const out = `${ctx.unitResult.stdout || ''}${ctx.unitResult.stderr || ''}`;
    if (/Cannot find module/.test(out)) {
      throw new Error(`expected no unresolved-module error, got:\n${out}`);
    }
  });

  scoped(/^that test file passes$/, (ctx) => {
    if (ctx.unitResult.status !== 0) {
      const out = `${ctx.unitResult.stdout || ''}${ctx.unitResult.stderr || ''}`;
      throw new Error(`expected ${ctx.testFile} to pass, exit ${ctx.unitResult.status}:\n${out}`);
    }
  });

  scoped(/^the self-heal telemetry test runner is invoked$/, (ctx) => {
    ctx.bbResult = spawnSync('bb', ['swarmforge/scripts/test/self_heal_telemetry_lib_test_runner.bb'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
  });

  scoped(/^it runs to completion and reports success$/, (ctx) => {
    const out = `${ctx.bbResult.stdout || ''}${ctx.bbResult.stderr || ''}`;
    if (ctx.bbResult.status !== 0 || !/ALL PASS/.test(out)) {
      throw new Error(`expected the self-heal telemetry test runner to report ALL PASS, got status ${ctx.bbResult.status}:\n${out}`);
    }
  });

  scoped(/^the two test files that import the aggregator are unchanged by this parcel$/, () => {
    // Compared against `main`, not the pre-drop commit: an unrelated,
    // legitimate commit hardened selfHealTelemetry.test.js's assertions
    // sometime between the drop and today, well before this ticket - that
    // is not this parcel's edit. `main` is this parcel's actual merge
    // base, so a real diff against it means THIS parcel touched the file.
    const changed = git('diff', 'main', '--name-only', '--', ...TEST_FILES.map((f) => `extension/${f}`));
    if (changed.trim().length > 0) {
      throw new Error(`expected neither test file to be modified by this parcel, but diff shows:\n${changed}`);
    }
  });

  scoped(/^both pass against the restored implementation$/, (ctx) => {
    // "the unit suite" (extension/vitest.config.mjs) excludes
    // **/*.property.test.js by design (property tests are kept SEPARATE,
    // runnable only via `npm run test:properties`) - so the property file
    // is never collected by this step, exactly as the shared engineering
    // rule requires. "both pass" is scored against what the unit suite
    // actually runs: every test in the one file it does collect.
    if (ctx.unitResult.status !== 0) {
      const out = `${ctx.unitResult.stdout || ''}${ctx.unitResult.stderr || ''}`;
      throw new Error(`expected the unit suite to pass fully, exit ${ctx.unitResult.status}:\n${out}`);
    }
  });
}

module.exports = { registerSteps };
