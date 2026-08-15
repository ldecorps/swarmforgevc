// BL-624: composes onboarderState.ts's own pure, synchronous
// handleOnboardingMessage (still the sole owner of the URL-start/resume
// branch and the checking-prerequisites state machine) with
// contractPhaseRelay.ts's async decision+adapters orchestration for
// everything at or past prerequisites-ready. Neither side is rewritten -
// this file is only the seam between them, mirroring the constitution's own
// pipeline-boundary shape (each stage owns its slice, a thin router hands
// off between them).
import { handleOnboardingMessage, OnboarderState, OnboardingMessageOutcome, OnboardingPhase } from './onboarderState';
import { ContractPhaseAdapters, decideContractPhaseAction, runContractPhaseAction } from './contractPhaseRelay';

// Every phase contractPhaseRelay.ts owns: prerequisites-ready is the entry
// point (a "proceed" there starts the survey), contract-proposed and
// negotiating are open for show-me/change-this/proceed, and contract-agreed
// is terminal for this slice (BL-625's own territory beyond it). Excluding
// contract-agreed from "in flight" means a stray non-control reply after
// agreement falls through to NO_ACTIVE_ONBOARDING_MESSAGE rather than
// re-entering this phase - there is nothing left here to act on.
const IN_FLIGHT_CONTRACT_PHASES: readonly OnboardingPhase[] = ['prerequisites-ready', 'contract-proposed', 'negotiating'];

// The contract-phase twin of onboarderState.ts's own pickActiveOnboardingState -
// same "most recently touched wins" tie-break, scoped to the phases THIS
// slice owns instead of checking-prerequisites.
export function pickActiveContractPhaseState(states: readonly OnboarderState[]): OnboarderState | undefined {
  const inFlight = states.filter((s) => IN_FLIGHT_CONTRACT_PHASES.includes(s.phase));
  if (inFlight.length === 0) {
    return undefined;
  }
  return inFlight.reduce((latest, candidate) => (candidate.updatedAtMs > latest.updatedAtMs ? candidate : latest));
}

// The whole per-message routing decision, now spanning both slices. A repo
// URL, or a reply while a checking-prerequisites target is active, is
// handled entirely by the existing pure handleOnboardingMessage, unchanged.
// Only when that comes back 'no-active-onboarding' (nothing checking-
// prerequisites is active, and the text was not a fresh repo URL either) do
// we look for a target this slice owns instead.
export async function routeOnboardingMessage(
  states: readonly OnboarderState[],
  text: string,
  now: () => number,
  adapters: ContractPhaseAdapters
): Promise<OnboardingMessageOutcome> {
  const base = handleOnboardingMessage(states, text, now);
  if (base.kind !== 'no-active-onboarding') {
    return base;
  }
  const active = pickActiveContractPhaseState(states);
  if (!active) {
    return base;
  }
  const action = decideContractPhaseAction(active, text);
  const turn = await runContractPhaseAction(active, action, adapters, now);
  return { kind: 'advanced', state: turn.state, message: turn.message };
}
