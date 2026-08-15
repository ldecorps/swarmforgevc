// BL-624 (BL-590 slice 2): the survey-through-agreed-contract phases -
// prerequisites-ready -> contract-proposed -> negotiating -> contract-agreed.
// Mirrors negotiationTelegramRelay.ts's own split exactly: a pure decision
// (decideContractPhaseAction) over already-known state/text, sequenced
// against REAL work via injected adapters (runContractPhaseAction) - never a
// second negotiation engine (BL-381 invariant; negotiateObject/negotiateApprove
// below are adapter SEAMS around negotiate-onboarding-contract.ts's own
// runObject/runApprove, the ONE writer of negotiation state, not a
// reimplementation of them).
import { OnboarderState } from './onboarderState';
import { GateDecision, ProposedContract, RepoSurveyFacts } from './contractTypes';
import {
  ApproveContractResult,
  CONTRACT_AGREED_MESSAGE,
  COULD_NOT_DERIVE_CHANGE_MESSAGE,
  ObjectToContractResult,
  ROUND_LIMIT_MESSAGE,
} from './negotiationTelegramRelay';
import { generateContractMarkdown } from './contractView';

// ── Pure decision: which control applies at which phase ────────────────────

export type ContractPhaseAction =
  | { kind: 'start-survey' }
  | { kind: 'show-current-contract' }
  | { kind: 'negotiate-object'; objection: string }
  | { kind: 'negotiate-approve' }
  | { kind: 'unrecognized' };

const PROCEED_PATTERN = /^\s*proceed\s*$/i;
const SHOW_ME_PATTERN = /^\s*show-me\s*$/i;
// BL-624 controls-this-slice-adds-to-the-topic-vocabulary: "change-this"
// carries the objection text itself (unlike pause/proceed/show-me, which
// are bare control words) - captures everything after the control word so
// the raw text rides through to negotiateObject unchanged, exactly like
// reviseContractFromObjection's own callers do for the negotiation topic.
const CHANGE_THIS_PATTERN = /^\s*change-this\s+([\s\S]+)$/i;

// The onboarder's own turn: given the currently-active state's phase and
// the principal's raw text, decide WHAT to do - never how to do it (that is
// runContractPhaseAction's job below, via injected adapters). Phases this
// module does not own (checking-prerequisites) never reach here at all -
// onboarderContractPhaseRouter.ts only calls this once onboarderState.ts's
// own pickActiveOnboardingState has already come up empty.
export function decideContractPhaseAction(state: OnboarderState, text: string): ContractPhaseAction {
  if (state.phase === 'prerequisites-ready') {
    return PROCEED_PATTERN.test(text) ? { kind: 'start-survey' } : { kind: 'unrecognized' };
  }
  if (state.phase === 'contract-proposed' || state.phase === 'negotiating') {
    if (SHOW_ME_PATTERN.test(text)) {
      return { kind: 'show-current-contract' };
    }
    if (PROCEED_PATTERN.test(text)) {
      return { kind: 'negotiate-approve' };
    }
    const changeMatch = CHANGE_THIS_PATTERN.exec(text);
    if (changeMatch) {
      return { kind: 'negotiate-object', objection: changeMatch[1].trim() };
    }
    return { kind: 'unrecognized' };
  }
  // 'contract-agreed' (and any other phase this module does not own) -
  // terminal for this slice; BL-625 owns whatever comes after agreement.
  return { kind: 'unrecognized' };
}

// ── Adapters: every real side effect this phase needs, injected ────────────

export interface CloneResult {
  ok: boolean;
  error?: string;
}

export interface CommitAndPushResult {
  ok: boolean;
  commitSha?: string;
  error?: string;
}

