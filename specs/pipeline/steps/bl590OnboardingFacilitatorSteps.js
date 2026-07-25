'use strict';

// BL-590 slice 1: step handlers for the Onboarding Facilitator's reserved
// topic + prerequisites state machine. Drives the REAL compiled modules
// in-process - the topic ensure/reuse decision and routing guard from
// telegramFrontDeskBotCore.ts (mirrors onboardingContractSteps.js's own
// "drive the real pure functions, never a parallel reimplementation"
// posture), the real pollAndForward delivery path (proving the "never
// reaches the front-desk operator path" claim the same way
// telegramFrontDeskBotCore.test.js's own BL-590 fixtures do), and the real
// onboardingFacilitatorState.ts/onboardingFacilitatorStateStore.ts pure
// state machine + persistence. The poll loop / real Telegram network stay
// out of scope entirely (testable-module boundary) - a fake postFn plays
// Telegram's HTTP surface, exactly like telegramFrontDeskBotCli.test.js's
// own ensureXTopic fixtures.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const {
  ensureOnboardingTopic,
} = require(path.join(EXT_DIR, 'out', 'tools', 'telegram-front-desk-bot'));
const {
  pollAndForward,
  decideOnboardingReplyAction,
  ONBOARDING_SUBJECT_ID,
} = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const {
  PREREQUISITE_STEP_IDS,
  PREREQUISITE_STEPS,
  createOnboardingState,
  applyPrincipalReply,
  currentPrerequisiteStep,
  renderStepInstruction,
  renderStatus,
  classifyControl,
} = require(path.join(EXT_DIR, 'out', 'onboarding', 'onboardingFacilitatorState'));
const {
  readOnboardingFacilitatorState,
  writeOnboardingFacilitatorState,
} = require(path.join(EXT_DIR, 'out', 'onboarding', 'onboardingFacilitatorStateStore'));

const PRINCIPAL_ID = 111;
const CHAT_ID = '1';

function mkTmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl590-onboarding-'));
  return dir;
}

function topicMapPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json');
}

function readTopicMapFixture(root) {
  if (!fs.existsSync(topicMapPath(root))) {
    return {};
  }
  return JSON.parse(fs.readFileSync(topicMapPath(root), 'utf8'));
}

// A fake Telegram HTTP surface - mints an incrementing thread id per create
// call, exactly like telegramFrontDeskBotCli.test.js's own fakeCreateOk.
function fakePostFn(ctx) {
  return async (url, body) => {
    ctx.createCalls.push({ url, body });
    ctx.nextThreadId += 1;
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: ctx.nextThreadId, name: 'Onboarding' } } };
  };
}

function mkUpdate({ fromId, topicId, text, chatId } = {}) {
  return { update_id: 1, message: { message_id: 1, chat: { id: chatId ?? CHAT_ID }, from: { id: fromId }, message_thread_id: topicId, text } };
}

