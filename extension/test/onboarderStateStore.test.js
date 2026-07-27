const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  slugifyTargetRepoUrl,
  readOnboarderState,
  writeOnboarderState,
  listOnboarderStates,
  hasProcessedOnboardingUpdateId,
  markOnboardingUpdateDelivered,
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

// ── BL-684 hardening pass: the rename left the store's path construction,
// slug regex boundaries, envelope-detection clauses and the redelivery
// guard without tests that distinguish real behavior from a gutted
// stand-in (mutation survivors, not a behavior change) ────────────────────

test('BL-590: writeOnboarderState persists under the real .swarmforge/onboarding directory, not an ad-hoc path', () => {
  const dir = mkTmpDir('onboarding-store-');
  writeOnboarderState(dir, createOnboardingState('https://github.com/acme/widget', fixedNow));
  const expectedPath = path.join(dir, '.swarmforge', 'onboarding', 'github.com-acme-widget.json');
  assert.equal(fs.existsSync(expectedPath), true, `expected a file at ${expectedPath}`);
});

test('BL-590: slugifyTargetRepoUrl only strips a scheme anchored at the very start, and collapses a run of special chars to one dash', () => {
  // No real scheme at position 0 (leading digit) - "http://" appearing later
  // must NOT be stripped, and the run of "://" collapses to a single dash.
  assert.equal(slugifyTargetRepoUrl('9http://foo'), '9http-foo');
});

test('BL-590: slugifyTargetRepoUrl only strips a ".git" suffix anchored at the very end', () => {
  assert.equal(slugifyTargetRepoUrl('https://github.com/acme/widget.gitfoo'), 'github.com-acme-widget.gitfoo');
});

test('BL-590: slugifyTargetRepoUrl strips every leading/trailing dash, not just one', () => {
  assert.equal(slugifyTargetRepoUrl('--weird--'), 'weird');
});

test('BL-590: slugifyTargetRepoUrl falls back to "target" only when the real slug is truly empty', () => {
  assert.equal(slugifyTargetRepoUrl('://'), 'target');
  assert.equal(slugifyTargetRepoUrl(''), 'target');
});

test('BL-590: reading a pre-envelope bare state file (no state/processedUpdates keys) falls back to wrapping it, never crashes', () => {
  const dir = mkTmpDir('onboarding-store-');
  const bareState = createOnboardingState('https://github.com/acme/widget', fixedNow);
  const onboardingDir = path.join(dir, '.swarmforge', 'onboarding');
  fs.mkdirSync(onboardingDir, { recursive: true });
  fs.writeFileSync(path.join(onboardingDir, 'github.com-acme-widget.json'), JSON.stringify(bareState));
  assert.deepEqual(readOnboarderState(dir, 'https://github.com/acme/widget'), bareState);
});

test('BL-590: an object with only a "state" key (missing processedUpdates) is not mistaken for a real envelope', () => {
  const dir = mkTmpDir('onboarding-store-');
  const raw = { state: createOnboardingState('https://github.com/acme/widget', fixedNow) };
  const onboardingDir = path.join(dir, '.swarmforge', 'onboarding');
  fs.mkdirSync(onboardingDir, { recursive: true });
  fs.writeFileSync(path.join(onboardingDir, 'github.com-acme-widget.json'), JSON.stringify(raw));
  // isEnvelope must be false (no processedUpdates key) - the whole `raw` object is wrapped as the "state".
  assert.deepEqual(readOnboarderState(dir, 'https://github.com/acme/widget'), raw);
});

test('BL-590: an object with only a "processedUpdates" key (missing state) is not mistaken for a real envelope', () => {
  const dir = mkTmpDir('onboarding-store-');
  const raw = { processedUpdates: {} };
  const onboardingDir = path.join(dir, '.swarmforge', 'onboarding');
  fs.mkdirSync(onboardingDir, { recursive: true });
  fs.writeFileSync(path.join(onboardingDir, 'github.com-acme-widget.json'), JSON.stringify(raw));
  assert.deepEqual(readOnboarderState(dir, 'https://github.com/acme/widget'), raw);
});

test('BL-590: a state file containing JSON null falls back gracefully, never crashes on the null-vs-object quirk', () => {
  const dir = mkTmpDir('onboarding-store-');
  const onboardingDir = path.join(dir, '.swarmforge', 'onboarding');
  fs.mkdirSync(onboardingDir, { recursive: true });
  fs.writeFileSync(path.join(onboardingDir, 'github.com-acme-widget.json'), 'null');
  assert.equal(readOnboarderState(dir, 'https://github.com/acme/widget'), null);
});

test('BL-590: a state file containing a bare JSON string falls back gracefully, never crashes', () => {
  const dir = mkTmpDir('onboarding-store-');
  const onboardingDir = path.join(dir, '.swarmforge', 'onboarding');
  fs.mkdirSync(onboardingDir, { recursive: true });
  fs.writeFileSync(path.join(onboardingDir, 'github.com-acme-widget.json'), '"hello"');
  assert.equal(readOnboarderState(dir, 'https://github.com/acme/widget'), 'hello');
});

test('BL-590: listOnboarderStates ignores non-.json files, the last-processed-update.json sentinel, and corrupt JSON, but still wraps a bare pre-envelope target file', () => {
  const dir = mkTmpDir('onboarding-store-');
  const onboardingDir = path.join(dir, '.swarmforge', 'onboarding');
  writeOnboarderState(dir, createOnboardingState('https://github.com/acme/widget', fixedNow));
  fs.mkdirSync(onboardingDir, { recursive: true });
  fs.writeFileSync(path.join(onboardingDir, 'not-json.txt'), JSON.stringify(createOnboardingState('https://github.com/acme/other', fixedNow)));
  fs.writeFileSync(path.join(onboardingDir, 'last-processed-update.json'), JSON.stringify({ targetRepoUrl: 'BOGUS-SENTINEL' }));
  fs.writeFileSync(path.join(onboardingDir, 'corrupt.json'), 'not valid json{');
  const bareState = createOnboardingState('https://github.com/acme/bare', fixedNow);
  fs.writeFileSync(path.join(onboardingDir, 'github.com-acme-bare.json'), JSON.stringify(bareState));
  const listed = listOnboarderStates(dir);
  assert.equal(listed.length, 2);
  const urls = listed.map((s) => s.targetRepoUrl).sort();
  assert.deepEqual(urls, ['https://github.com/acme/bare', 'https://github.com/acme/widget']);
});

test('BL-590: markOnboardingUpdateDelivered on a target with no persisted state is a safe no-op, never throws', () => {
  const dir = mkTmpDir('onboarding-store-');
  assert.doesNotThrow(() => markOnboardingUpdateDelivered(dir, 'https://github.com/acme/widget', 999));
});

test('BL-590: markOnboardingUpdateDelivered never invents a processed-update record for an id that was never recorded as processed', () => {
  const dir = mkTmpDir('onboarding-store-');
  writeOnboarderState(dir, createOnboardingState('https://github.com/acme/widget', fixedNow));
  markOnboardingUpdateDelivered(dir, 'https://github.com/acme/widget', 555);
  assert.equal(hasProcessedOnboardingUpdateId(dir, 555), false);
});
