const assert = require('node:assert/strict');
const {
  PREREQUISITE_STEP_ORDER,
  PREREQUISITE_STEPS,
  createOnboardingState,
  applyPrincipalReply,
  currentPrerequisiteStep,
  verifyPrerequisiteStep,
  isBareDoneClaim,
  classifyControl,
  renderStepInstruction,
  isLikelyRepoUrl,
  pickActiveOnboardingState,
  handleOnboardingMessage,
} = require('../out/onboarding/onboardingFacilitatorState');

const fixedNow = () => 1_700_000_000_000;

test('BL-590: createOnboardingState opens at checking-prerequisites on the first step', () => {
  const state = createOnboardingState('https://github.com/acme/widget', fixedNow);
  assert.equal(state.phase, 'checking-prerequisites');
  assert.equal(currentPrerequisiteStep(state), 'toolchain');
  assert.deepEqual(state.verifiedSteps, []);
  assert.equal(state.paused, false);
});

test('BL-590 verification-gates-advancement-03: a passing verification advances and posts the next instruction', () => {
  const state = createOnboardingState('https://github.com/acme/widget', fixedNow);
  const passingOutput = 'git version 2.43.0\nv20.11.0\ntmux 3.4\nBabashka 1.3.190\nclaude 1.2.3';
  const turn = applyPrincipalReply(state, passingOutput, fixedNow);
  assert.deepEqual(turn.state.verifiedSteps, ['toolchain']);
  assert.equal(currentPrerequisiteStep(turn.state), 'github-access');
  assert.match(turn.message, /github-access/);
});

test('BL-590 bare-done-never-advances-04: a bare "done" claim never advances the step', () => {
  const state = createOnboardingState('https://github.com/acme/widget', fixedNow);
  const turn = applyPrincipalReply(state, 'done', fixedNow);
  assert.deepEqual(turn.state.verifiedSteps, []);
  assert.equal(currentPrerequisiteStep(turn.state), 'toolchain');
  assert.match(turn.message, /not a verification output/i);
});

test('BL-590: bare-done recognizes common phrasing variants, never a substring of real output', () => {
  assert.equal(isBareDoneClaim('done'), true);
  assert.equal(isBareDoneClaim('Done!'), true);
  assert.equal(isBareDoneClaim("it's done"), true);
  assert.equal(isBareDoneClaim('yes'), true);
  assert.equal(isBareDoneClaim('git version 2.43.0 ... done compiling'), false);
});

test('BL-590 failing-verification-explains-05: a failing verification keeps the step and explains why', () => {
  let state = createOnboardingState('https://github.com/acme/widget', fixedNow);
  state = applyPrincipalReply(state, 'git version 2.43.0\nv20\ntmux 3.4\nBabashka 1.3\nclaude 1.2', fixedNow).state;
  assert.equal(currentPrerequisiteStep(state), 'github-access');

  const turn = applyPrincipalReply(state, 'Permission denied (publickey).', fixedNow);
  assert.deepEqual(turn.state.verifiedSteps, ['toolchain']);
  assert.equal(currentPrerequisiteStep(turn.state), 'github-access');
  assert.match(turn.message, /verification failed/i);
  assert.match(turn.message, /ssh -T git@github\.com/);
});

