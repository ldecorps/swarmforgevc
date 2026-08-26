'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-884 declared invariant (property authorship rests with the coder,
// first pass - BL-654): "The runner never starts a mutation run it cannot
// assert in: a steps-module path that is not an existing file, or a level
// outside {full, hard, soft}, exits non-zero with a usage message before
// any mutant runs and writes no manifest." Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs).
//
// Both fc.property blocks below spawn the REAL script (no mock of the
// validation logic) - the invariant is about the script's own boundary
// behavior, and specs/pipeline/test/ is run by no standing gate (shell has
// no mutation/CRAP/DRY wiring, BL-472 deferred), so this IS the gate.
const SCRIPT = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'scripts', 'run_gherkin_mutation.sh');
const REAL_STEPS_MODULE = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps', 'index.js');
const VALID_LEVELS = ['full', 'hard', 'soft'];

function runScript(args) {
  const result = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 20000 });
  return { status: result.status, stderr: result.stderr || '' };
}

function assertRejectedBeforeAnyRun(result, workDir) {
  assert.notEqual(result.status, 0, `expected a non-zero exit, got 0. stderr=${result.stderr}`);
  assert.match(result.stderr, /Usage: run_gherkin_mutation\.sh/, `expected a usage message. stderr=${result.stderr}`);
  assert.equal(fs.existsSync(workDir), false, 'no manifest/work-dir should be written on rejection');
}

// Invariant, steps-module dimension: for ANY steps-module path that is not
// an existing file (a plausible near-miss OR arbitrary garbage), with ANY
// level (including a VALID one), the call is always rejected. Mixing in
// the real, valid levels proves rejection is driven by the steps-module
// check, not a side effect of also having a bad level.
const plausibleNearMissSuffixArb = fc.constantFrom(
  'hard',
  'soft',
  'full',
  'index.js',
  'steps/index.js',
  'nested/deep/module.js',
  'index.ts',
  'index.js.bak'
);
const garbageSuffixArb = fc.string({ minLength: 1, maxLength: 24 });
const badStepsModuleSuffixArb = fc.oneof(plausibleNearMissSuffixArb, garbageSuffixArb);
const anyLevelArb = fc.constantFrom(...VALID_LEVELS, 'bogus', 'FULL', '');

// Strips `.`/`..`/empty path segments so a fuzzed suffix can never collapse
// the constructed candidate back up to (or above) the "missing-steps-
// module" directory it is meant to live under - which would make it
// accidentally resolve to a directory that DOES exist, breaking the
// generator's own "not an existing file" precondition rather than
// exercising the script.
function sanitizeSuffix(suffix) {
  const cleaned = suffix
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.' && seg !== '..')
    .join('/');
  return cleaned.length > 0 ? cleaned : 'x';
}

test('property (BL-884 invariant, steps-module dimension): any non-existent steps-module path is always rejected, regardless of level', () => {
  fc.assert(
    fc.property(badStepsModuleSuffixArb, anyLevelArb, (rawSuffix, level) => {
      const dir = mkTmpDir('bl884-inv-steps-');
      const workDir = path.join(dir, 'work');
      const badStepsModule = path.join(dir, 'missing-steps-module', sanitizeSuffix(rawSuffix));
      assert.equal(fs.existsSync(badStepsModule), false, 'generator invariant: candidate must not pre-exist');

      const result = runScript([path.join(dir, 'not-a-real.feature'), workDir, badStepsModule, level]);
      assertRejectedBeforeAnyRun(result, workDir);
    }),
    { numRuns: 40 }
  );
});

// Invariant, level dimension: for ANY level string outside
// {full, hard, soft} (a plausible near-miss OR arbitrary garbage), with a
// REAL, existing steps-module path, the call is always rejected. Isolates
// the level check from the steps-module check. Empty string is excluded:
// bash's `${4:-soft}` treats an explicitly-empty 4th positional the same
// as an omitted one (falls back to the valid default "soft"), so it is not
// actually a member of the "invalid level" domain this invariant covers.
const nearMissLevelArb = fc.constantFrom('Full', 'FULL', 'Hard', 'Soft', ' soft', 'soft ', 'ful', 'hards', 'sof', 'full ');
const garbageLevelArb = fc.string({ minLength: 1, maxLength: 24 }).filter((s) => !VALID_LEVELS.includes(s));
const invalidLevelArb = fc.oneof(nearMissLevelArb, garbageLevelArb).filter((s) => s.length > 0 && !VALID_LEVELS.includes(s));

test('property (BL-884 invariant, level dimension): any level outside {full, hard, soft} is always rejected, with a real steps-module path', () => {
  fc.assert(
    fc.property(invalidLevelArb, (level) => {
      const dir = mkTmpDir('bl884-inv-level-');
      const workDir = path.join(dir, 'work');

      const result = runScript([path.join(dir, 'not-a-real.feature'), workDir, REAL_STEPS_MODULE, level]);
      assertRejectedBeforeAnyRun(result, workDir);
    }),
    { numRuns: 40 }
  );
});
