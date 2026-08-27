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
  renderStatus,
  normalizeTargetRepoUrl,
  isSameTarget,
} = require('../out/onboarding/onboarderState');

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
  // what onboarderStateStore's read/write round-trip does.
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

// ── architect bounce (defect 2, 2026-07-25): re-posting an in-flight
// target's URL must RESUME, never overwrite (backlog/evidence/BL-590-
// onboarder-slice1-architect-bounce-20260725.md) ─────────────

test('BL-590 architect bounce defect 2: re-posting the URL of an in-flight onboarding resumes it, preserving verifiedSteps', () => {
  let state = createOnboardingState('https://github.com/acme/widget', fixedNow);
  state = applyPrincipalReply(state, 'git version 2.43.0\nv20\ntmux 3.4\nBabashka 1.3\nclaude 1.2', fixedNow).state;
  state = applyPrincipalReply(state, 'ssh: successfully authenticated', fixedNow).state;
  assert.deepEqual(state.verifiedSteps, ['toolchain', 'github-access']);

  const outcome = handleOnboardingMessage([state], 'https://github.com/acme/widget', fixedNow);
  assert.equal(outcome.kind, 'resumed');
  assert.deepEqual(outcome.state.verifiedSteps, ['toolchain', 'github-access']);
  assert.equal(outcome.state.stepIndex, state.stepIndex);
  assert.equal(currentPrerequisiteStep(outcome.state), 'fork-clone');
  assert.match(outcome.message, /fork-clone/);
});

test('BL-590 architect bounce defect 2: a URL for a DIFFERENT target still opens its own fresh state, never resumes the wrong one', () => {
  const widget = createOnboardingState('https://github.com/acme/widget', fixedNow);
  const outcome = handleOnboardingMessage([widget], 'https://github.com/acme/gadget', fixedNow);
  assert.equal(outcome.kind, 'started');
  assert.equal(outcome.state.targetRepoUrl, 'https://github.com/acme/gadget');
  assert.deepEqual(outcome.state.verifiedSteps, []);
});

test('BL-590 architect bounce defect 2: re-posting the URL of a FINISHED (prerequisites-ready) onboarding opens a fresh one, never resumes a done flow', () => {
  const finished = { ...createOnboardingState('https://github.com/acme/widget', fixedNow), phase: 'prerequisites-ready', stepIndex: 5, verifiedSteps: ['toolchain', 'github-access', 'fork-clone', 'target-repo', 'bot-token'] };
  const outcome = handleOnboardingMessage([finished], 'https://github.com/acme/widget', fixedNow);
  assert.equal(outcome.kind, 'started');
  assert.deepEqual(outcome.state.verifiedSteps, []);
});

// ── BL-684 hardening pass: the rename left the PREREQUISITE_STEPS checklist
// data and a handful of control-flow branches without a test that
// distinguishes their actual content/behavior from a gutted stand-in
// (mutation survivors, not a behavior change - engineering.prompt) ────────

const EXPECTED_STEP_MARKERS = {
  toolchain: {
    requiredMarkers: ['git version', 'tmux', 'babashka', 'claude'],
    failureMarkers: ['not found', 'command not found'],
  },
  'github-access': {
    requiredMarkers: ['successfully authenticated'],
    failureMarkers: ['permission denied', 'could not resolve hostname'],
  },
  'fork-clone': {
    requiredMarkers: ['cloning into'],
    failureMarkers: ['fatal:', 'repository not found'],
  },
  'target-repo': {
    requiredMarkers: ['cloning into', 'origin'],
    failureMarkers: ['fatal:', 'repository not found'],
  },
  'bot-token': {
    requiredMarkers: ['new bot', 'token'],
    failureMarkers: ['reused the primary', "primary's token"],
  },
};

test('BL-590: each step\'s required/failure marker lists match the documented checklist exactly', () => {
  for (const [stepId, expected] of Object.entries(EXPECTED_STEP_MARKERS)) {
    const spec = PREREQUISITE_STEPS[stepId].verification;
    assert.deepEqual(spec.requiredMarkers, expected.requiredMarkers, `${stepId} requiredMarkers`);
    assert.deepEqual(spec.failureMarkers, expected.failureMarkers, `${stepId} failureMarkers`);
  }
});

test('BL-590: each step guidance verificationName is a specific descriptive label, not empty or generic', () => {
  const expected = {
    toolchain: 'toolchain version-check output',
    'github-access': 'GitHub SSH access check output',
    'fork-clone': 'swarmforge fork clone output',
    'target-repo': 'target repo clone output',
    'bot-token': 'dedicated bot token confirmation',
  };
  for (const [stepId, name] of Object.entries(expected)) {
    assert.equal(PREREQUISITE_STEPS[stepId].verificationName, name);
  }
});

