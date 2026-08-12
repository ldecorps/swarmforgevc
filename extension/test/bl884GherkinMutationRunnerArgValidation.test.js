'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-884: run_gherkin_mutation.sh must refuse a mis-ordered call (a level
// string landing in the steps-module slot) or an unrecognized level BEFORE
// any mutant runs - the vendored mutator otherwise crashes every mutant with
// MODULE_NOT_FOUND and the crash reads as a false-clean 100%-killed
// manifest (the BL-715 near-miss). Spawns the real script per the ticket's
// guard-placement constraint: specs/pipeline/test/ is run by no standing
// gate, so this extension/test/ file IS the gate - shell has no mutation/
// CRAP/DRY wiring (BL-472 deferred).
const SCRIPT = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'scripts', 'run_gherkin_mutation.sh');
const REAL_STEPS_MODULE = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps', 'index.js');

function runScript(args) {
  const result = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 20000 });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

// A fake feature-file path is safe for the two rejection cases: validation
// runs before the feature-file argument is ever touched (out of scope per
// the ticket - existing behavior there is unchanged).
function fakeFeaturePath(dir) {
  return path.join(dir, 'not-a-real.feature');
}

test('BL-884: rejects a mis-ordered call (level string in the steps-module slot)', () => {
  const dir = mkTmpDir('bl884-mutation-args-');
  const workDir = path.join(dir, 'work');

  const { status, stderr } = runScript([fakeFeaturePath(dir), workDir, 'hard']);

  assert.equal(status, 3);
  assert.match(stderr, /Usage: run_gherkin_mutation\.sh/);
  assert.match(stderr, /steps-module path 'hard' is not an existing file/);
  assert.equal(fs.existsSync(workDir), false, 'no work dir / manifest should be written on rejection');
});

test('BL-884: rejects an unrecognized level with correctly-positioned arguments', () => {
  const dir = mkTmpDir('bl884-mutation-args-');
  const workDir = path.join(dir, 'work');

  const { status, stderr } = runScript([fakeFeaturePath(dir), workDir, REAL_STEPS_MODULE, 'bogus']);

  assert.equal(status, 3);
  assert.match(stderr, /Usage: run_gherkin_mutation\.sh/);
  assert.match(stderr, /level 'bogus' must be one of full, hard, soft/);
  assert.equal(fs.existsSync(workDir), false, 'no work dir / manifest should be written on rejection');
});

test('BL-884: a correct 4-positional call is unaffected (exit 0/1/2 contract intact)', () => {
  const dir = mkTmpDir('bl884-mutation-args-');
  const workDir = path.join(dir, 'work');
  // Minimal valid Gherkin with no Scenario Outline - the vendored mutator
  // finds nothing to mutate and reports the pre-existing "inapplicable"
  // outcome (exit 2), proving the new validation does not intercept a
  // legitimate call. A throwaway fixture (not a real repo feature file)
  // avoids stamping a mutation manifest onto tracked content.
  const featurePath = path.join(dir, 'control.feature');
  fs.writeFileSync(
    featurePath,
    'Feature: BL-884 control fixture\n\n  Scenario: a plain scenario with no outline\n    Given a control fixture\n'
  );

  const { status, stdout, stderr } = runScript([featurePath, workDir, REAL_STEPS_MODULE, 'soft']);

  assert.equal(status, 2, `expected the pre-existing inapplicable exit code, got status=${status} stderr=${stderr}`);
  assert.doesNotMatch(stderr, /Usage: run_gherkin_mutation\.sh/);
  const report = JSON.parse(stdout);
  assert.equal(report.outcome, 'inapplicable');
});
