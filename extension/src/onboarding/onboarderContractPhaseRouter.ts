// BL-624: composes onboarderState.ts's own pure, synchronous
// handleOnboardingMessage (still the sole owner of the URL-start/resume
// branch and the checking-prerequisites state machine) with
// contractPhaseRelay.ts's async decision+adapters orchestration for
// everything at or past prerequisites-ready. Neither side is rewritten -
// this file is only the seam between them, mirroring the constitution's own
// pipeline-boundary shape (each stage owns its slice, a thin router hands
// off between them).
import {
  applyPrincipalReply,
  handleOnboardingMessage,
  isLikelyRepoUrl,
  OnboarderState,
  OnboardingMessageOutcome,
  OnboardingPhase,
} from './onboarderState';
import { ContractPhaseAdapters, decideContractPhaseAction, runContractPhaseAction } from './contractPhaseRelay';

// Every phase contractPhaseRelay.ts owns: prerequisites-ready is the entry
// point (a "proceed" there starts the survey), contract-proposed and
// negotiating are open for show-me/change-this/proceed. BL-625 extends this
// past agreement: contract-agreed (proceed -> prompts), prompts-proposed
// (proceed -> launch handoff) and ready-to-launch (proceed -> done) are now
// in flight too - 'done' stays excluded (genuinely terminal: BL-625
// topic-reused-next-target-05's own "previous target's state stays done").
const IN_FLIGHT_CONTRACT_PHASES: readonly OnboardingPhase[] = [
  'prerequisites-ready',
  'contract-proposed',
  'negotiating',
  'contract-agreed',
  'prompts-proposed',
  'ready-to-launch',
];

// BL-625 invariant 2: every phase ANY router in this onboarder considers
// "waiting for a reply" - onboarderState.ts's own checking-prerequisites
// plus every phase above - so pickUnambiguousInFlightState below can see the
// WHOLE picture, not just this module's own slice of it.
const ALL_IN_FLIGHT_PHASES: readonly OnboardingPhase[] = ['checking-prerequisites', ...IN_FLIGHT_CONTRACT_PHASES];

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

const AMBIGUOUS_TARGET_MESSAGE_PREFIX = 'More than one onboarding is in flight and this reply does not name which target it concerns:';

// BL-625 invariant 2: "one target's answers never land in another target's
// state... an unattributable reply is refused rather than applied to
// whichever target was last active." A fresh repo URL is never ambiguous
// (isLikelyRepoUrl text names its own target by construction - findInFlight-
// StateForTarget/createOnboardingState resolve it exactly). For any other
// text: zero or one in-flight target is the existing, unambiguous case
// (every picker above already handles it); two or more in-flight targets
// requires the text to name exactly one of them by its own targetRepoUrl,
// or the reply is refused rather than defaulting to "most recently active".
export function pickUnambiguousInFlightState(
  states: readonly OnboarderState[],
  text: string
): { state: OnboarderState | undefined; ambiguousMessage?: string } {
  const inFlight = states.filter((s) => ALL_IN_FLIGHT_PHASES.includes(s.phase));
  if (inFlight.length <= 1) {
    return { state: undefined };
  }
  const named = inFlight.filter((s) => text.includes(s.targetRepoUrl));
  if (named.length === 1) {
    return { state: named[0] };
  }
  const urls = inFlight.map((s) => `- ${s.targetRepoUrl}`).join('\n');
  return { state: undefined, ambiguousMessage: `${AMBIGUOUS_TARGET_MESSAGE_PREFIX}\n${urls}` };
}

// A state pickUnambiguousInFlightState has already resolved to ONE specific
// target (by name, among 2+ in flight) - dispatched by phase directly,
// never re-derived via either "most recently touched" picker below (which
// would defeat the whole point of naming a non-latest target explicitly).
async function applyToInFlightState(
  state: OnboarderState,
  text: string,
  now: () => number,
  adapters: ContractPhaseAdapters
): Promise<OnboardingMessageOutcome> {
  if (state.phase === 'checking-prerequisites') {
    const turn = applyPrincipalReply(state, text, now);
    return { kind: 'advanced', state: turn.state, message: turn.message };
  }
  const action = decideContractPhaseAction(state, text);
  const turn = await runContractPhaseAction(state, action, adapters, now);
  return { kind: 'advanced', state: turn.state, message: turn.message };
}

// The whole per-message routing decision, now spanning both slices. A repo
// URL is never ambiguous (it names its own target) and always goes through
// the unchanged start/resume path. Any other text first checks for
// ambiguity across EVERY in-flight target (BL-625 invariant 2): a reply
// naming exactly one of 2+ in-flight targets is dispatched straight to it;
// naming none or more than one is refused. Only once that check clears (0
// or 1 target in flight - the pre-BL-625 shape) do the existing "most
// recently touched" pickers below ever run, unchanged.
export async function routeOnboardingMessage(
  states: readonly OnboarderState[],
  text: string,
  now: () => number,
  adapters: ContractPhaseAdapters
): Promise<OnboardingMessageOutcome> {
  if (!isLikelyRepoUrl(text)) {
    const { state: disambiguated, ambiguousMessage } = pickUnambiguousInFlightState(states, text);
    if (ambiguousMessage) {
      return { kind: 'ambiguous-target', message: ambiguousMessage };
    }
    if (disambiguated) {
      return applyToInFlightState(disambiguated, text, now, adapters);
    }
  }
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