test('BL-590: each step guidance id matches its own key in the table', () => {
  for (const stepId of PREREQUISITE_STEP_ORDER) {
    assert.equal(PREREQUISITE_STEPS[stepId].id, stepId);
  }
});

test('BL-590: each step instruction actually names its real command and the paste-here prompt', () => {
  const expectedSnippets = {
    toolchain: [
      'On the target host, run:',
      'git --version && node --version && tmux -V && bb --version && claude --version',
      'Paste the full output here.',
    ],
    'github-access': ['On the target host, run:', 'ssh -T git@github.com', 'Paste the full output here (a working key prints a "successfully authenticated" message).'],
    'fork-clone': ['On the target host, run:', 'git clone git@github.com:unclebob/swarm-forge.git && cd swarm-forge && git rev-parse --short HEAD', 'Paste the full output here.'],
    'target-repo': ['On the target host, run:', 'git clone <the target repo URL you gave me> && cd <the cloned directory> && git remote -v', 'Paste the full output here.'],
    'bot-token': ['see BL-622/BL-439', 'Paste the new bot username and confirmation that the token was saved here.'],
  };
  for (const [stepId, snippets] of Object.entries(expectedSnippets)) {
    for (const snippet of snippets) {
      assert.ok(PREREQUISITE_STEPS[stepId].instruction.includes(snippet), `${stepId} instruction missing "${snippet}"`);
    }
  }
});

test('BL-590: verifyPrerequisiteStep reports the specific failure marker found, distinct from a missing-marker reason', () => {
  const verdict = verifyPrerequisiteStep('github-access', 'permission denied (publickey).');
  assert.equal(verdict.passed, false);
  assert.equal(verdict.reason, 'output contains "permission denied"');
});

test('BL-590: currentPrerequisiteStep returns null once phase is prerequisites-ready, regardless of stepIndex', () => {
  const readyButLowIndex = { ...createOnboardingState('https://github.com/acme/widget', fixedNow), phase: 'prerequisites-ready', stepIndex: 2 };
  assert.equal(currentPrerequisiteStep(readyButLowIndex), null);
});

test('BL-590: applyPrincipalReply on a prerequisites-ready state with a non-control message replies with the ready status, never crashes', () => {
  const ready = { ...createOnboardingState('https://github.com/acme/widget', fixedNow), phase: 'prerequisites-ready', stepIndex: 5 };
  const turn = applyPrincipalReply(ready, 'some unrelated text', fixedNow);
  assert.equal(turn.state, ready);
  assert.match(turn.message, /survey/i);
});

test('BL-590 verification-gates-advancement-03: an advance that is not the final step lands back in checking-prerequisites', () => {
  const state = createOnboardingState('https://github.com/acme/widget', fixedNow);
  const turn = applyPrincipalReply(state, 'git version 2.43.0\nv20.11.0\ntmux 3.4\nBabashka 1.3.190\nclaude 1.2.3', fixedNow);
  assert.equal(turn.state.phase, 'checking-prerequisites');
});

test('BL-590: the prerequisites-ready message names both the survey and the onboarding contract, exactly', () => {
  const ready = { ...createOnboardingState('https://github.com/acme/widget', fixedNow), phase: 'prerequisites-ready' };
  assert.equal(
    renderStatus(ready),
    'All prerequisites verified - prerequisites are ready. Next comes the survey phase: I will survey your ' +
      'target repo and propose an onboarding contract.'
  );
});

test('BL-590: pickActiveOnboardingState never lets an earlier-touched item override an already-found later one, and ties favor the first-seen', () => {
  const earlyTouched = { ...createOnboardingState('https://github.com/acme/early', () => 1), updatedAtMs: 300 };
  const olderButLaterInArray = { ...createOnboardingState('https://github.com/acme/older', () => 1), updatedAtMs: 100 };
  assert.equal(pickActiveOnboardingState([earlyTouched, olderButLaterInArray]).targetRepoUrl, 'https://github.com/acme/early');

  const tieA = { ...createOnboardingState('https://github.com/acme/tie-a', () => 1), updatedAtMs: 200 };
  const tieB = { ...createOnboardingState('https://github.com/acme/tie-b', () => 1), updatedAtMs: 200 };
  assert.equal(pickActiveOnboardingState([tieA, tieB]).targetRepoUrl, 'https://github.com/acme/tie-a');
});

