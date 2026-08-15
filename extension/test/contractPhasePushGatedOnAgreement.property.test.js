const assert = require('node:assert/strict');
const fc = require('fast-check');
const { runContractPhaseAction } = require('../out/onboarding/contractPhaseRelay');

// BL-624 invariant authorship (BL-654): "Nothing is pushed to the target
// repo before the human has agreed the contract: a proposal, a revision
// and an agreement are distinguishable states, and only the third writes."
// "Writes" here means git PUSH to the target's GitHub remote specifically -
// the local commits a proposal/revision/approval already makes (via the
// EXISTING negotiate-onboarding-contract.ts/propose-onboarding-contract.ts
// CLIs, unmodified by this ticket) are not what the invariant is about; see
// BL-624.yaml's own out_of_scope and the ticket's own wording ("committed
// AND PUSHED back... on GitHub"). commitAndPush is the one adapter method
// that performs that push.
//
// Generator reach, asserted by construction: every ContractPhaseAction
// variant is generated (start-survey, show-current-contract,
// negotiate-object with an arbitrary objection, negotiate-approve), each
// run against a randomly scripted adapter whose negotiateApprove/checkGate
// outcomes vary freely (agreed vs already-ended; allow vs hold) - so the
// property exercises every branch that could plausibly call
// commitAndPush, not just the one happy-path sequence a single example
// test would think to write.
const TARGET_URL = 'https://github.com/acme/widget';
const NOW_MS = 1_700_000_000_000;
const now = () => NOW_MS;

const FIXTURE_CONTRACT = {
  scope: ['Deliver the seed vision: Ship the MVP.'],
  outOfScope: [],
  boundaries: ['Every feature still passes its own approval gate.'],
  initialBacklogSummary: '3 tickets queued.',
  agreement: 'proposed',
};

function stateFor(action) {
  const phase = action.kind === 'start-survey' ? 'prerequisites-ready' : 'negotiating';
  return { targetRepoUrl: TARGET_URL, phase, stepIndex: 5, verifiedSteps: [], paused: false, updatedAtMs: NOW_MS - 1000 };
}

function scriptedAdapters({ cloneOk, surveyOk, proposeOk, approveAlreadyEnded, gateAllow }) {
  const pushCalls = [];
  return {
    adapters: {
      async cloneTarget() {
        return cloneOk ? { ok: true } : { ok: false, error: 'simulated clone failure' };
      },
      async surveyRepo() {
        if (!surveyOk) throw new Error('simulated survey failure');
        return { languages: [], layoutSummary: '', readmeSummary: '', seedVision: '', initialBacklogSummary: '', useCaseObservations: [] };
      },
      async proposeContract() {
        if (!proposeOk) throw new Error('simulated propose failure');
        return FIXTURE_CONTRACT;
      },
      async readCurrentContract() {
        return FIXTURE_CONTRACT;
      },
      async negotiateObject(_url, objection) {
        return { outcome: 'revised', contract: { ...FIXTURE_CONTRACT, scope: [...FIXTURE_CONTRACT.scope, objection] } };
      },
      async negotiateApprove() {
        return approveAlreadyEnded ? { outcome: 'already-ended' } : { outcome: 'agreed', contract: { ...FIXTURE_CONTRACT, agreement: 'agreed' } };
      },
      async checkGate() {
        return gateAllow ? { decision: 'allow' } : { decision: 'hold', reason: 'not yet agreed' };
      },
      async commitAndPush(url) {
        pushCalls.push(url);
        return { ok: true, commitSha: 'abc1234def' };
      },
    },
    pushCalls,
  };
}

const actionArb = fc.oneof(
  fc.constant({ kind: 'start-survey' }),
  fc.constant({ kind: 'show-current-contract' }),
  fc.string({ minLength: 1, maxLength: 20 }).map((objection) => ({ kind: 'negotiate-object', objection })),
  fc.constant({ kind: 'negotiate-approve' })
);

const scriptArb = fc.record({
  cloneOk: fc.boolean(),
  surveyOk: fc.boolean(),
  proposeOk: fc.boolean(),
  approveAlreadyEnded: fc.boolean(),
  gateAllow: fc.boolean(),
});

test('P BL-624 invariant 2: commitAndPush (the target GitHub push) is invoked if and only if this turn actually agreed the contract AND the build-start gate allowed it', async () => {
  await fc.assert(
    fc.asyncProperty(actionArb, scriptArb, async (action, script) => {
      const { adapters, pushCalls } = scriptedAdapters(script);
      const state = stateFor(action);
      await runContractPhaseAction(state, action, adapters, now);

      const shouldHavePushed = action.kind === 'negotiate-approve' && !script.approveAlreadyEnded && script.gateAllow;
      assert.equal(
        pushCalls.length,
        shouldHavePushed ? 1 : 0,
        `action ${JSON.stringify(action)} with script ${JSON.stringify(script)} pushed ${pushCalls.length} time(s), expected ${shouldHavePushed ? 1 : 0}`
      );
    }),
    { numRuns: 300 }
  );
});