test('BL-590 prerequisites-checklist-coverage-06: every step guidance names its command and its verification', () => {
  for (const step of PREREQUISITE_STEP_ORDER) {
    const guidance = renderStepInstruction(step);
    assert.equal(typeof PREREQUISITE_STEPS[step].instruction, 'string');
    assert.ok(PREREQUISITE_STEPS[step].instruction.length > 0);
    assert.match(guidance, new RegExp(PREREQUISITE_STEPS[step].verificationName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('BL-590 dedicated-token-instruction-07: bot-token guidance instructs a new token and forbids reusing the primary\'s', () => {
  const guidance = PREREQUISITE_STEPS['bot-token'].instruction;
  assert.match(guidance, /new,? dedicated telegram bot/i);
  assert.match(guidance, /do not reuse the.*primary.*token/i);
});

test('BL-590 restart-resumes-mid-flow-08: verified steps and step index round-trip through plain state (no live process needed)', () => {
  let state = createOnboardingState('https://github.com/acme/widget', fixedNow);
  state = applyPrincipalReply(state, 'git version 2.43.0\nv20\ntmux 3.4\nBabashka 1.3\nclaude 1.2', fixedNow).state;
  state = applyPrincipalReply(state, 'ssh: successfully authenticated', fixedNow).state;
  assert.equal(currentPrerequisiteStep(state), 'fork-clone');
  assert.deepEqual(state.verifiedSteps, ['toolchain', 'github-access']);

  // "restart" = re-derive from the persisted plain-object state, exactly
  // what onboardingFacilitatorStateStore's read/write round-trip does.
  const rehydrated = JSON.parse(JSON.stringify(state));
  assert.equal(currentPrerequisiteStep(rehydrated), 'fork-clone');
  assert.deepEqual(rehydrated.verifiedSteps, ['toolchain', 'github-access']);
});

test('BL-590 pause-and-resume-09: pause holds the step, proceed resumes at the same instruction', () => {
  let state = createOnboardingState('https://github.com/acme/widget', fixedNow);
  state = applyPrincipalReply(state, 'git version 2.43.0\nv20\ntmux 3.4\nBabashka 1.3\nclaude 1.2', fixedNow).state;
  state = applyPrincipalReply(state, 'ssh: successfully authenticated', fixedNow).state;
  assert.equal(currentPrerequisiteStep(state), 'fork-clone');
  const beforePauseMessage = applyPrincipalReply(state, 'proceed', fixedNow).message;

  const pauseTurn = applyPrincipalReply(state, 'pause', fixedNow);
  assert.equal(pauseTurn.state.paused, true);
  assert.match(pauseTurn.message, /paused/i);

  const whileNoOp = applyPrincipalReply(pauseTurn.state, 'cloning into swarm-forge...', fixedNow);
  assert.equal(whileNoOp.state.paused, true);
  assert.equal(currentPrerequisiteStep(whileNoOp.state), 'fork-clone');
  assert.match(whileNoOp.message, /paused/i);

  const resumeTurn = applyPrincipalReply(pauseTurn.state, 'proceed', fixedNow);
  assert.equal(resumeTurn.state.paused, false);
  assert.equal(currentPrerequisiteStep(resumeTurn.state), 'fork-clone');
  assert.equal(resumeTurn.message, beforePauseMessage);
});

test('BL-590 prerequisites-ready-announces-next-10: the final verification advances the phase and announces the survey', () => {
  let state = createOnboardingState('https://github.com/acme/widget', fixedNow);
  state = applyPrincipalReply(state, 'git version 2.43.0\nv20\ntmux 3.4\nBabashka 1.3\nclaude 1.2', fixedNow).state;
  state = applyPrincipalReply(state, 'ssh: successfully authenticated', fixedNow).state;
  state = applyPrincipalReply(state, 'Cloning into \'swarm-forge\'...', fixedNow).state;
  state = applyPrincipalReply(state, 'Cloning into \'widget\'...\norigin\tgit@github.com:acme/widget.git (fetch)', fixedNow).state;
  assert.equal(currentPrerequisiteStep(state), 'bot-token');

  const finalTurn = applyPrincipalReply(state, 'Created a new bot @widget_onboarding_bot, token saved.', fixedNow);
  assert.equal(finalTurn.state.phase, 'prerequisites-ready');
  assert.equal(currentPrerequisiteStep(finalTurn.state), null);
  assert.match(finalTurn.message, /survey/i);
});

test('BL-590: classifyControl recognizes only the exact pause/proceed words, never a substring', () => {
  assert.equal(classifyControl('pause'), 'pause');
  assert.equal(classifyControl('Proceed'), 'proceed');
  assert.equal(classifyControl('please pause things'), null);
  assert.equal(classifyControl('done'), null);
});

test('BL-590: verifyPrerequisiteStep reports the specific missing marker', () => {
  const verdict = verifyPrerequisiteStep('toolchain', 'git version 2.43.0\nv20\ntmux 3.4');
  assert.equal(verdict.passed, false);
  assert.match(verdict.reason, /babashka/i);
});

test('BL-590 new-onboarding-starts-at-prerequisites-02: isLikelyRepoUrl recognizes https and git@ remotes, never an ordinary sentence', () => {
  assert.equal(isLikelyRepoUrl('https://github.com/acme/widget'), true);
  assert.equal(isLikelyRepoUrl('git@github.com:acme/widget.git'), true);
  assert.equal(isLikelyRepoUrl('check out https://github.com/acme/widget please'), false);
  assert.equal(isLikelyRepoUrl('done'), false);
});

test('BL-590: pickActiveOnboardingState picks the most recently touched in-flight target, never a finished one', () => {
  const finished = { ...createOnboardingState('https://github.com/acme/old', () => 1), phase: 'prerequisites-ready', updatedAtMs: 500 };
  const stale = { ...createOnboardingState('https://github.com/acme/stale', () => 1), updatedAtMs: 100 };
  const fresh = { ...createOnboardingState('https://github.com/acme/fresh', () => 1), updatedAtMs: 300 };
  assert.equal(pickActiveOnboardingState([finished, stale, fresh]).targetRepoUrl, 'https://github.com/acme/fresh');
  assert.equal(pickActiveOnboardingState([finished]), undefined);
  assert.equal(pickActiveOnboardingState([]), undefined);
});

test('BL-590 new-onboarding-starts-at-prerequisites-02: handleOnboardingMessage opens a fresh per-target state for a repo URL', () => {
  const outcome = handleOnboardingMessage([], 'https://github.com/acme/widget', fixedNow);
  assert.equal(outcome.kind, 'started');
  assert.equal(outcome.state.targetRepoUrl, 'https://github.com/acme/widget');
  assert.equal(outcome.state.phase, 'checking-prerequisites');
  assert.match(outcome.message, /toolchain/);
});

test('BL-590: handleOnboardingMessage applies a plain reply to whichever onboarding is active', () => {
  const inFlight = createOnboardingState('https://github.com/acme/widget', fixedNow);
  const outcome = handleOnboardingMessage([inFlight], 'git version 2.43.0\nv20\ntmux 3.4\nBabashka 1.3\nclaude 1.2', fixedNow);
  assert.equal(outcome.kind, 'advanced');
  assert.deepEqual(outcome.state.verifiedSteps, ['toolchain']);
});

test('BL-590: handleOnboardingMessage with no active onboarding and no repo URL asks for one, never crashes', () => {
  const outcome = handleOnboardingMessage([], 'done', fixedNow);
  assert.equal(outcome.kind, 'no-active-onboarding');
  assert.match(outcome.message, /repo url/i);
});