test('BL-590: handleOnboardingMessage trims surrounding whitespace from a pasted repo URL before storing it', () => {
  const outcome = handleOnboardingMessage([], '  https://github.com/acme/widget  ', fixedNow);
  assert.equal(outcome.state.targetRepoUrl, 'https://github.com/acme/widget');
});

test('BL-590: isBareDoneClaim regex anchors and character classes are exact, not merely substring-ish', () => {
  assert.equal(isBareDoneClaim('xdone'), false); // ^ anchor: no unanchored match after leading garbage
  assert.equal(isBareDoneClaim('done extra'), false); // $ anchor: no trailing garbage
  assert.equal(isBareDoneClaim('done  '), true); // trailing \s* really allows trailing whitespace
  assert.equal(isBareDoneClaim("its  done"), true); // it's-prefix requires \s+ (1+), not exactly one space
  assert.equal(isBareDoneClaim('complete'), true); // the "d" in complete[d]? is really optional
  assert.equal(isBareDoneClaim('completed'), true); // "d" is really allowed, not excluded
});

test('BL-590: classifyControl pause/proceed regex anchors are exact, not substring matches', () => {
  assert.equal(classifyControl('xpause'), null); // ^ anchor
  assert.equal(classifyControl('pause now'), null); // $ anchor
  assert.equal(classifyControl('  pause'), 'pause'); // leading \s* really allows whitespace
  assert.equal(classifyControl('pause  '), 'pause'); // trailing \s* really allows whitespace
  assert.equal(classifyControl('xproceed'), null); // ^ anchor
  assert.equal(classifyControl('proceed now'), null); // $ anchor
  assert.equal(classifyControl('  proceed'), 'proceed'); // leading \s* really allows whitespace
  assert.equal(classifyControl('proceed  '), 'proceed'); // trailing \s* really allows whitespace
});

// ── architect bounce #6/#7 (D3/D4): the handler must agree with the store on
// what counts as "the same target", or an alias paste (scheme/.git/trailing
// slash variant) of an in-flight target overwrites its verified progress
// instead of resuming it ────────────────────────────────────────────────

test('BL-590 architect bounce #6 D3: normalizeTargetRepoUrl collapses scheme, trailing slash, and .git aliases onto one key', () => {
  const canonical = normalizeTargetRepoUrl('https://github.com/acme/widget');
  assert.equal(normalizeTargetRepoUrl('https://github.com/acme/widget.git'), canonical);
  assert.equal(normalizeTargetRepoUrl('http://github.com/acme/widget'), canonical);
  assert.equal(normalizeTargetRepoUrl('https://github.com/acme/widget/'), canonical);
});

test('BL-590 architect bounce #6 D4: a trailing slash after .git still normalizes like plain .git', () => {
  assert.equal(normalizeTargetRepoUrl('https://github.com/acme/widget.git/'), normalizeTargetRepoUrl('https://github.com/acme/widget.git'));
});

test('BL-590 architect bounce #6 D3: isSameTarget agrees with normalizeTargetRepoUrl, and distinct repos are never conflated', () => {
  assert.equal(isSameTarget('https://github.com/acme/widget', 'https://github.com/acme/widget.git'), true);
  assert.equal(isSameTarget('https://github.com/acme/widget', 'https://github.com/acme/gadget'), false);
});

test('BL-590 architect bounce #6 D3: re-posting an ALIAS of an in-flight target resumes it, never overwrites it', () => {
  let state = createOnboardingState('https://github.com/acme/widget', fixedNow);
  state = applyPrincipalReply(state, 'git version 2.43.0\nv20\ntmux 3.4\nBabashka 1.3\nclaude 1.2', fixedNow).state;
  assert.deepEqual(state.verifiedSteps, ['toolchain']);

  const outcome = handleOnboardingMessage([state], 'https://github.com/acme/widget.git', fixedNow);
  assert.equal(outcome.kind, 'resumed');
  assert.deepEqual(outcome.state.verifiedSteps, ['toolchain']);
});

test('BL-590: isLikelyRepoUrl regex anchors and scheme are exact, not substring matches', () => {
  assert.equal(isLikelyRepoUrl('xhttps://github.com/a/b'), false); // ^ anchor
  assert.equal(isLikelyRepoUrl('https://github.com/a/b extra'), false); // $ anchor
  assert.equal(isLikelyRepoUrl('  https://github.com/a/b'), true); // leading \s* really allows whitespace
  assert.equal(isLikelyRepoUrl('https://github.com/a/b  '), true); // trailing \s* really allows whitespace
  assert.equal(isLikelyRepoUrl('http://github.com/a/b'), true); // the "s" in https? is really optional
});
