'use strict';

// BL-624 (BL-590 slice 2): step handlers for the survey-through-agreed-
// contract phases - prerequisites-ready -> contract-proposed ->
// negotiating -> contract-agreed. Drives the REAL compiled pure decision
// (decideContractPhaseAction) and orchestrator (runContractPhaseAction,
// proveGateAndPush) in-process, exactly like bl590OnboarderSteps.js drives
// onboarderState.ts's own pure functions - a FAKE, fully scripted
// ContractPhaseAdapters plays clone/survey/propose/negotiate/gate/push
// (never real git/claude/node subprocesses; those live only in
// contractPhaseRealAdapters.ts, this ticket's own untested I/O boundary),
// mirroring bl590OnboarderSteps.js's own fake Telegram postFn for the same
// testable-module-boundary reason.
//
// Every step here is registered SCOPED to this feature's own name
// (registry.defineScoped) rather than the unscoped registry.define most
// other step files use - several of this feature's step texts ("the
// principal posts the proceed control") are deliberately worded to match
// BL-590's own onboarding-topic vocabulary, and an unscoped registration
// here would either collide with or silently shadow bl590OnboarderSteps.js's
// own (unrelated) handler for the identical text, per stepRegistry.js's own
// documented first-match-wins fallback.

const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { decideContractPhaseAction, runContractPhaseAction, proveGateAndPush } = require(path.join(EXT_DIR, 'out', 'onboarding', 'contractPhaseRelay'));

const FEATURE_NAME = 'Onboarder slice 2 - survey to agreed contract through the existing gate';

const TARGET_URL = 'https://github.com/acme/widget';

const FIXTURE_CONTRACT = {
  scope: ['Deliver the seed vision: Ship the MVP.'],
  outOfScope: [],
  boundaries: ['Every feature still passes its own approval gate.'],
  initialBacklogSummary: '3 tickets queued.',
  agreement: 'proposed',
};

const FIXTURE_FACTS = {
  languages: ['TypeScript'],
  layoutSummary: 'src/, test/',
  readmeSummary: 'A widget.',
  seedVision: 'Ship the MVP.',
  initialBacklogSummary: '3 tickets queued.',
  useCaseObservations: [],
};

function baseState(phase) {
  return {
    targetRepoUrl: TARGET_URL,
    phase,
    stepIndex: 5,
    verifiedSteps: ['toolchain', 'github-access', 'fork-clone', 'target-repo', 'bot-token'],
    paused: false,
    updatedAtMs: 1_700_000_000_000,
  };
}

