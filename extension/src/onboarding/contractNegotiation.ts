import { ProposedContract } from './contractTypes';

// BL-344: BL-262 shipped a SINGLE-ROUND proposal - the operator's only
// recourse was to hand-edit contract.yaml. This module is the iterative
// negotiation loop: the operator objects in his own words, the swarm
// revises IN RESPONSE (never a blind re-survey that would re-emit the
// same proposal - the ticket's own "most likely way to build this
// wrong"), and the loop converges on approval or a bounded round cap.

export const DEFAULT_MAX_NEGOTIATION_ROUNDS = 5;

export interface NegotiationRound {
  round: number;
  objection: string;
  changedFields: string[];
}

export interface NegotiationState {
  contract: ProposedContract;
  rounds: NegotiationRound[];
  ended: boolean;
  endedReason: 'approved' | 'round-limit' | null;
}

export interface RevisionResult {
  contract: ProposedContract;
  changedFields: string[];
}

// A crude but real overlap check: at least one significant (4+ char) word
// from the objection appears in the scope entry - good enough to route an
// objection like "remove the PWA work" to a scope entry mentioning "PWA",
// without needing real NLP for a deterministic, testable function.
function phraseOverlap(objectionLower: string, scopeEntryLower: string): boolean {
  const words = objectionLower.split(/\W+/).filter((w) => w.length >= 4);
  return words.some((w) => scopeEntryLower.includes(w));
}

// BL-442, sibling of BL-409's "external text into a structured file must be
// sanitized first": a revision that DOES derive a real change still embeds
// the human's own raw reply text into a contract entry, and
// generateContractMarkdown renders each entry as one plain `- <entry>`
// bullet line - an embedded newline would break that entry onto its own
// unmarked line. Collapse to a single line before it's spliced in.
function sanitizeForContractLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

// BL-344 onboarding-negotiation-02/03/07: revises a proposed contract IN
// RESPONSE to the operator's own objection text - keyword-driven, not an
// LLM call, so this stays a pure, fast, deterministic, unit-testable
// function (the engineering article's own testability boundary).
//   - "remove/exclude/drop/don't include/never <X>" naming something
//     currently IN scope moves that exact scope entry to outOfScope.
//   - "add/include/also <X>" adds a new scope entry carrying the
//     operator's own words.
//   - anything else derives NO change (BL-442): the prior behaviour here
//     recorded a new boundary from the raw text unconditionally, which is
//     exactly how a misclassified approval ("All agreed") landed as a
//     fabricated contract clause. changedFields: [] tells the caller
//     (objectToContract, and runObject above it) that nothing could be
//     derived, so it can ask the human to rephrase instead of presenting a
//     "revision" that never actually happened.
export function reviseContractFromObjection(previous: ProposedContract, objection: string): RevisionResult {
  const trimmed = objection.trim();
  if (!trimmed) {
    return { contract: previous, changedFields: [] };
  }

  const lower = trimmed.toLowerCase();
  const removalIntent = /\b(remove|exclude|drop|don'?t include|never)\b/.test(lower);
  const additionIntent = /\b(add|include|also)\b/.test(lower);
  const sanitized = sanitizeForContractLine(trimmed);

  if (removalIntent) {
    const matchIndex = previous.scope.findIndex((entry) => phraseOverlap(lower, entry.toLowerCase()));
    if (matchIndex !== -1) {
      const removed = previous.scope[matchIndex];
      return {
        contract: {
          ...previous,
          scope: previous.scope.filter((_, i) => i !== matchIndex),
          outOfScope: [...previous.outOfScope, `${removed} (removed per operator objection: "${sanitized}")`],
          agreement: 'proposed',
        },
        changedFields: ['scope', 'outOfScope'],
      };
    }
  }

  if (additionIntent) {
    return {
      contract: {
        ...previous,
        scope: [...previous.scope, `Per operator request: ${sanitized}`],
        agreement: 'proposed',
      },
      changedFields: ['scope'],
    };
  }

  // BL-442: neither pattern derived a concrete change. The previous
  // behaviour here blind-appended the raw objection text as a fabricated
  // boundary clause - the root cause of this ticket (a natural-language
  // approval like "All agreed", misclassified upstream as an objection,
  // landed as a junk contract line). No code path may fabricate a contract
  // line from text it could not actually interpret: leave the contract
  // untouched and let the caller ask the human to rephrase.
  // changedFields: [] is the "nothing could be derived" signal
  // objectToContract's own caller (runObject) relies on.
  return { contract: previous, changedFields: [] };
}

export function startNegotiation(contract: ProposedContract): NegotiationState {
  return { contract, rounds: [], ended: false, endedReason: null };
}

// BL-344 onboarding-negotiation-05: bounded rounds, so a disagreement
// cannot spin forever burning tokens. Once the cap is reached, a further
// objection is refused (the negotiation just ends - round-limit - never
// silently approved by exhaustion; onboarding-negotiation-05's own "no
// contract is approved"). A negotiation that has already ended (either
// reason) never accepts another round.
export function objectToContract(
  state: NegotiationState,
  objection: string,
  maxRounds: number = DEFAULT_MAX_NEGOTIATION_ROUNDS
): NegotiationState {
  if (state.ended) {
    return state;
  }
  const nextRoundNumber = state.rounds.length + 1;
  if (nextRoundNumber > maxRounds) {
    return { ...state, ended: true, endedReason: 'round-limit' };
  }
  const { contract: revised, changedFields } = reviseContractFromObjection(state.contract, objection);
  return {
    contract: revised,
    rounds: [...state.rounds, { round: nextRoundNumber, objection, changedFields }],
    ended: false,
    endedReason: null,
  };
}

// BL-344 onboarding-negotiation-04/06: the negotiation ends on approval,
// and ONLY approval flips agreement to 'agreed' - the (unchanged)
// build-start gate keeps holding dispatch for every other state.
export function approveContract(state: NegotiationState): NegotiationState {
  if (state.ended) {
    return state;
  }
  return {
    contract: { ...state.contract, agreement: 'agreed' },
    rounds: state.rounds,
    ended: true,
    endedReason: 'approved',
  };
}
