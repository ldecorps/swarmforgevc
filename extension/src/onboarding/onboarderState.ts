// BL-590 slice 1: the Onboarder's own prerequisites state
// machine. Pure, clock-injected, no I/O - persistence is
// onboarderStateStore.ts's job, Telegram/tmux wiring is the
// poll-loop's job (testable-module boundary, engineering.prompt). Slice 1
// covers needs-target -> checking-prerequisites -> prerequisites-ready only;
// survey and everything after is BL-624/BL-625's own state.

export const PREREQUISITE_STEP_IDS = ['toolchain', 'github-access', 'fork-clone', 'target-repo', 'bot-token'] as const;
export type PrerequisiteStepId = (typeof PREREQUISITE_STEP_IDS)[number];

export const PREREQUISITE_STEP_ORDER: readonly PrerequisiteStepId[] = PREREQUISITE_STEP_IDS;

// BL-624: the four phases past prerequisites-ready - survey through the
// agreed contract. There is no separate "surveying" phase: the clone,
// survey and propose steps all run synchronously within the single
// principal turn that posts "proceed" at prerequisites-ready (BL-624's own
// contractPhaseRelay.ts owns that turn), so the only phases ever actually
// persisted/observed are the ones below - a transient "surveying" value
// would never be read back and is not added here.
export type OnboardingPhase =
  | 'checking-prerequisites'
  | 'prerequisites-ready'
  | 'contract-proposed'
  | 'negotiating'
  | 'contract-agreed';

// BL-590 architect bounce #6/#7 (D3/D4): target identity is POLICY, not
// persistence, so it lives here and both the handler (findInFlightStateForTarget
// below) and the store (onboarderStateStore.ts's slugifyTargetRepoUrl) import
// this ONE definition instead of each carrying its own comparison - the two
// layers disagreeing on "the same target" is what destroyed verified
// prerequisites when a human re-pasted an alias URL (scheme/.git/trailing-slash
// variant) of a target already in flight. The strip order (trailing slash,
// then .git, then trailing slash again) is deliberate so `repo.git/` normalizes
// like `repo.git` (bounce #6 D4) rather than keeping a stray `.git` in the key.
export function normalizeTargetRepoUrl(targetRepoUrl: string): string {
  return targetRepoUrl
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
}

export function isSameTarget(a: string, b: string): boolean {
  return normalizeTargetRepoUrl(a) === normalizeTargetRepoUrl(b);
}

export interface OnboarderState {
  readonly targetRepoUrl: string;
  readonly phase: OnboardingPhase;
  readonly stepIndex: number;
  readonly verifiedSteps: readonly PrerequisiteStepId[];
  readonly paused: boolean;
  readonly updatedAtMs: number;
}

interface StepVerificationSpec {
  readonly requiredMarkers: readonly string[];
  readonly failureMarkers: readonly string[];
}

export interface PrerequisiteStepGuidance {
  readonly id: PrerequisiteStepId;
  readonly instruction: string;
  readonly verificationName: string;
  readonly verification: StepVerificationSpec;
}

// BL-590 description: checklist content mined from
// docs/how-to/BL-091-wsl2-second-swarm-bringup.md (toolchain check command)
// and BL-439's own "two pollers, one token" 409 warning (bot-token step) -
// not invented. Each guidance carries the EXACT command to paste and NAMES
// the verification the principal must paste back (scenario 06).
export const PREREQUISITE_STEPS: Readonly<Record<PrerequisiteStepId, PrerequisiteStepGuidance>> = {
  toolchain: {
    id: 'toolchain',
    instruction:
      'On the target host, run:\n' +
      '  git --version && node --version && tmux -V && bb --version && claude --version\n' +
      'Paste the full output here.',
    verificationName: 'toolchain version-check output',
    verification: {
      requiredMarkers: ['git version', 'tmux', 'babashka', 'claude'],
      failureMarkers: ['not found', 'command not found'],
    },
  },
  'github-access': {
    id: 'github-access',
    instruction:
      'On the target host, run:\n' +
      '  ssh -T git@github.com\n' +
      'Paste the full output here (a working key prints a "successfully authenticated" message).',
    verificationName: 'GitHub SSH access check output',
    verification: {
      requiredMarkers: ['successfully authenticated'],
      failureMarkers: ['permission denied', 'could not resolve hostname'],
    },
  },
  'fork-clone': {
    id: 'fork-clone',
    instruction:
      'On the target host, run:\n' +
      '  git clone git@github.com:unclebob/swarm-forge.git && cd swarm-forge && git rev-parse --short HEAD\n' +
      'Paste the full output here.',
    verificationName: 'swarmforge fork clone output',
    verification: {
      requiredMarkers: ['cloning into'],
      failureMarkers: ['fatal:', 'repository not found'],
    },
  },
  'target-repo': {
    id: 'target-repo',
    instruction:
      'On the target host, run:\n' +
      '  git clone <the target repo URL you gave me> && cd <the cloned directory> && git remote -v\n' +
      'Paste the full output here.',
    verificationName: 'target repo clone output',
    verification: {
      requiredMarkers: ['cloning into', 'origin'],
      failureMarkers: ['fatal:', 'repository not found'],
    },
  },
  'bot-token': {
    id: 'bot-token',
    instruction:
      'Create a NEW, DEDICATED Telegram bot for this target via @BotFather - do NOT reuse the ' +
      "primary swarm's bot token (two pollers sharing one token collide with a 409 Conflict, " +
      'see BL-622/BL-439). Paste the new bot username and confirmation that the token was saved here.',
    verificationName: 'dedicated bot token confirmation',
    verification: {
      requiredMarkers: ['new bot', 'token'],
      failureMarkers: ['reused the primary', "primary's token"],
    },
  },
};