function requireKnownStep(step) {
  if (!PREREQUISITE_STEP_IDS.includes(step)) {
    throw new Error(`bl590: unrecognized <step> example value "${step}" (known: ${PREREQUISITE_STEP_IDS.join(', ')})`);
  }
  return step;
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a facilitator bound to the primary group's Onboarding topic with a controllable clock$/, (ctx) => {
    ctx.root = mkTmpRoot();
    ctx.clockMs = 1_700_000_000_000;
    ctx.now = () => ctx.clockMs;
    ctx.createCalls = [];
    ctx.nextThreadId = 41;
    ctx.states = new Map(); // targetRepoUrl -> OnboardingFacilitatorState
  });

  function persistState(ctx, state) {
    ctx.states.set(state.targetRepoUrl, state);
    writeOnboardingFacilitatorState(ctx.root, state);
    ctx.state = state;
  }

  // ── onboarding-topic-ensured-and-routed-01 ──────────────────────────────
  registry.define(/^no Onboarding topic exists in the primary group$/, (ctx) => {
    ctx.topicMap = readTopicMapFixture(ctx.root);
    if (Object.values(ctx.topicMap).includes(ONBOARDING_SUBJECT_ID)) {
      throw new Error('fixture setup error: an Onboarding topic already exists');
    }
  });

  registry.define(/^the facilitator service starts$/, async (ctx) => {
    ctx.onboardingTopicId = await ensureOnboardingTopic(ctx.root, 'fake-token', 'fake-chat', fakePostFn(ctx));
  });

  registry.define(/^an Onboarding topic is created under its reserved subject id$/, (ctx) => {
    if (ctx.createCalls.length !== 1) {
      throw new Error(`expected exactly one create call, got ${ctx.createCalls.length}`);
    }
    const map = readTopicMapFixture(ctx.root);
    if (map[String(ctx.onboardingTopicId)] !== ONBOARDING_SUBJECT_ID) {
      throw new Error(`expected the topic map to bind ${ctx.onboardingTopicId} to ${ONBOARDING_SUBJECT_ID}, got: ${JSON.stringify(map)}`);
    }
  });

  registry.define(/^a later start reuses the same topic instead of creating another$/, async (ctx) => {
    const callsBefore = ctx.createCalls.length;
    const secondTopicId = await ensureOnboardingTopic(ctx.root, 'fake-token', 'fake-chat', fakePostFn(ctx));
    if (ctx.createCalls.length !== callsBefore) {
      throw new Error('expected the second start to make no new create call');
    }
    if (secondTopicId !== ctx.onboardingTopicId) {
      throw new Error(`expected the reused topic id to match, got ${secondTopicId} vs ${ctx.onboardingTopicId}`);
    }
  });

  registry.define(/^a principal message in that topic reaches the facilitator$/, async (ctx) => {
    const handled = [];
    const result = await pollAndForward(0, PRINCIPAL_ID, {
      chatId: CHAT_ID,
      getUpdates: async () => ({ success: true, updates: [mkUpdate({ fromId: PRINCIPAL_ID, topicId: ctx.onboardingTopicId, text: 'hello facilitator' })] }),
      onboardingTopicId: async () => ctx.onboardingTopicId,
      handleOnboardingFacilitatorMessage: async (topicId, text, updateId) => {
        handled.push({ topicId, text, updateId });
        return true;
      },
      postToBridge: async () => true,
      subjectForTopic: () => undefined,
      backlogForTopic: () => undefined,
      openSubjectAndRecord: async () => {
        throw new Error('must never reach the SUP path for an Onboarding-topic message');
      },
    });
    if (handled.length !== 1 || result.posted !== 1) {
      throw new Error(`expected the facilitator to receive exactly one message, got: ${JSON.stringify({ handled, result })}`);
    }
    ctx.facilitatorReceived = handled[0];
  });

  registry.define(/^it never reaches the front-desk operator path$/, (ctx) => {
    // The prior step's openSubjectAndRecord throws if the SUP path is ever
    // reached - reaching here without that throw already proves it. Cross-
    // checked directly against the pure routing guard too.
    const decision = decideOnboardingReplyAction(
      mkUpdate({ fromId: PRINCIPAL_ID, topicId: ctx.onboardingTopicId, text: 'hello facilitator' }),
      PRINCIPAL_ID,
      CHAT_ID,
      ctx.onboardingTopicId
    );
    if (decision.kind !== 'deliver') {
      throw new Error(`expected the routing guard to deliver to the facilitator, got: ${JSON.stringify(decision)}`);
    }
  });

  // ── new-onboarding-starts-at-prerequisites-02 ───────────────────────────
  registry.define(/^the principal posts a target GitHub repo URL in the Onboarding topic$/, (ctx) => {
    ctx.targetRepoUrl = 'https://github.com/acme/widget';
    const state = createOnboardingState(ctx.targetRepoUrl, ctx.now);
    persistState(ctx, state);
    ctx.lastMessage = renderStatus(state);
  });

  registry.define(/^a per-target onboarding state is persisted for that URL$/, (ctx) => {
    const rehydrated = readOnboardingFacilitatorState(ctx.root, ctx.targetRepoUrl);
    if (!rehydrated || rehydrated.targetRepoUrl !== ctx.targetRepoUrl) {
      throw new Error(`expected a persisted state for ${ctx.targetRepoUrl}, got: ${JSON.stringify(rehydrated)}`);
    }
  });

  registry.define(/^the state is "checking-prerequisites"$/, (ctx) => {
    const rehydrated = readOnboardingFacilitatorState(ctx.root, ctx.targetRepoUrl);
    if (rehydrated.phase !== 'checking-prerequisites') {
      throw new Error(`expected phase "checking-prerequisites", got "${rehydrated.phase}"`);
    }
  });

  registry.define(/^the facilitator posts where the onboarding stands and the first prerequisite instruction$/, (ctx) => {
    if (!ctx.lastMessage.includes(ctx.targetRepoUrl) || !ctx.lastMessage.includes(PREREQUISITE_STEPS.toolchain.instruction)) {
      throw new Error(`expected the posted message to name the target and the first step's instruction, got: ${ctx.lastMessage}`);
    }
  });

  // ── shared "onboarding is on step X" setup (03/04/05/09) ────────────────
  function setOnboardingOnStep(ctx, step, verifiedCount) {
    requireKnownStep(step);
    ctx.targetRepoUrl = ctx.targetRepoUrl || 'https://github.com/acme/widget';
    let state = createOnboardingState(ctx.targetRepoUrl, ctx.now);
    const PASSING_OUTPUTS = {
      toolchain: 'git version 2.43.0\nv20.11.0\ntmux 3.4\nBabashka 1.3.190\nclaude 1.2.3',
      'github-access': 'ssh: successfully authenticated',
      'fork-clone': "Cloning into 'swarm-forge'...",
      'target-repo': "Cloning into 'widget'...\norigin\tgit@github.com:acme/widget.git (fetch)",
      'bot-token': 'Created a new bot @widget_onboarding_bot, token saved.',
    };
    const targetIndex = PREREQUISITE_STEP_IDS.indexOf(step);
    const stepsToVerify = verifiedCount !== undefined ? verifiedCount : targetIndex;
    for (let i = 0; i < stepsToVerify; i += 1) {
      state = applyPrincipalReply(state, PASSING_OUTPUTS[PREREQUISITE_STEP_IDS[i]], ctx.now).state;
    }
    persistState(ctx, state);
  }

  registry.define(/^the onboarding is on the "(.+)" prerequisite step$/, (ctx, step) => {
    setOnboardingOnStep(ctx, requireKnownStep(step));
  });

  // ── verification-gates-advancement-03 ───────────────────────────────────
  registry.define(/^the principal pastes verification output that passes the step's check$/, (ctx) => {
    const step = currentPrerequisiteStep(ctx.state);
    const PASSING_OUTPUTS = {
      toolchain: 'git version 2.43.0\nv20.11.0\ntmux 3.4\nBabashka 1.3.190\nclaude 1.2.3',
      'github-access': 'ssh: successfully authenticated',
      'fork-clone': "Cloning into 'swarm-forge'...",
      'target-repo': "Cloning into 'widget'...\norigin\tgit@github.com:acme/widget.git (fetch)",
      'bot-token': 'Created a new bot @widget_onboarding_bot, token saved.',
    };
    ctx.stepBeforeReply = step;
    const turn = applyPrincipalReply(ctx.state, PASSING_OUTPUTS[step], ctx.now);
    persistState(ctx, turn.state);
    ctx.lastMessage = turn.message;
  });

  registry.define(/^the step is recorded as verified$/, (ctx) => {
    if (!ctx.state.verifiedSteps.includes(ctx.stepBeforeReply)) {
      throw new Error(`expected "${ctx.stepBeforeReply}" to be recorded as verified, got: ${JSON.stringify(ctx.state.verifiedSteps)}`);
    }
  });

  registry.define(/^the facilitator posts the next prerequisite instruction$/, (ctx) => {
    const nextStep = currentPrerequisiteStep(ctx.state);
    if (nextStep && !ctx.lastMessage.includes(nextStep)) {
      throw new Error(`expected the posted message to name the next step "${nextStep}", got: ${ctx.lastMessage}`);
    }
  });

  // ── bare-done-never-advances-04 ──────────────────────────────────────────
  registry.define(/^the principal replies only that the step is done$/, (ctx) => {
    ctx.stepBeforeReply = currentPrerequisiteStep(ctx.state);
    const turn = applyPrincipalReply(ctx.state, 'done', ctx.now);
    persistState(ctx, turn.state);
    ctx.lastMessage = turn.message;
  });

  registry.define(/^the step is not recorded as verified$/, (ctx) => {
    if (ctx.state.verifiedSteps.includes(ctx.stepBeforeReply)) {
      throw new Error(`expected "${ctx.stepBeforeReply}" to remain unverified`);
    }
  });

  registry.define(/^the facilitator re-asks for the step's verification command output$/, (ctx) => {
    if (!/not a verification output/i.test(ctx.lastMessage)) {
      throw new Error(`expected a re-ask for verification output, got: ${ctx.lastMessage}`);
    }
  });

  // ── failing-verification-explains-05 ─────────────────────────────────────
  registry.define(/^the principal pastes verification output that fails the step's check$/, (ctx) => {
    ctx.stepBeforeReply = currentPrerequisiteStep(ctx.state);
    const turn = applyPrincipalReply(ctx.state, 'Permission denied (publickey).', ctx.now);
    persistState(ctx, turn.state);
    ctx.lastMessage = turn.message;
  });

  registry.define(/^the facilitator explains what failed and re-issues the exact instruction$/, (ctx) => {
    if (!/verification failed/i.test(ctx.lastMessage)) {
      throw new Error(`expected an explanation of the failure, got: ${ctx.lastMessage}`);
    }
    if (!ctx.lastMessage.includes(PREREQUISITE_STEPS[ctx.stepBeforeReply].instruction)) {
      throw new Error(`expected the exact instruction to be re-issued, got: ${ctx.lastMessage}`);
    }
  });

  // ── prerequisites-checklist-coverage-06 (Scenario Outline) ──────────────
  registry.define(/^the onboarding has reached the "(.+)" prerequisite step$/, (ctx, step) => {
    setOnboardingOnStep(ctx, requireKnownStep(step));
  });

  registry.define(/^the facilitator posts the step's guidance$/, (ctx) => {
    const step = currentPrerequisiteStep(ctx.state);
    ctx.postedGuidance = renderStepInstruction(step);
    ctx.guidanceStep = step;
  });

  registry.define(/^the guidance contains the exact command for the target host$/, (ctx) => {
    if (!ctx.postedGuidance.includes(PREREQUISITE_STEPS[ctx.guidanceStep].instruction)) {
      throw new Error(`expected the guidance to contain the exact instruction, got: ${ctx.postedGuidance}`);
    }
  });

  registry.define(/^the guidance names the verification the principal must paste back$/, (ctx) => {
    if (!ctx.postedGuidance.includes(PREREQUISITE_STEPS[ctx.guidanceStep].verificationName)) {
      throw new Error(`expected the guidance to name the verification, got: ${ctx.postedGuidance}`);
    }
  });

  // ── dedicated-token-instruction-07 ───────────────────────────────────────
  registry.define(/^the guidance instructs creating a new bot token for the target$/, (ctx) => {
    if (!/new,? dedicated telegram bot/i.test(ctx.postedGuidance)) {
      throw new Error(`expected the guidance to instruct a new dedicated bot, got: ${ctx.postedGuidance}`);
    }
  });

  registry.define(/^the guidance states the primary swarm's token must never be reused$/, (ctx) => {
    if (!/do not reuse the.*primary.*token/i.test(ctx.postedGuidance)) {
      throw new Error(`expected the guidance to forbid reusing the primary token, got: ${ctx.postedGuidance}`);
    }
  });

  // ── restart-resumes-mid-flow-08 ──────────────────────────────────────────
  registry.define(/^the onboarding is on the "(.+)" prerequisite step with two steps verified$/, (ctx, step) => {
    setOnboardingOnStep(ctx, requireKnownStep(step), 2);
  });

  registry.define(/^the facilitator service restarts$/, (ctx) => {
    // "Restart" = re-derive the in-memory state from the persisted file,
    // exactly what a freshly-spawned process's own first read would do -
    // never reusing the in-memory ctx.state object directly.
    ctx.state = readOnboardingFacilitatorState(ctx.root, ctx.targetRepoUrl);
  });

  registry.define(/^the onboarding resumes at the "(.+)" step$/, (ctx, step) => {
    requireKnownStep(step);
    const resumedStep = currentPrerequisiteStep(ctx.state);
    if (resumedStep !== step) {
      throw new Error(`expected to resume at "${step}", got "${resumedStep}"`);
    }
  });

  registry.define(/^the verified steps stay verified$/, (ctx) => {
    if (ctx.state.verifiedSteps.length !== 2) {
      throw new Error(`expected 2 verified steps to survive the restart, got: ${JSON.stringify(ctx.state.verifiedSteps)}`);
    }
  });

  // ── pause-and-resume-09 ───────────────────────────────────────────────────
  registry.define(/^the principal posts the pause control$/, (ctx) => {
    if (classifyControl('pause') !== 'pause') {
      throw new Error('fixture setup error: "pause" no longer classifies as the pause control');
    }
    ctx.stepBeforeReply = currentPrerequisiteStep(ctx.state);
    ctx.instructionBeforePause = renderStepInstruction(ctx.stepBeforeReply);
    const turn = applyPrincipalReply(ctx.state, 'pause', ctx.now);
    persistState(ctx, turn.state);
    ctx.lastMessage = turn.message;
  });

  registry.define(/^the facilitator holds and confirms the onboarding is paused$/, (ctx) => {
    if (!ctx.state.paused) {
      throw new Error('expected the state to be paused');
    }
    if (!/paused/i.test(ctx.lastMessage)) {
      throw new Error(`expected a paused confirmation, got: ${ctx.lastMessage}`);
    }
  });

  registry.define(/^the principal posts the proceed control$/, (ctx) => {
    if (classifyControl('proceed') !== 'proceed') {
      throw new Error('fixture setup error: "proceed" no longer classifies as the proceed control');
    }
    const turn = applyPrincipalReply(ctx.state, 'proceed', ctx.now);
    persistState(ctx, turn.state);
    ctx.lastMessage = turn.message;
  });

  registry.define(/^the facilitator resumes at the same step with the same instruction$/, (ctx) => {
    if (ctx.state.paused) {
      throw new Error('expected the state to no longer be paused');
    }
    const resumedStep = currentPrerequisiteStep(ctx.state);
    if (resumedStep !== ctx.stepBeforeReply) {
      throw new Error(`expected to resume at "${ctx.stepBeforeReply}", got "${resumedStep}"`);
    }
    if (!ctx.lastMessage.includes(ctx.instructionBeforePause)) {
      throw new Error(`expected the same instruction to be re-posted, got: ${ctx.lastMessage}`);
    }
  });

  // ── prerequisites-ready-announces-next-10 ────────────────────────────────
  registry.define(/^every prerequisite step has a passing verification$/, (ctx) => {
    setOnboardingOnStep(ctx, 'bot-token', PREREQUISITE_STEP_IDS.length - 1);
  });

  registry.define(/^the last verification is recorded$/, (ctx) => {
    const turn = applyPrincipalReply(ctx.state, 'Created a new bot @widget_onboarding_bot, token saved.', ctx.now);
    persistState(ctx, turn.state);
    ctx.lastMessage = turn.message;
  });

  registry.define(/^the state advances to "prerequisites-ready"$/, (ctx) => {
    if (ctx.state.phase !== 'prerequisites-ready') {
      throw new Error(`expected phase "prerequisites-ready", got "${ctx.state.phase}"`);
    }
  });

  registry.define(/^the facilitator announces the survey phase comes next$/, (ctx) => {
    if (!/survey/i.test(ctx.lastMessage)) {
      throw new Error(`expected an announcement of the survey phase, got: ${ctx.lastMessage}`);
    }
  });
}

module.exports = { registerSteps };