// A fully scripted, spying ContractPhaseAdapters fake - every field a
// scenario needs to control (clone/survey failure, gate decision) lives on
// ctx, read fresh on every call, so a later step ("the clone fails") can
// arm a failure AFTER the background has already built ctx.adapters.
function buildFakeAdapters(ctx) {
  ctx.calls = { clone: [], survey: [], propose: [], readCurrent: [], object: [], approve: [], gate: [], push: [] };
  ctx.cloneShouldFail = false;
  ctx.gateDecision = { decision: 'allow' };
  return {
    async cloneTarget(url) {
      ctx.calls.clone.push(url);
      return ctx.cloneShouldFail ? { ok: false, error: 'repository not found' } : { ok: true };
    },
    async surveyRepo(url) {
      ctx.calls.survey.push(url);
      return FIXTURE_FACTS;
    },
    async proposeContract(url, facts) {
      ctx.calls.propose.push({ url, facts });
      ctx.postedContract = FIXTURE_CONTRACT;
      return FIXTURE_CONTRACT;
    },
    async readCurrentContract(url) {
      ctx.calls.readCurrent.push(url);
      return ctx.postedContract;
    },
    async negotiateObject(url, objection) {
      ctx.calls.object.push({ url, objection });
      const revised = { ...FIXTURE_CONTRACT, scope: [...FIXTURE_CONTRACT.scope, `Per operator request: ${objection}`] };
      ctx.postedContract = revised;
      return { outcome: 'revised', contract: revised };
    },
    async negotiateApprove(url) {
      ctx.calls.approve.push(url);
      const agreed = { ...(ctx.postedContract || FIXTURE_CONTRACT), agreement: 'agreed' };
      ctx.postedContract = agreed;
      return { outcome: 'agreed', contract: agreed };
    },
    async checkGate(url) {
      ctx.calls.gate.push(url);
      return ctx.gateDecision;
    },
    async commitAndPush(url) {
      ctx.calls.push.push(url);
      return { ok: true, commitSha: 'abc1234def' };
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
  on(/^an onboarder with a target onboarding in state "prerequisites-ready"$/, (ctx) => {
    ctx.now = () => 1_700_000_000_000;
    ctx.state = baseState('prerequisites-ready');
    ctx.postedContract = undefined;
    ctx.adapters = buildFakeAdapters(ctx);
  });

  // ── shared Given: seed the onboarding directly at a later phase ────────
  on(/^the onboarding is in state "(contract-proposed|negotiating|contract-agreed)"$/, (ctx, phase) => {
    ctx.state = { ...ctx.state, phase };
    ctx.postedContract = FIXTURE_CONTRACT;
  });

  on(/^the onboarding is in state "negotiating" with a revised contract posted$/, (ctx) => {
    const revised = { ...FIXTURE_CONTRACT, scope: [...FIXTURE_CONTRACT.scope, 'Per operator request: drop the PWA work'] };
    ctx.state = { ...ctx.state, phase: 'negotiating' };
    ctx.postedContract = revised;
  });

  // ── survey-runs-on-own-clone-01 ─────────────────────────────────────────
  on(/^the principal posts the proceed control$/, async (ctx) => {
    await driveText(ctx, 'proceed');
  });

  on(/^the onboarder clones the target repo using its own GitHub access$/, (ctx) => {
    if (!ctx.calls.clone.includes(TARGET_URL)) {
      throw new Error(`expected the onboarder to have cloned ${TARGET_URL}, got clone calls: ${JSON.stringify(ctx.calls.clone)}`);
    }
  });

  on(/^the survey runs against the onboarder's clone$/, (ctx) => {
    if (!ctx.calls.survey.includes(TARGET_URL)) {
      throw new Error(`expected the survey to have run against ${TARGET_URL}, got: ${JSON.stringify(ctx.calls.survey)}`);
    }
  });

  on(/^the proposed contract is posted into the Onboarding topic$/, (ctx) => {
    if (!ctx.lastMessage.includes(FIXTURE_CONTRACT.boundaries[0])) {
      throw new Error(`expected the proposed contract to be posted, got: ${ctx.lastMessage}`);
    }
  });

  on(/^the state advances to "(contract-proposed|contract-agreed)"$/, (ctx, phase) => {
    if (ctx.state.phase !== phase) {
      throw new Error(`expected phase "${phase}", got "${ctx.state.phase}"`);
    }
  });

  // ── show-me-inspection-02 ────────────────────────────────────────────────
  on(/^the principal posts the show-me control$/, async (ctx) => {
    await driveText(ctx, 'show-me');
  });

  on(/^the current proposed contract is posted into the topic$/, (ctx) => {
    if (!ctx.lastMessage.includes(ctx.postedContract.boundaries[0])) {
      throw new Error(`expected the current contract to be posted, got: ${ctx.lastMessage}`);
    }
  });

  on(/^the state stays "(contract-proposed|prerequisites-ready)"$/, (ctx, phase) => {
    if (ctx.state.phase !== phase) {
      throw new Error(`expected the state to stay "${phase}", got "${ctx.state.phase}"`);
    }
  });

  // ── change-this-runs-a-real-object-round-03 ─────────────────────────────
  on(/^the principal posts the change-this control with an objection$/, async (ctx) => {
    ctx.objectionText = 'drop the PWA work';
    await driveText(ctx, `change-this ${ctx.objectionText}`);
  });

  on(/^the objection is applied via the existing negotiate object round$/, (ctx) => {
    const applied = ctx.calls.object.find((c) => c.objection === ctx.objectionText);
    if (!applied) {
      throw new Error(`expected the objection "${ctx.objectionText}" to have been applied, got: ${JSON.stringify(ctx.calls.object)}`);
    }
  });

  on(/^a revised contract is posted into the topic$/, (ctx) => {
    if (!ctx.lastMessage.includes(ctx.objectionText)) {
      throw new Error(`expected the revised contract (carrying the objection) to be posted, got: ${ctx.lastMessage}`);
    }
  });

  on(/^the state is "negotiating"$/, (ctx) => {
    if (ctx.state.phase !== 'negotiating') {
      throw new Error(`expected phase "negotiating", got "${ctx.state.phase}"`);
    }
  });

  // ── proceed-agrees-via-existing-approve-04 ──────────────────────────────
  on(/^the agreement is recorded via the existing negotiate approve round$/, (ctx) => {
    if (!ctx.calls.approve.includes(TARGET_URL)) {
      throw new Error(`expected the negotiate approve round to have run for ${TARGET_URL}, got: ${JSON.stringify(ctx.calls.approve)}`);
    }
  });

  // ── gate-is-the-existing-gate-05 ─────────────────────────────────────────
  on(/^the onboarder checks the build-start gate$/, async (ctx) => {
    ctx.gateDecision = { decision: 'hold', reason: 'the onboarding contract is not yet agreed' };
    ctx.gateCallsBefore = ctx.calls.gate.length;
    const turn = await proveGateAndPush(ctx.state, ctx.adapters);
    ctx.state = turn.state;
    ctx.lastMessage = turn.message;
  });

  on(/^the check shells to the existing onboarding contract gate$/, (ctx) => {
    if (ctx.calls.gate.length !== ctx.gateCallsBefore + 1) {
      throw new Error(`expected exactly one new gate check call, got ${ctx.calls.gate.length - ctx.gateCallsBefore}`);
    }
  });

  on(/^a failing gate keeps the onboarding blocked with the gate's own reason posted$/, (ctx) => {
    if (!ctx.lastMessage.includes(ctx.gateDecision.reason)) {
      throw new Error(`expected the gate's own reason to be posted, got: ${ctx.lastMessage}`);
    }
    if (ctx.calls.push.length !== 0) {
      throw new Error('BL-624 invariant 2: expected nothing to be pushed while the gate holds');
    }
  });

  // ── agreed-contract-committed-back-06 ───────────────────────────────────
  on(/^the agreed contract files are committed to the target repo$/, async (ctx) => {
    ctx.gateDecision = { decision: 'allow' };
    const turn = await proveGateAndPush(ctx.state, ctx.adapters);
    ctx.state = turn.state;
    ctx.lastMessage = turn.message;
    // Committing is negotiateApprove's own job (updateTargetContract, via
    // the existing negotiate-onboarding-contract.ts CLI) - already proven
    // by "the agreement is recorded via the existing negotiate approve
    // round" in scenario 04. This step's own job is proving the PUSH cascade
    // that follows it, asserted by the two steps below.
  });

  on(/^the commit is pushed to the target repo on GitHub$/, (ctx) => {
    if (!ctx.calls.push.includes(TARGET_URL)) {
      throw new Error(`expected the agreed contract to have been pushed for ${TARGET_URL}, got: ${JSON.stringify(ctx.calls.push)}`);
    }
  });

  on(/^the onboarder posts the commit reference into the topic$/, (ctx) => {
    if (!/\babc1234def\b/.test(ctx.lastMessage)) {
      throw new Error(`expected the commit reference to be posted, got: ${ctx.lastMessage}`);
    }
  });

  // ── clone-failure-is-a-visible-hold-07 ──────────────────────────────────
  on(/^the principal posts the proceed control and the clone fails$/, async (ctx) => {
    ctx.cloneShouldFail = true;
    ctx.stateBeforeProceed = ctx.state;
    await driveText(ctx, 'proceed');
  });

  on(/^the onboarder posts the failure reason and the retry instruction$/, (ctx) => {
    if (!ctx.lastMessage.includes('repository not found')) {
      throw new Error(`expected the failure reason to be posted, got: ${ctx.lastMessage}`);
    }
    if (!/proceed.*to retry/i.test(ctx.lastMessage)) {
      throw new Error(`expected a retry instruction to be posted, got: ${ctx.lastMessage}`);
    }
    if (ctx.calls.survey.length !== 0) {
      throw new Error('expected the survey never to run after a clone failure');
    }
  });
}

module.exports = { registerSteps };