// Every method is keyed by targetRepoUrl, not a local path - the REAL
// adapter implementation derives the deterministic clone directory from the
// url itself (mirrors onboarderStateStore.ts's own slugifyTargetRepoUrl
// convention), so this orchestrator never needs to know or thread a
// filesystem path, and a fake adapter in tests can track calls by url alone.
export interface ContractPhaseAdapters {
  cloneTarget(targetRepoUrl: string): Promise<CloneResult>;
  surveyRepo(targetRepoUrl: string): Promise<RepoSurveyFacts>;
  proposeContract(targetRepoUrl: string, facts: RepoSurveyFacts): Promise<ProposedContract>;
  readCurrentContract(targetRepoUrl: string): Promise<ProposedContract | undefined>;
  negotiateObject(targetRepoUrl: string, objection: string): Promise<ObjectToContractResult>;
  negotiateApprove(targetRepoUrl: string): Promise<ApproveContractResult>;
  checkGate(targetRepoUrl: string): Promise<GateDecision>;
  commitAndPush(targetRepoUrl: string): Promise<CommitAndPushResult>;
}

export interface ContractPhaseTurn {
  state: OnboarderState;
  message: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function renderContract(heading: string, contract: ProposedContract): string {
  return `${heading}:\n\n${generateContractMarkdown(contract)}`;
}

const RETRY_INSTRUCTION = 'Fix the issue and post "proceed" to retry.';

// BL-624 survey-runs-on-own-clone-01 / clone-failure-is-a-visible-hold-07:
// clone, survey and propose all happen inside this ONE principal turn -
// success advances all the way to 'contract-proposed' with the proposed
// contract posted; ANY failure along the way leaves the state exactly as it
// was ('prerequisites-ready') with a visible reason and a retry
// instruction, never a silent stall and never a half-advanced phase.
async function runStartSurvey(state: OnboarderState, adapters: ContractPhaseAdapters, now: () => number): Promise<ContractPhaseTurn> {
  const clone = await adapters.cloneTarget(state.targetRepoUrl);
  if (!clone.ok) {
    return { state, message: `Could not clone ${state.targetRepoUrl}: ${clone.error}. ${RETRY_INSTRUCTION}` };
  }
  let facts: RepoSurveyFacts;
  try {
    facts = await adapters.surveyRepo(state.targetRepoUrl);
  } catch (err) {
    return { state, message: `Surveying ${state.targetRepoUrl} failed: ${errorMessage(err)}. ${RETRY_INSTRUCTION}` };
  }
  let contract: ProposedContract;
  try {
    contract = await adapters.proposeContract(state.targetRepoUrl, facts);
  } catch (err) {
    return { state, message: `Proposing an onboarding contract for ${state.targetRepoUrl} failed: ${errorMessage(err)}. ${RETRY_INSTRUCTION}` };
  }
  const advanced: OnboarderState = { ...state, phase: 'contract-proposed', updatedAtMs: now() };
  return { state: advanced, message: renderContract('Proposed onboarding contract', contract) };
}

// BL-624 show-me-inspection-02: never changes state, no matter what phase
// (contract-proposed or negotiating) the onboarding is in.
async function runShowCurrentContract(state: OnboarderState, adapters: ContractPhaseAdapters): Promise<ContractPhaseTurn> {
  const contract = await adapters.readCurrentContract(state.targetRepoUrl);
  if (!contract) {
    return { state, message: `No proposed contract was found for ${state.targetRepoUrl}.` };
  }
  return { state, message: renderContract('Current proposed contract', contract) };
}

// BL-624 change-this-runs-a-real-object-round-03: routes to the SAME
// runObject the negotiation topic itself uses (adapters.negotiateObject).
// A "not-derived" outcome (BL-442's own "could not interpret the text"
// signal) never advances the phase - the contract is unchanged, so there is
// nothing new to show, only a rephrase prompt.
async function runNegotiateObject(
  state: OnboarderState,
  objection: string,
  adapters: ContractPhaseAdapters,
  now: () => number
): Promise<ContractPhaseTurn> {
  const result = await adapters.negotiateObject(state.targetRepoUrl, objection);
  if (result.outcome === 'already-ended') {
    return { state, message: CONTRACT_AGREED_MESSAGE };
  }
  if (result.outcome === 'round-limit') {
    return { state, message: ROUND_LIMIT_MESSAGE };
  }
  if (result.outcome === 'not-derived') {
    return { state, message: COULD_NOT_DERIVE_CHANGE_MESSAGE };
  }
  const advanced: OnboarderState = { ...state, phase: 'negotiating', updatedAtMs: now() };
  return { state: advanced, message: renderContract('Revised onboarding contract', result.contract) };
}

// BL-624 gate-is-the-existing-gate-05 / agreed-contract-committed-back-06:
// the real build-start gate (adapters.checkGate literally shells to
// onboarding-contract-gate.js, per the ticket's own wording) then - ONLY if
// the gate allows - commit+push (adapters.commitAndPush). Invariant 2
// ("nothing is pushed before the human has agreed") holds structurally:
// commitAndPush is called from nowhere else in this file. Split out of
// runNegotiateApprove so a state that is ALREADY 'contract-agreed' (both
// scenarios' own Given) can drive exactly this - the gate proof and,
// only on 'allow', the commit+push - without going back through
// negotiateApprove again.
export async function proveGateAndPush(state: OnboarderState, adapters: ContractPhaseAdapters): Promise<ContractPhaseTurn> {
  const gate = await adapters.checkGate(state.targetRepoUrl);
  if (gate.decision === 'hold') {
    return {
      state,
      message: `The contract is agreed, but the build-start gate is still holding: ${gate.reason}. ${RETRY_INSTRUCTION}`,
    };
  }

  const pushed = await adapters.commitAndPush(state.targetRepoUrl);
  if (!pushed.ok) {
    return {
      state,
      message: `The contract is agreed and the build-start gate is open, but pushing it to ${state.targetRepoUrl} failed: ${pushed.error}. ${RETRY_INSTRUCTION}`,
    };
  }
  return {
    state,
    message: `The contract is agreed. The build-start gate is open. The agreed contract was committed and pushed to ${state.targetRepoUrl} (commit ${pushed.commitSha}).`,
  };
}

// BL-624 proceed-agrees-via-existing-approve-04: routes to the SAME
// runApprove the negotiation topic uses (adapters.negotiateApprove), then
// immediately cascades into proveGateAndPush above.
async function runNegotiateApprove(state: OnboarderState, adapters: ContractPhaseAdapters, now: () => number): Promise<ContractPhaseTurn> {
  const result = await adapters.negotiateApprove(state.targetRepoUrl);
  if (result.outcome === 'already-ended') {
    return { state, message: CONTRACT_AGREED_MESSAGE };
  }
  const agreed: OnboarderState = { ...state, phase: 'contract-agreed', updatedAtMs: now() };
  return proveGateAndPush(agreed, adapters);
}

function renderUnrecognized(state: OnboarderState): string {
  if (state.phase === 'prerequisites-ready') {
    return 'Post "proceed" to survey the target repo and propose an onboarding contract.';
  }
  if (state.phase === 'contract-proposed' || state.phase === 'negotiating') {
    return 'Post "show-me" to see the current contract, "change-this <objection>" to revise it, or "proceed" to agree it.';
  }
  return `Onboarding ${state.targetRepoUrl} has already reached "${state.phase}"; there is nothing further to do here.`;
}

// The whole per-message decision for a state already known to be at or past
// prerequisites-ready (onboarderContractPhaseRouter.ts's job to route
// here). Mirrors handleOnboardingMessage's own "one pure decision, then act
// on it" shape, except the "act on it" step here is genuinely async (real
// clone/survey/negotiate/gate/push I/O via adapters), which is exactly why
// this phase could never live inside onboarderState.ts's own synchronous
// handleOnboardingMessage.
export async function runContractPhaseAction(
  state: OnboarderState,
  action: ContractPhaseAction,
  adapters: ContractPhaseAdapters,
  now: () => number
): Promise<ContractPhaseTurn> {
  switch (action.kind) {
    case 'start-survey':
      return runStartSurvey(state, adapters, now);
    case 'show-current-contract':
      return runShowCurrentContract(state, adapters);
    case 'negotiate-object':
      return runNegotiateObject(state, action.objection, adapters, now);
    case 'negotiate-approve':
      return runNegotiateApprove(state, adapters, now);
    case 'unrecognized':
    default:
      return { state, message: renderUnrecognized(state) };
  }
}
