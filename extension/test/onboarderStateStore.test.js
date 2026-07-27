const assert = require('node:assert/strict');
const {
  slugifyTargetRepoUrl,
  readOnboarderState,
  writeOnboarderState,
  listOnboarderStates,
} = require('../out/onboarding/onboarderStateStore');
const { createOnboardingState } = require('../out/onboarding/onboarderState');
const { mkTmpDir } = require('./helpers/tmpDir');

const fixedNow = () => 1_700_000_000_000;

test('BL-590: slugifyTargetRepoUrl strips scheme/.git and is filesystem-safe', () => {
  assert.equal(slugifyTargetRepoUrl('https://github.com/acme/widget.git'), 'github.com-acme-widget');
  assert.equal(slugifyTargetRepoUrl('git@github.com:acme/widget.git'), 'git-github.com-acme-widget');
});

test('BL-590: reading state for a target with no file yet returns undefined, never throws', () => {
  const dir = mkTmpDir('onboarding-store-');
  assert.equal(readOnboarderState(dir, 'https://github.com/acme/widget'), undefined);
});

test('BL-590 restart-resumes-mid-flow-08: write then read round-trips the exact state', () => {
  const dir = mkTmpDir('onboarding-store-');
  const state = {
    ...createOnboardingState('https://github.com/acme/widget', fixedNow),
    phase: 'checking-prerequisites',
    stepIndex: 2,
    verifiedSteps: ['toolchain', 'github-access'],
  };
  writeOnboarderState(dir, state);
  const rehydrated = readOnboarderState(dir, 'https://github.com/acme/widget');
  assert.deepEqual(rehydrated, state);
});

test('BL-590: state for one target never collides with a different target', () => {
  const dir = mkTmpDir('onboarding-store-');
  const stateA = createOnboardingState('https://github.com/acme/widget', fixedNow);
  const stateB = { ...createOnboardingState('https://github.com/acme/gadget', fixedNow), stepIndex: 3, verifiedSteps: ['toolchain', 'github-access', 'fork-clone'] };
  writeOnboarderState(dir, stateA);
  writeOnboarderState(dir, stateB);
  assert.deepEqual(readOnboarderState(dir, 'https://github.com/acme/widget'), stateA);
  assert.deepEqual(readOnboarderState(dir, 'https://github.com/acme/gadget'), stateB);
});

test('BL-590: listOnboarderStates returns every persisted target state', () => {
  const dir = mkTmpDir('onboarding-store-');
  assert.deepEqual(listOnboarderStates(dir), []);
  const stateA = createOnboardingState('https://github.com/acme/widget', fixedNow);
  writeOnboarderState(dir, stateA);
  const listed = listOnboarderStates(dir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].targetRepoUrl, 'https://github.com/acme/widget');
});