export type PrerequisiteVerdict = { passed: true } | { passed: false; reason: string };

function containsMarker(haystack: string, marker: string): boolean {
  return haystack.toLowerCase().includes(marker.toLowerCase());
}

export function verifyPrerequisiteStep(stepId: PrerequisiteStepId, pastedOutput: string): PrerequisiteVerdict {
  const spec = PREREQUISITE_STEPS[stepId].verification;
  const lower = pastedOutput;
  const failedMarker = spec.failureMarkers.find((marker) => containsMarker(lower, marker));
  if (failedMarker) {
    return { passed: false, reason: `output contains "${failedMarker}"` };
  }
  const missingMarker = spec.requiredMarkers.find((marker) => !containsMarker(lower, marker));
  if (missingMarker) {
    return { passed: false, reason: `output is missing "${missingMarker}"` };
  }
  return { passed: true };
}

// A bare claim of completion ("done", "it's done", "yes") carries no
// evidence at all and must never advance a step (scenario 04) - narrow and
// whole-message-anchored so a real verification paste that happens to START
// with "done" (unlikely, but never trusted on a substring) is not swept in.
const BARE_DONE_PATTERN = /^\s*(it'?s\s+)?(done|finished|complete[d]?|ready|yes|ok|okay)[.!]?\s*$/i;

export function isBareDoneClaim(text: string): boolean {
  return BARE_DONE_PATTERN.test(text);
}

export type OnboardingControl = 'pause' | 'proceed';

const CONTROL_PATTERN: Readonly<Record<OnboardingControl, RegExp>> = {
  pause: /^\s*pause\s*$/i,
  proceed: /^\s*proceed\s*$/i,
};

export function classifyControl(text: string): OnboardingControl | null {
  if (CONTROL_PATTERN.pause.test(text)) {
    return 'pause';
  }
  if (CONTROL_PATTERN.proceed.test(text)) {
    return 'proceed';
  }
  return null;
}

// BL-624: guards on "still checking prerequisites" rather than the single
// old terminal value ('prerequisites-ready') - now that OnboardingPhase has
// phases PAST prerequisites-ready too, matching only the one old terminal
// string would fall through to indexing PREREQUISITE_STEP_ORDER with a
// stale stepIndex for those, which happens to read back undefined today but
// is not a guarantee this function's own contract should depend on.
export function currentPrerequisiteStep(state: OnboarderState): PrerequisiteStepId | null {
  if (state.phase !== 'checking-prerequisites') {
    return null;
  }
  return PREREQUISITE_STEP_ORDER[state.stepIndex] ?? null;
}

export function renderStepInstruction(stepId: PrerequisiteStepId): string {
  const spec = PREREQUISITE_STEPS[stepId];
  return `${spec.instruction}\n\nPaste the ${spec.verificationName} here when ready.`;
}

const PREREQUISITES_READY_MESSAGE =
  'All prerequisites verified - prerequisites are ready. Next comes the survey phase: I will survey your ' +
  'target repo and propose an onboarding contract.';

// BL-624: a target that has moved past prerequisites-ready (into one of
// the survey/negotiation/agreement phases) is BL-624's own contractPhaseRelay.ts's
// territory, not this module's - this function stays a short, honest
// pointer rather than duplicating contract-status rendering here (which
// would need to import contractPhaseRelay.ts and create a cycle, since
// that module imports OnboarderState/OnboardingPhase from here).
function renderPastPrerequisitesMessage(state: OnboarderState): string {
  return (
    `Onboarding ${state.targetRepoUrl} is past the prerequisites phase (current phase: "${state.phase}"). ` +
    'Post "show-me" to see the current proposed contract, "change-this <objection>" to revise it, or "proceed" to continue.'
  );
}

export function renderStatus(state: OnboarderState): string {
  if (state.phase !== 'checking-prerequisites' && state.phase !== 'prerequisites-ready') {
    return renderPastPrerequisitesMessage(state);
  }
  const step = currentPrerequisiteStep(state);
  if (!step) {
    return PREREQUISITES_READY_MESSAGE;
  }
  return `Onboarding ${state.targetRepoUrl}: prerequisites phase, step "${step}".\n\n${renderStepInstruction(step)}`;
}

export function createOnboardingState(targetRepoUrl: string, now: () => number): OnboarderState {
  return {
    targetRepoUrl,
    phase: 'checking-prerequisites',
    stepIndex: 0,
    verifiedSteps: [],
    paused: false,
    updatedAtMs: now(),
  };
}

export interface OnboarderTurn {
  readonly state: OnboarderState;
  readonly message: string;
}

// BL-590 new-onboarding-starts-at-prerequisites-02: a plain "http(s)://..."
// or "git@host:..." message in the Onboarding topic opens a fresh per-target
// onboarding - deliberately narrow (whole-message anchored, only the two
// real git remote URL shapes) so an ordinary sentence mentioning a URL never
// misfires into starting an onboarding.
const REPO_URL_PATTERN = /^\s*(https?:\/\/\S+|git@\S+:\S+)\s*$/i;

export function isLikelyRepoUrl(text: string): boolean {
  return REPO_URL_PATTERN.test(text);
}

// BL-590: the Onboarding topic is ONE topic reused across targets (the
// specifier's design note), so a plain reply (not a fresh repo URL) must be
// routed to whichever onboarding it belongs to. Slice 1 keeps this simple -
// concurrent-onboarding disambiguation by content is BL-625/slice 3's job -
// "the one still in flight, most recently touched" is enough for the single-
// onboarding-at-a-time flow slice 1's own QA procedure walks. A target that
// already reached prerequisites-ready is done with THIS topic's job (survey
// is BL-624's own topic turn), so it is never picked back up here.
// BL-624: narrowed from "not prerequisites-ready" to "still checking
// prerequisites" now that OnboardingPhase carries phases PAST
// prerequisites-ready too - those are BL-624's own contractPhaseRelay.ts's
// "in flight" (its own pickActiveContractPhaseState), never this
// function's. The old `!== 'prerequisites-ready'` filter would otherwise
// start matching every one of those new phases as if they were still this
// module's concern.
export function pickActiveOnboardingState(states: readonly OnboarderState[]): OnboarderState | undefined {
  const inFlight = states.filter((s) => s.phase === 'checking-prerequisites');
  if (inFlight.length === 0) {
    return undefined;
  }
  return inFlight.reduce((latest, candidate) => (candidate.updatedAtMs > latest.updatedAtMs ? candidate : latest));
}

const PAUSED_MESSAGE = 'Onboarding is paused. Post "proceed" to resume.';

function advanceStep(state: OnboarderState, stepId: PrerequisiteStepId, now: () => number): OnboarderState {
  const verifiedSteps = [...state.verifiedSteps, stepId];
  const nextIndex = state.stepIndex + 1;
  const phase: OnboardingPhase = nextIndex >= PREREQUISITE_STEP_ORDER.length ? 'prerequisites-ready' : 'checking-prerequisites';
  return { ...state, verifiedSteps, stepIndex: nextIndex, phase, updatedAtMs: now() };
}

function handlePausedState(state: OnboarderState, control: OnboardingControl | null, now: () => number): OnboarderTurn | null {
  if (!state.paused) {
    return null;
  }
  if (control === 'proceed') {
    const resumed = { ...state, paused: false, updatedAtMs: now() };
    return { state: resumed, message: renderStatus(resumed) };
  }
  return { state, message: PAUSED_MESSAGE };
}

function handleControlCommands(state: OnboarderState, control: OnboardingControl | null, now: () => number): OnboarderTurn | null {
  if (control === 'pause') {
    const paused = { ...state, paused: true, updatedAtMs: now() };
    return { state: paused, message: `Onboarding paused at the current step. ${PAUSED_MESSAGE}` };
  }
  if (control === 'proceed') {
    return { state, message: renderStatus(state) };
  }
  return null;
}

function handleVerificationInput(state: OnboarderState, step: PrerequisiteStepId, text: string, now: () => number): OnboarderTurn {
  if (isBareDoneClaim(text)) {
    return {
      state,
      message: `That's not a verification output, so this step is not recorded as verified yet.\n\n${renderStepInstruction(step)}`,
    };
  }
  const verdict = verifyPrerequisiteStep(step, text);
  if (!verdict.passed) {
    return {
      state,
      message: `The "${step}" verification failed: ${verdict.reason}.\n\n${renderStepInstruction(step)}`,
    };
  }
  const advanced = advanceStep(state, step, now);
  return { state: advanced, message: renderStatus(advanced) };
}

// The whole per-reply transition (scenarios 03/04/05/09/10). Pause/proceed
// are checked before verification so a control word is never misread as a
// (failing) verification paste.
export function applyPrincipalReply(state: OnboarderState, text: string, now: () => number): OnboarderTurn {
  const control = classifyControl(text);
  const pausedResult = handlePausedState(state, control, now);
  if (pausedResult) {
    return pausedResult;
  }
  const controlResult = handleControlCommands(state, control, now);
  if (controlResult) {
    return controlResult;
  }
  const step = currentPrerequisiteStep(state);
  if (!step) {
    return { state, message: renderStatus(state) };
  }
  return handleVerificationInput(state, step, text, now);
}

const NO_ACTIVE_ONBOARDING_MESSAGE =
  'No onboarding is currently in progress in this topic. Post a target GitHub repo URL to start one.';

export type OnboardingMessageOutcome =
  | { kind: 'started'; state: OnboarderState; message: string }
  | { kind: 'resumed'; state: OnboarderState; message: string }
  | { kind: 'advanced'; state: OnboarderState; message: string }
  | { kind: 'no-active-onboarding'; message: string };

// BL-590 architect bounce (defect 2, 2026-07-25): a repo URL for a target
// that already has an in-flight (non-prerequisites-ready) state must RESUME
// that state, never mint a fresh one - onboardingStatePath keys the durable
// file by a slug of the URL alone, so a fresh createOnboardingState for the
// same URL silently overwrites the same file and destroys verified
// progress. The human's reasons to re-paste the URL are ordinary (checking
// in, scrolling back, resuming after a pause), so this must be the default,
// not an opt-in.
// BL-624: unchanged by the new phases below, and deliberately so - a target
// that is exactly 'prerequisites-ready' still opens a fresh state on
// re-paste (BL-590's own tested "finished, never resumes a done flow"
// behavior), but every new phase this ticket adds (contract-proposed,
// negotiating, contract-agreed) is NOT the literal string
// 'prerequisites-ready', so `!== 'prerequisites-ready'` already matches
// them and resumes - exactly what BL-624 needs (never silently overwrite an
// in-flight negotiation or an already-agreed contract with a fresh state).
function findInFlightStateForTarget(
  existingStates: readonly OnboarderState[],
  targetRepoUrl: string
): OnboarderState | undefined {
  return existingStates.find((s) => isSameTarget(s.targetRepoUrl, targetRepoUrl) && s.phase !== 'prerequisites-ready');
}

// BL-590: the onboarder's whole per-message decision, given every
// currently-persisted target state plus the incoming text - the ONE function
// the real (untested-shell) wiring calls between "read every state" and
// "persist the result and send its message", so that shell never itself
// contains a branch on message content (testable-module boundary).
export function handleOnboardingMessage(
  existingStates: readonly OnboarderState[],
  text: string,
  now: () => number
): OnboardingMessageOutcome {
  if (isLikelyRepoUrl(text)) {
    const targetRepoUrl = text.trim();
    const inFlight = findInFlightStateForTarget(existingStates, targetRepoUrl);
    if (inFlight) {
      return { kind: 'resumed', state: inFlight, message: renderStatus(inFlight) };
    }
    const state = createOnboardingState(targetRepoUrl, now);
    return { kind: 'started', state, message: renderStatus(state) };
  }
  const active = pickActiveOnboardingState(existingStates);
  if (!active) {
    return { kind: 'no-active-onboarding', message: NO_ACTIVE_ONBOARDING_MESSAGE };
  }
  const turn = applyPrincipalReply(active, text, now);
  return { kind: 'advanced', state: turn.state, message: turn.message };
}
