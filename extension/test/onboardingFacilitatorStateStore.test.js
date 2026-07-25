const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  slugifyTargetRepoUrl,
  readOnboardingFacilitatorState,
  writeOnboardingFacilitatorState,
  listOnboardingFacilitatorStates,
} = require('../out/onboarding/onboardingFacilitatorStateStore');
const { createOnboardingState } = require('../out/onboarding/onboardingFacilitatorState');
const { mkTmpDir } = require('./helpers/tmpDir');

const fixedNow = () => 1_700_000_000_000;

function digestOf(normalized) {
  return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 8);
}

test('BL-590: slugifyTargetRepoUrl strips scheme/.git, is filesystem-safe and digest-suffixed', () => {
  assert.equal(slugifyTargetRepoUrl('https://github.com/acme/widget.git'), `github.com-acme-widget-${digestOf('github.com/acme/widget')}`);
  assert.equal(slugifyTargetRepoUrl('git@github.com:acme/widget.git'), `git-github.com-acme-widget-${digestOf('git@github.com:acme/widget')}`);
});

// BL-590 architect bounce #5, D1: the readable prefix alone collapses '/' and
// other punctuation onto the same '-', so github.com/acme/tools-ci and
// github.com/acme-tools/ci used to key the same state file - onboarding one
// destroyed the other's verified prerequisites. The digest suffix must keep
// them apart.
test('BL-590 bounce #5 D1: distinct org/repo boundaries never collide on one slug', () => {
  const slugA = slugifyTargetRepoUrl('https://github.com/acme/tools-ci');
  const slugB = slugifyTargetRepoUrl('https://github.com/acme-tools/ci');
  assert.notEqual(slugA, slugB);
});

// The normalized aliases (scheme, trailing ".git", trailing slash) still
// name the SAME repo and must keep collapsing onto one file, or a human who
// pastes the .git form after the plain form starts a second, unrelated
// onboarding of the repo they are already onboarding.
test('BL-590 bounce #5 D1: normalized aliases of one repo still collapse onto one slug', () => {
  const base = 'github.com/acme/widget';
  const forms = [base, `https://${base}`, `https://${base}.git`, `https://${base}/`];
  const slugs = new Set(forms.map(slugifyTargetRepoUrl));
  assert.equal(slugs.size, 1, `aliases split across ${slugs.size} slugs: ${[...slugs]}`);
});

test('BL-590: reading state for a target with no file yet returns undefined, never throws', () => {
  const dir = mkTmpDir('onboarding-store-');
  assert.equal(readOnboardingFacilitatorState(dir, 'https://github.com/acme/widget'), undefined);
});

test('BL-590 restart-resumes-mid-flow-08: write then read round-trips the exact state', () => {
  const dir = mkTmpDir('onboarding-store-');
  const state = {
    ...createOnboardingState('https://github.com/acme/widget', fixedNow),
    phase: 'checking-prerequisites',
    stepIndex: 2,
    verifiedSteps: ['toolchain', 'github-access'],
  };
  writeOnboardingFacilitatorState(dir, state);
  const rehydrated = readOnboardingFacilitatorState(dir, 'https://github.com/acme/widget');
  assert.deepEqual(rehydrated, state);
});

test('BL-590: state for one target never collides with a different target', () => {
  const dir = mkTmpDir('onboarding-store-');
  const stateA = createOnboardingState('https://github.com/acme/widget', fixedNow);
  const stateB = { ...createOnboardingState('https://github.com/acme/gadget', fixedNow), stepIndex: 3, verifiedSteps: ['toolchain', 'github-access', 'fork-clone'] };
  writeOnboardingFacilitatorState(dir, stateA);
  writeOnboardingFacilitatorState(dir, stateB);
  assert.deepEqual(readOnboardingFacilitatorState(dir, 'https://github.com/acme/widget'), stateA);
  assert.deepEqual(readOnboardingFacilitatorState(dir, 'https://github.com/acme/gadget'), stateB);
});

test('BL-590: listOnboardingFacilitatorStates returns every persisted target state', () => {
  const dir = mkTmpDir('onboarding-store-');
  assert.deepEqual(listOnboardingFacilitatorStates(dir), []);
  const stateA = createOnboardingState('https://github.com/acme/widget', fixedNow);
  writeOnboardingFacilitatorState(dir, stateA);
  const listed = listOnboardingFacilitatorStates(dir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].targetRepoUrl, 'https://github.com/acme/widget');
});

// BL-590 architect bounce #5, D2: a plausible but unrelated .json sibling in
// the onboarding directory used to be cast into a fake state (no `phase`
// field), get admitted by pickActiveOnboardingState, and throw downstream
// with nothing to catch it. Validated by shape now, not by a filename
// deny-list, so an unrelated .json is dropped rather than faked.
test('BL-590 bounce #5 D2: a foreign .json sibling in the onboarding directory is ignored, not faked into a state', () => {
  const dir = mkTmpDir('onboarding-store-');
  const stateA = createOnboardingState('https://github.com/acme/widget', fixedNow);
  writeOnboardingFacilitatorState(dir, stateA);

  const onboardingDir = path.join(dir, '.swarmforge', 'onboarding');
  fs.writeFileSync(path.join(onboardingDir, 'contract-negotiation-log.json'), JSON.stringify({ lastContractSha: 'abc123' }));

  const listed = listOnboardingFacilitatorStates(dir);
  assert.equal(listed.length, 1, 'the foreign sibling file must not be admitted as a state');
  assert.equal(listed[0].targetRepoUrl, 'https://github.com/acme/widget');
});
