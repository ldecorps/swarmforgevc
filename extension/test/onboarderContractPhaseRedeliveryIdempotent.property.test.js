const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { listOnboarderStates, writeOnboarderState } = require('../out/onboarding/onboarderStateStore');
const { handleOnboarderMessage } = require('../out/tools/telegram-front-desk-bot');

// BL-624 invariant authorship (BL-654): "every durable write is idempotent
// under redelivery of the same Telegram update" was already pinned for the
// checking-prerequisites phases by onboarderRedeliveryIdempotent.property.test.js
// - that property's OWN generator deliberately never reaches prerequisites-
// ready, let alone BL-624's new survey/negotiate/gate/push phases
// (onboarderRedeliveryIdempotent.property.test.js:24-37's own comment), so
// it proves nothing about the code this ticket adds. This property drives
// the SAME real guard machinery (handleOnboarderMessage's
// findProcessedOnboardingUpdate/writeOnboardingStateAndMarkUpdateProcessed,
// entirely unmodified by this ticket) through BL-624's own new phases
// instead, with a FAKE ContractPhaseAdapters (never real git/claude - those
// are their own untested boundary, contractPhaseRealAdapters.ts) so the
// property explores interleaving/redelivery, not live I/O.
//
// Generator reach, asserted by construction: op 0 is forced to
// 'proceed' against a target PRE-SEEDED at prerequisites-ready, which
// deideContractPhaseAction maps to 'start-survey' - the ONE transition that
// leaves prerequisites-ready. Every follow-up op is drawn only from
// {'show-me', 'change-this <text>'} - decideContractPhaseAction never maps
// either to a transition that reaches 'contract-agreed' (only 'proceed'
// does, and 'proceed' never appears in the follow-up pool) - so the target
// is PROVEN, not assumed, to stay "in flight" (pickActiveContractPhaseState)
// for the whole run, plateaued across {contract-proposed, negotiating}
// exactly like the sibling property's own toolchain/github-access plateau.
const TARGET_URL = 'https://github.com/acme/widget';
const SEED_STATE = {
  targetRepoUrl: TARGET_URL,
  phase: 'prerequisites-ready',
  stepIndex: 5,
  verifiedSteps: ['toolchain', 'github-access', 'fork-clone', 'target-repo', 'bot-token'],
  paused: false,
  updatedAtMs: 1_700_000_000_000,
};

const FIXTURE_CONTRACT = {
  scope: ['Deliver the seed vision: Ship the MVP.'],
  outOfScope: [],
  boundaries: ['Every feature still passes its own approval gate.'],
  initialBacklogSummary: '3 tickets queued.',
  agreement: 'proposed',
};

// Deterministic, instant, never touches git/claude/fs beyond the state
// store - every call always succeeds the same way, so the ONLY source of
// variation across ops is the redelivery guard itself (the thing under
// test), never adapter nondeterminism.
function fakeContractPhaseAdapters() {
  return {
    async cloneTarget() {
      return { ok: true };
    },
    async surveyRepo() {
      return { languages: [], layoutSummary: '', readmeSummary: '', seedVision: '', initialBacklogSummary: '', useCaseObservations: [] };
    },
    async proposeContract() {
      return FIXTURE_CONTRACT;
    },
    async readCurrentContract() {
      return FIXTURE_CONTRACT;
    },
    async negotiateObject(_url, objection) {
      return { outcome: 'revised', contract: { ...FIXTURE_CONTRACT, scope: [...FIXTURE_CONTRACT.scope, objection] } };
    },
    async negotiateApprove() {
      return { outcome: 'agreed', contract: { ...FIXTURE_CONTRACT, agreement: 'agreed' } };
    },
    async checkGate() {
      return { decision: 'allow' };
    },
    async commitAndPush() {
      return { ok: true, commitSha: 'abc1234def' };
    },
  };
}

function scriptedPostFn(successes) {
  const calls = [];
  const postFn = async (url, body) => {
    const ok = successes[calls.length % successes.length];
    calls.push({ url, body, ok });
    if (!ok) {
      return { ok: false, status: 502, json: { ok: false, description: 'Bad Gateway' } };
    }
    return { ok: true, status: 200, json: { ok: true, result: { message_id: calls.length } } };
  };
  return { postFn, calls };
}

const followUpMessageArb = fc.constantFrom('show-me', 'change-this drop the PWA work', 'change-this add CLI support');
const followUpOpArb = fc.record({ updateId: fc.integer({ min: 1, max: 6 }), text: followUpMessageArb });

test('P BL-624: a redelivered updateId in the survey/negotiate phases re-sends the first-computed message and never re-enters the orchestration', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(followUpOpArb, { minLength: 1, maxLength: 14 }),
      fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
      async (followUps, successes) => {
        const root = mkTmpDir('sfvc-onboarder-contract-phase-redelivery-prop-');
        writeOnboarderState(root, SEED_STATE);
        const adapters = fakeContractPhaseAdapters();
        const { postFn, calls } = scriptedPostFn(successes);
        const ops = [{ updateId: 0, text: 'proceed' }, ...followUps];

        const firstBodyFor = new Map();
        const deliveredFor = new Set();
        let adapterCallsBefore = 0;

        for (const op of ops) {
          const seenBefore = firstBodyFor.has(op.updateId);
          const statesBefore = listOnboarderStates(root);
          const callsBefore = calls.length;

          await handleOnboarderMessage(root, 'fake-token', 'fake-chat', 42, op.text, op.updateId, postFn, adapters);

          const sent = calls.slice(callsBefore);
          if (!seenBefore) {
            assert.equal(sent.length, 1, 'a first-seen update is always attempted exactly once');
            firstBodyFor.set(op.updateId, sent[0].body);
            if (sent[0].ok) {
              deliveredFor.add(op.updateId);
            }
            continue;
          }

          if (deliveredFor.has(op.updateId)) {
            assert.equal(sent.length, 0, `updateId ${op.updateId} already landed - a redelivery must send nothing at all`);
          } else {
            assert.equal(sent.length, 1, `updateId ${op.updateId} never landed - a redelivery must retry the send`);
            assert.equal(
              sent[0].body,
              firstBodyFor.get(op.updateId),
              `updateId ${op.updateId} must re-send the message computed on the FIRST attempt, never a freshly recomputed one`
            );
            if (sent[0].ok) {
              deliveredFor.add(op.updateId);
            }
          }
          assert.deepEqual(
            listOnboarderStates(root),
            statesBefore,
            `updateId ${op.updateId} is a redelivery - it must not re-enter the orchestration or mutate any target's state`
          );
        }
        // Sanity on the reachability floor itself: op 0 must actually have
        // left prerequisites-ready (proving 'start-survey' really ran, not
        // merely that no assertion above happened to fail).
        const finalStates = listOnboarderStates(root);
        assert.equal(finalStates.length, 1);
        assert.notEqual(finalStates[0].phase, 'prerequisites-ready');
        assert.notEqual(finalStates[0].phase, 'contract-agreed', 'the plateau must never reach contract-agreed by construction');
      }
    ),
    { numRuns: 120 }
  );
});
