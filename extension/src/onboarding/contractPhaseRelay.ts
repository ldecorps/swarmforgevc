// BL-624 (BL-590 slice 2): the survey-through-agreed-contract phases -
// prerequisites-ready -> contract-proposed -> negotiating -> contract-agreed.
// Mirrors negotiationTelegramRelay.ts's own split exactly: a pure decision
// (decideContractPhaseAction) over already-known state/text, sequenced
// against REAL work via injected adapters (runContractPhaseAction) - never a
// second negotiation engine (BL-381 invariant; negotiateObject/negotiateApprove
// below are adapter SEAMS around negotiate-onboarding-contract.ts's own
// runObject/runApprove, the ONE writer of negotiation state, not a
// reimplementation of them).
import { normalizeTargetRepoUrl, OnboarderState, OnboardingPhase } from './onboarderState';
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
  | { kind: 'propose-prompts' }
  | { kind: 'post-launch-handoff' }
  | { kind: 'confirm-launch' }
  | { kind: 'unrecognized' };

const PROCEED_PATTERN = /^\s*proceed\s*$/i;
const SHOW_ME_PATTERN = /^\s*show-me\s*$/i;
// BL-624 controls-this-slice-adds-to-the-topic-vocabulary: "change-this"
// carries the objection text itself (unlike pause/proceed/show-me, which
// are bare control words) - captures everything after the control word so
// the raw text rides through to negotiateObject unchanged, exactly like
// reviseContractFromObjection's own callers do for the negotiation topic.
const CHANGE_THIS_PATTERN = /^\s*change-this\s+([\s\S]+)$/i;

