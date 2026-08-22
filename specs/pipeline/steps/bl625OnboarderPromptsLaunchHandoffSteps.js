'use strict';

// BL-625 (BL-590 slice 3): step handlers for the closing phases of the
// onboarding state machine - contract-agreed -> prompts-proposed ->
// ready-to-launch -> done, plus the single-topic-reused-across-targets
// scenario. Mirrors bl624OnboarderSurveyToGateSteps.js's own shape exactly:
// the REAL compiled pure decision (decideContractPhaseAction) and
// orchestrator (runContractPhaseAction, postLaunchHandoff) driven
// in-process against a FAKE, fully scripted ContractPhaseAdapters (never
// real git/claude/node subprocesses - those live only in
// contractPhaseRealAdapters.ts, this ticket's own untested I/O boundary).
// Scenario 05 (topic reuse) drives the whole router (routeOnboardingMessage)
// instead of the phase-relay layer alone, since it is genuinely testing
// routing across TWO simultaneously-persisted targets, not one phase's own
// decision/action pair.
//
// Registered SCOPED to this feature's own name (registry.defineScoped),
// same reasoning as bl624OnboarderSurveyToGateSteps.js: several step texts
// here ("the principal posts the proceed control") are deliberately worded
// to match the onboarding-topic vocabulary other feature files also use, so
// an unscoped registration would collide with or shadow theirs.

const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { decideContractPhaseAction, runContractPhaseAction, postLaunchHandoff } = require(path.join(
  EXT_DIR,
  'out',
  'onboarding',
  'contractPhaseRelay'
));
const { routeOnboardingMessage } = require(path.join(EXT_DIR, 'out', 'onboarding', 'onboarderContractPhaseRouter'));

const FEATURE_NAME = 'Onboarder slice 3 - prompts, launch handoff, and topic reuse';

const TARGET_URL = 'https://github.com/acme/widget';
const OTHER_TARGET_URL = 'https://github.com/acme/gadget';

function baseState(phase, targetRepoUrl = TARGET_URL, updatedAtMs = 1_700_000_000_000) {
  return {
    targetRepoUrl,
    phase,
    stepIndex: 5,
    verifiedSteps: ['toolchain', 'github-access', 'fork-clone', 'target-repo', 'bot-token'],
    paused: false,
    updatedAtMs,
  };
}

// A fully scripted, spying ContractPhaseAdapters fake - same shape as
// bl624OnboarderSurveyToGateSteps.js's own buildFakeAdapters, extended with
// proposePrompts (BL-625's own new adapter method).
function buildFakeAdapters(ctx) {
  ctx.calls = { clone: [], survey: [], propose: [], readCurrent: [], object: [], approve: [], gate: [], push: [], prompts: [] };
  ctx.promptsResult = { committed: true, withheld: false };
  return {
    async cloneTarget(url) {
      ctx.calls.clone.push(url);
      return { ok: true };
    },
    async surveyRepo(url) {
      ctx.calls.survey.push(url);
      return { languages: [], layoutSummary: '', readmeSummary: '', seedVision: '', initialBacklogSummary: '', useCaseObservations: [] };
    },
    async proposeContract(url) {
      ctx.calls.propose.push(url);
      return { scope: [], outOfScope: [], boundaries: [], initialBacklogSummary: '', agreement: 'agreed' };
    },
    async readCurrentContract() {
      return undefined;
    },
    async negotiateObject() {
      throw new Error('not exercised by this feature');
    },
    async negotiateApprove() {
      throw new Error('not exercised by this feature');
    },
    async checkGate() {
      return { decision: 'allow' };
    },
    async commitAndPush(url) {
      ctx.calls.push.push(url);
      return { ok: true, commitSha: 'abc1234def' };
    },
    async proposePrompts(url) {
      ctx.calls.prompts.push(url);
      return ctx.promptsResult;
    },
  };
}

async function driveText(ctx, text) {
  const action = decideContractPhaseAction(ctx.state, text);
  const turn = await runContractPhaseAction(ctx.state, action, ctx.adapters, ctx.now);
  ctx.state = turn.state;
  ctx.lastMessage = turn.message;
}

