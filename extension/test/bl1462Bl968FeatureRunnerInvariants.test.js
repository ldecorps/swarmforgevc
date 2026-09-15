'use strict';

// BL-1462 hardening: assertAllFourScenariosPass (lib/bl1462Bl968FeatureRunner.js)
// had no direct unit coverage - only real spawnSync-driven acceptance runs
// (specs/features/BL-1462-...feature scenarios 01/03), which take ~30-50s
// each and, for scenario 01, are structurally unable to discriminate this
// function's own logic (the master checkout genuinely lacks the fix, so it
// fails the same way whether or not this assertion's own logic is intact).
// This file drives it directly against CANNED Node-test-runner TAP text -
// the "real interpreter" here is the regex/status logic itself, not a
// process to spawn.

const assert = require('node:assert/strict');
const { assertAllFourScenariosPass } = require('../../specs/pipeline/steps/lib/bl1462Bl968FeatureRunner');

function tap(lines) {
  return { status: 0, stdout: lines.join('\n'), stderr: '' };
}

const ALL_PASS = tap([
  'TAP version 13',
  '# Subtest: a',
  'ok 1 - a',
  '# Subtest: b',
  'ok 2 - b',
  '# Subtest: c',
  'ok 3 - c',
  '# Subtest: d',
  'ok 4 - d',
  '1..4',
]);

test('BL-1462: assertAllFourScenariosPass accepts a real 4/4 "ok" TAP run', () => {
  assert.doesNotThrow(() => assertAllFourScenariosPass(ALL_PASS, 'the master checkout'));
});

test('BL-1462: assertAllFourScenariosPass throws when any scenario reports "not ok"', () => {
  const withFailure = tap([
    'ok 1 - a',
    'ok 2 - b',
    'not ok 3 - c',
    'ok 4 - d',
    '1..4',
  ]);
  assert.throws(() => assertAllFourScenariosPass(withFailure, 'the master checkout'), /reported failing scenarios/);
});

test('BL-1462: assertAllFourScenariosPass throws when fewer than 4 scenarios reported ok (a scenario silently never ran)', () => {
  const short = tap(['ok 1 - a', 'ok 2 - b', 'ok 3 - c', '1..3']);
  assert.throws(() => assertAllFourScenariosPass(short, 'the master checkout'), /expected all 4/);
});

test('BL-1462: assertAllFourScenariosPass throws when the process exit status is nonzero even if every printed line reads ok', () => {
  // A run that crashed AFTER printing 4 "ok" lines (e.g. an uncaught
  // rejection during teardown) must not read as a pass on TAP text alone.
  const crashedAfterOk = { status: 1, stdout: ALL_PASS.stdout, stderr: 'unhandled rejection' };
  assert.throws(() => assertAllFourScenariosPass(crashedAfterOk, 'the master checkout'), /exited 1/);
});

test('BL-1462: assertAllFourScenariosPass throws naming the checkout when the process never produced a result at all', () => {
  assert.throws(() => assertAllFourScenariosPass(null, 'the linked role worktree'), /never ran from the linked role worktree/);
});
