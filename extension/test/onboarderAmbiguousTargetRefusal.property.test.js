const assert = require('node:assert/strict');
const fc = require('fast-check');
const { pickUnambiguousInFlightState } = require('../out/onboarding/onboarderContractPhaseRouter');

// BL-625 invariant 2 authorship (BL-654): "One target's answers never land
// in another target's state: with a single topic reused across targets,
// every read and write is keyed by the target it belongs to, and an
// unattributable reply is refused rather than applied to whichever target
// was last active." This is genuinely new logic
// (pickUnambiguousInFlightState in onboarderContractPhaseRouter.ts) - before
// this ticket there was no tie-break at all for 2+ targets simultaneously in
// flight past contract-agreed (contract-agreed itself was excluded from "in
// flight"), so unlike invariant 1 (inherited from the pre-existing
// redelivery guard) this property is the FIRST proof this behavior holds.
//
// Generator reach, asserted by construction: 2-5 synthetic in-flight
// targets, each with a DISTINCT targetRepoUrl and a phase drawn from every
// phase this router treats as in-flight (checking-prerequisites through
// ready-to-launch - mirrors onboarderContractPhaseRouter.ts's own
// ALL_IN_FLIGHT_PHASES, which is not itself exported). The reply text is
// drawn to hit all three real cases: naming exactly one target's URL
// verbatim, naming none of them, or naming every one of them at once - so
// the property exercises resolve AND refuse, not just one happy path.
const IN_FLIGHT_PHASES = [
  'checking-prerequisites',
  'prerequisites-ready',
  'contract-proposed',
  'negotiating',
  'contract-agreed',
  'prompts-proposed',
  'ready-to-launch',
];

function stateAt(index, phase) {
  return {
    targetRepoUrl: `https://github.com/acme/target-${index}`,
    phase,
    stepIndex: 0,
    verifiedSteps: [],
    paused: false,
    updatedAtMs: 1_700_000_000_000 + index,
  };
}

const statesArb = fc
  .array(fc.constantFrom(...IN_FLIGHT_PHASES), { minLength: 2, maxLength: 5 })
  .map((phases) => phases.map((phase, i) => stateAt(i, phase)));

// Exactly one named target, no names at all, or every target named at once -
// covers resolve, refuse-none and refuse-multiple with one generator.
function replyArbFor(states) {
  return fc.oneof(
    ...states.map((s) => fc.constant(`proceed for ${s.targetRepoUrl}`)),
    fc.constant('proceed'),
    fc.constant(states.map((s) => s.targetRepoUrl).join(' and '))
  );
}

test('P BL-625 invariant 2: an unattributable reply is refused, never silently applied to an unnamed target among 2+ in flight', () => {
  fc.assert(
    fc.property(
      statesArb.chain((states) => fc.tuple(fc.constant(states), replyArbFor(states))),
      ([states, text]) => {
        const named = states.filter((s) => text.includes(s.targetRepoUrl));
        const result = pickUnambiguousInFlightState(states, text);

        if (named.length === 1) {
          assert.equal(result.state, named[0], 'the uniquely named target must resolve, never a different one');
          assert.equal(result.ambiguousMessage, undefined, 'a resolved pick must carry no refusal message');
        } else {
          assert.equal(result.state, undefined, `${named.length} named targets must never resolve to any single one`);
          assert.ok(result.ambiguousMessage, 'an unresolved reply among 2+ in-flight targets must carry a refusal message');
          for (const s of states) {
            assert.ok(
              result.ambiguousMessage.includes(s.targetRepoUrl),
              'the refusal must name every in-flight target so the principal can disambiguate'
            );
          }
        }
      }
    ),
    { numRuns: 300 }
  );
});

// Non-vacuity (BL-654): a "most recently touched wins" mutant - exactly the
// bug shape this invariant exists to prevent (the pre-BL-625 tie-break every
// OTHER picker in this file still uses for the 0-or-1-in-flight case) -
// silently resolves where the real implementation must refuse.
function mostRecentlyTouchedMutant(states, text) {
  const named = states.filter((s) => text.includes(s.targetRepoUrl));
  if (named.length === 1) {
    return { state: named[0] };
  }
  return { state: states.reduce((a, b) => (b.updatedAtMs > a.updatedAtMs ? b : a)) };
}

test('P BL-625 invariant 2 non-vacuity: a "most recently touched" mutant would resolve where the real implementation refuses', () => {
  const states = [stateAt(0, 'contract-agreed'), stateAt(1, 'prompts-proposed')];
  const text = 'proceed'; // names neither target
  const mutantResult = mostRecentlyTouchedMutant(states, text);
  assert.notEqual(mutantResult.state, undefined, 'sanity: the mutant DOES silently resolve to something (the bug this invariant forbids)');
  const realResult = pickUnambiguousInFlightState(states, text);
  assert.equal(realResult.state, undefined, 'the real implementation refuses instead of picking the most recently touched target');
});