function registerSteps(registry) {
  function on(pattern, handler) {
    registry.defineScoped(pattern, handler, FEATURE_NAME);
  }

  // ── Background ────────────────────────────────────────────────────────
  on(/^an onboarder with a target onboarding in state "contract-agreed"$/, (ctx) => {
    ctx.now = () => 1_700_000_000_000;
    ctx.state = baseState('contract-agreed');
    ctx.adapters = buildFakeAdapters(ctx);
  });

  // ── shared Given: seed the onboarding directly at a later phase ─────────
  on(/^the onboarding is in state "(gate-open|ready-to-launch)"$/, (ctx, phase) => {
    ctx.state = { ...ctx.state, phase };
  });

  // ── BL-625 prompts-proposed-via-existing-cli-01 ─────────────────────────
  on(/^the principal posts the proceed control$/, async (ctx) => {
    await driveText(ctx, 'proceed');
  });

  on(/^the target prompts are proposed via the existing prompts tool$/, (ctx) => {
    if (!ctx.calls.prompts.includes(TARGET_URL)) {
      throw new Error(`expected the existing prompts tool to have run for ${TARGET_URL}, got: ${JSON.stringify(ctx.calls.prompts)}`);
    }
  });

  on(/^the prompt files are committed and pushed to the target repo$/, (ctx) => {
    if (!ctx.calls.push.includes(TARGET_URL)) {
      throw new Error(`expected the prompts to have been pushed for ${TARGET_URL}, got: ${JSON.stringify(ctx.calls.push)}`);
    }
  });

  on(/^the state advances to "(prompts-proposed|ready-to-launch|done)"$/, (ctx, phase) => {
    if (ctx.state.phase !== phase) {
      throw new Error(`expected phase "${phase}", got "${ctx.state.phase}"`);
    }
  });

  // ── BL-625 ready-to-launch-names-exact-command-02 ───────────────────────
  on(/^the onboarder posts the launch handoff$/, (ctx) => {
    const turn = postLaunchHandoff(ctx.state, ctx.now);
    ctx.state = turn.state;
    ctx.lastMessage = turn.message;
  });

  on(/^the message names the exact swarm launch command for the target host$/, (ctx) => {
    if (!/\.\/swarm widget --pack mono-router/.test(ctx.lastMessage)) {
      throw new Error(`expected the exact launch command, got: ${ctx.lastMessage}`);
    }
  });

  on(/^the message states the human runs it on the target host$/, (ctx) => {
    if (!/you run this/i.test(ctx.lastMessage)) {
      throw new Error(`expected the message to state the human runs it, got: ${ctx.lastMessage}`);
    }
  });

  // ── BL-625 never-claims-remote-launch-03 ────────────────────────────────
  on(/^the principal asks whether the swarm is running$/, async (ctx) => {
    await driveText(ctx, 'is it running?');
  });

  on(/^the onboarder states it cannot launch or observe the target host$/, (ctx) => {
    if (!/cannot launch or observe/i.test(ctx.lastMessage)) {
      throw new Error(`expected the "cannot observe" disclaimer, got: ${ctx.lastMessage}`);
    }
    if (ctx.state.phase !== 'ready-to-launch') {
      throw new Error(`expected the state to stay "ready-to-launch", got "${ctx.state.phase}"`);
    }
  });

  on(/^the onboarder restates the launch command instead$/, (ctx) => {
    if (!/\.\/swarm widget --pack mono-router/.test(ctx.lastMessage)) {
      throw new Error(`expected the launch command to be restated, got: ${ctx.lastMessage}`);
    }
  });

  // ── BL-625 done-closes-the-onboarding-04 ────────────────────────────────
  on(/^the principal confirms the swarm launched on the target host$/, async (ctx) => {
    await driveText(ctx, 'proceed');
  });

  on(/^the onboarder posts a completion summary naming the target$/, (ctx) => {
    if (!ctx.lastMessage.includes(TARGET_URL)) {
      throw new Error(`expected the completion summary to name ${TARGET_URL}, got: ${ctx.lastMessage}`);
    }
    if (!/\bdone\b/i.test(ctx.lastMessage)) {
      throw new Error(`expected the completion summary to say the onboarding is done, got: ${ctx.lastMessage}`);
    }
  });

  // ── BL-625 topic-reused-next-target-05 ──────────────────────────────────
  on(/^a completed onboarding exists for a previous target$/, (ctx) => {
    ctx.now = () => 1_700_000_000_500;
    ctx.doneState = baseState('done', TARGET_URL, 1_700_000_000_000);
    ctx.adapters = buildFakeAdapters(ctx);
  });

  on(/^the principal posts a new target repo URL in the Onboarding topic$/, async (ctx) => {
    const outcome = await routeOnboardingMessage([ctx.doneState], OTHER_TARGET_URL, ctx.now, ctx.adapters);
    ctx.routedOutcome = outcome;
  });

  on(/^a separate per-target state is persisted for the new URL$/, (ctx) => {
    if (ctx.routedOutcome.kind !== 'started' || ctx.routedOutcome.state.targetRepoUrl !== OTHER_TARGET_URL) {
      throw new Error(`expected a fresh state started for ${OTHER_TARGET_URL}, got: ${JSON.stringify(ctx.routedOutcome)}`);
    }
  });

  on(/^the previous target's state stays "done"$/, (ctx) => {
    if (ctx.doneState.phase !== 'done') {
      throw new Error(`expected the previous target to stay "done", got "${ctx.doneState.phase}"`);
    }
  });

  on(/^the onboarder's replies name which target they concern$/, (ctx) => {
    if (!ctx.routedOutcome.message.includes(OTHER_TARGET_URL)) {
      throw new Error(`expected the reply to name ${OTHER_TARGET_URL}, got: ${ctx.routedOutcome.message}`);
    }
  });
}

module.exports = { registerSteps };