// The control vocabulary once a contract is on the table (contract-proposed
// or negotiating): show-me / proceed / change-this. Split out of
// decideContractPhaseAction below (behavior-preserving; hardener CRAP pass)
// so the phase dispatch and this phase's own control parsing are each
// independently simple, rather than one function's complexity being the
// sum of both.
function decideNegotiationPhaseAction(text: string): ContractPhaseAction {
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

// The onboarder's own turn: given the currently-active state's phase and
// the principal's raw text, decide WHAT to do - never how to do it (that is
// runContractPhaseAction's job below, via injected adapters). Phases this
// module does not own (checking-prerequisites) never reach here at all -
// onboarderContractPhaseRouter.ts only calls this once onboarderState.ts's
// own pickActiveOnboardingState has already come up empty.
// BL-625 (behavior-preserving; hardener CRAP pass): 'proceed' is the same
// universal forward-advance control used at every gated phase in this whole
// state machine (prerequisites-ready -> survey, contract-agreed -> prompts,
// prompts-proposed -> launch handoff, ready-to-launch -> confirm) rather
// than a slice-specific control word per phase - one table row per phase
// replaces one if+ternary each, so decideContractPhaseAction's own
// complexity does not grow with the number of such phases.
// BL-625 never-claims-remote-launch-03: ready-to-launch narrows to ONE
// recognized control ("proceed", confirming the human ran it) - every
// other text, question or not, falls to 'unrecognized' so the onboarder
// never has to parse "is it running"-style phrasing to know it cannot
// answer; renderUnrecognized's own ready-to-launch branch is the single
// place that "cannot observe" response is written.
const PROCEED_ADVANCE_ACTION: Partial<Record<OnboardingPhase, ContractPhaseAction>> = {
  'prerequisites-ready': { kind: 'start-survey' },
  'contract-agreed': { kind: 'propose-prompts' },
  'prompts-proposed': { kind: 'post-launch-handoff' },
  'ready-to-launch': { kind: 'confirm-launch' },
};

export function decideContractPhaseAction(state: OnboarderState, text: string): ContractPhaseAction {
  const advanceAction = PROCEED_ADVANCE_ACTION[state.phase];
  if (advanceAction) {
    return PROCEED_PATTERN.test(text) ? advanceAction : { kind: 'unrecognized' };
  }
  if (state.phase === 'contract-proposed' || state.phase === 'negotiating') {
    return decideNegotiationPhaseAction(text);
  }
  // 'gate-open', 'done' (and any other phase this module does not own) - terminal.
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

// BL-625: the prompts CLI's own withheld/committed shape (propose-onboarding-
// prompts.js via initializeTargetPrompts) - withheld:true means the
// build-start gate was not open when this ran (should not happen this late
// in the flow, since contract-agreed already proved it, but a regression is
// reported rather than assumed away) and nothing was written.
export interface ProposePromptsResult {
  committed: boolean;
  withheld: boolean;
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
  // BL-625: generates the target's project/engineering prompts via the
  // existing propose-onboarding-prompts.js building blocks and commits them
  // LOCALLY (never a push - runProposePrompts below reuses the SAME
  // commitAndPush adapter above for that, exactly as contract-agreed does).
  proposePrompts(targetRepoUrl: string): Promise<ProposePromptsResult>;
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

// BL-625: the pack every swarm this product launches runs under (see the
// mono-router overlay this whole constitution boots under) - a single named
// default, never a literal sprinkled per call site. There is no per-target
// pack negotiation in this slice's scope (out_of_scope: "Multi-swarm fleet
// wiring after launch").
const DEFAULT_LAUNCH_PACK = 'mono-router';

// BL-625: the directory a plain `git clone <targetRepoUrl>` produces by
// default - exactly what the "target-repo" prerequisite step already
// instructed the human to run (PREREQUISITE_STEPS['target-repo']:
// "git clone <the target repo URL you gave me> && cd <the cloned
// directory>"), so the launch command names the same directory the human
// already has. Derived from targetRepoUrl (persisted state), never a
// hardcoded literal - the ticket's own "not hardcoded" supporting gate.
function deriveTargetCloneDirName(targetRepoUrl: string): string {
  const normalized = normalizeTargetRepoUrl(targetRepoUrl);
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  return segments[segments.length - 1] || normalized;
}

function launchCommandFor(targetRepoUrl: string): string {
  return `./swarm ${deriveTargetCloneDirName(targetRepoUrl)} --pack ${DEFAULT_LAUNCH_PACK}`;
}

// BL-625 prompts-proposed-via-existing-cli-01: runs the existing prompts CLI
// (adapters.proposePrompts, a seam around propose-onboarding-prompts.js's
// own building blocks) then commits+pushes via the SAME commitAndPush
// adapter contract-agreed already uses - never a second push mechanism.
// A withheld proposal (gate not open - should not happen this late, but
// never assumed away), a failed push, or the proposal call itself throwing
// (e.g. the real adapter's persisted survey facts are missing or corrupt)
// leaves the phase exactly as it was, same "visible reason, retry
// instruction, no silent half-advance" shape as runStartSurvey above.
async function runProposePrompts(state: OnboarderState, adapters: ContractPhaseAdapters, now: () => number): Promise<ContractPhaseTurn> {
  let proposal: ProposePromptsResult;
  try {
    proposal = await adapters.proposePrompts(state.targetRepoUrl);
  } catch (err) {
    return { state, message: `Proposing prompts for ${state.targetRepoUrl} failed: ${errorMessage(err)}. ${RETRY_INSTRUCTION}` };
  }
  if (proposal.withheld) {
    return {
      state,
      message: `Prompts for ${state.targetRepoUrl} were withheld: the build-start gate is not open. ${RETRY_INSTRUCTION}`,
    };
  }
  const pushed = await adapters.commitAndPush(state.targetRepoUrl);
  if (!pushed.ok) {
    return {
      state,
      message: `The target prompts for ${state.targetRepoUrl} were committed locally, but pushing failed: ${pushed.error}. ${RETRY_INSTRUCTION}`,
    };
  }
  const advanced: OnboarderState = { ...state, phase: 'prompts-proposed', updatedAtMs: now() };
  return {
    state: advanced,
    message: `Proposed the project/engineering prompts for ${state.targetRepoUrl} via the existing prompts tool, committed and pushed (commit ${pushed.commitSha}).`,
  };
}

// BL-625 ready-to-launch-names-exact-command-02: the onboarder's own action
// once the (already-proven, back at contract-agreed) build-start gate is
// open and prompts are committed - pure, no adapters, mirroring
// proveGateAndPush's own "directly callable, independent of the decide/run
// dispatch" shape (BL-624 scenario 05's own precedent) so this can be
// exercised directly against a state at the conceptual 'gate-open' waypoint.
// Always advances to 'ready-to-launch' - unlike proveGateAndPush, there is
// no hold branch here, because reaching this function at all already means
// the gate was open (runContractPhaseAction only reaches it from
// 'prompts-proposed', reached only after runProposePrompts's own commit+push
// succeeded).
export function postLaunchHandoff(state: OnboarderState, now: () => number): ContractPhaseTurn {
  const advanced: OnboarderState = { ...state, phase: 'ready-to-launch', updatedAtMs: now() };
  const command = launchCommandFor(state.targetRepoUrl);
  return {
    state: advanced,
    message:
      `Ready to launch ${state.targetRepoUrl}. On the TARGET HOST, run:\n  ${command}\n` +
      'You run this - I cannot launch or observe the target host myself. Post "proceed" once it has launched.',
  };
}

// BL-625 done-closes-the-onboarding-04: the principal's confirmation that
// the human ran the command above - the ONLY thing that ever moves a target
// to 'done' (renderUnrecognized's own ready-to-launch branch, below, is the
// "cannot observe" refusal for every other text at this phase; BL-625
// never-claims-remote-launch-03).
function runConfirmLaunch(state: OnboarderState, now: () => number): ContractPhaseTurn {
  const done: OnboarderState = { ...state, phase: 'done', updatedAtMs: now() };
  return {
    state: done,
    message:
      `Onboarding for ${state.targetRepoUrl} is done: prerequisites verified, contract agreed, prompts committed ` +
      'and pushed, launch confirmed on the target host. This Onboarding topic is reused for the next target - ' +
      'post a new target repo URL to begin.',
  };
}

// BL-625 never-claims-remote-launch-03: fires for ANY text at ready-to-launch
// other than "proceed" (a question, a status check, anything) - narrow by
// construction (decideContractPhaseAction only ever routes here via
// 'unrecognized'), so the onboarder never has to parse "is it running"-style
// phrasing to answer it: it always restates the same disclaimer + command.
function renderCannotObserveLaunch(state: OnboarderState): string {
  return (
    `I cannot launch or observe the swarm on the target host for ${state.targetRepoUrl}. ` +
    `Run this on the target host:\n  ${launchCommandFor(state.targetRepoUrl)}\nPost "proceed" once it's launched.`
  );
}

const NEGOTIATION_PROMPT_MESSAGE =
  'Post "show-me" to see the current contract, "change-this <objection>" to revise it, or "proceed" to agree it.';

// Behavior-preserving; hardener CRAP pass: one phase -> one message, so a
// lookup table replaces one `if` each (mirrors PROCEED_ADVANCE_ACTION
// above).
const UNRECOGNIZED_MESSAGE_BY_PHASE: Partial<Record<OnboardingPhase, (state: OnboarderState) => string>> = {
  'prerequisites-ready': () => 'Post "proceed" to survey the target repo and propose an onboarding contract.',
  'contract-proposed': () => NEGOTIATION_PROMPT_MESSAGE,
  negotiating: () => NEGOTIATION_PROMPT_MESSAGE,
  'contract-agreed': (state) => `The contract for ${state.targetRepoUrl} is agreed. Post "proceed" to generate and commit the target's prompts.`,
  'prompts-proposed': (state) => `Prompts for ${state.targetRepoUrl} are committed. Post "proceed" for the launch handoff.`,
  'ready-to-launch': renderCannotObserveLaunch,
};

function renderUnrecognized(state: OnboarderState): string {
  const render = UNRECOGNIZED_MESSAGE_BY_PHASE[state.phase];
  return render
    ? render(state)
    : `Onboarding ${state.targetRepoUrl} has already reached "${state.phase}"; there is nothing further to do here.`;
}

type ContractPhaseActionHandler = (
  state: OnboarderState,
  adapters: ContractPhaseAdapters,
  now: () => number
) => Promise<ContractPhaseTurn>;

// Behavior-preserving; hardener CRAP pass: every action.kind but
// 'negotiate-object' (the one variant carrying its own payload) dispatches
// to a handler needing nothing but state/adapters/now, so a lookup table
// replaces one switch `case` each - this table growing with a future action
// kind costs one row, never one more branch in runContractPhaseAction's own
// complexity.
const ACTION_HANDLERS: Partial<Record<ContractPhaseAction['kind'], ContractPhaseActionHandler>> = {
  'start-survey': runStartSurvey,
  'show-current-contract': runShowCurrentContract,
  'negotiate-approve': runNegotiateApprove,
  'propose-prompts': runProposePrompts,
  'post-launch-handoff': (state, _adapters, now) => Promise.resolve(postLaunchHandoff(state, now)),
  'confirm-launch': (state, _adapters, now) => Promise.resolve(runConfirmLaunch(state, now)),
};

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
  if (action.kind === 'negotiate-object') {
    return runNegotiateObject(state, action.objection, adapters, now);
  }
  const handler = ACTION_HANDLERS[action.kind];
  return handler ? handler(state, adapters, now) : { state, message: renderUnrecognized(state) };
}
