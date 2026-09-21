// BL-658: pure live advance for the night closing ceremony state machine.
// handoffd shells the impure runner each sweep; this module decides the next
// phase and actions with no I/O.

export type LivePhase = 'idle' | 'frozen' | 'briefing' | 'done';

export type LiveState = {
  nightKey: string;
  phase: LivePhase;
  sequence: string[];
  startedAtMs: number;
  drainDeadlineMs: number;
  hardDeadlineMs: number;
  rotationRequested: boolean;
  loudSurfaces: string[];
  parked: boolean;
  briefingInstructed: boolean;
  hadInFlight: boolean;
};

export type LiveAction =
  | { kind: 'freeze'; untilMs: number }
  | { kind: 'surface'; code: string }
  | { kind: 'record-cnp'; heldParcelIds: string[] }
  | { kind: 'rotate-documenter' }
  | { kind: 'instruct-briefing'; dayKey: string }
  // BL-1393: the BL-820 lean pass, folded in as a STEP of this one sequence
  // rather than a second mechanism beside it. It runs after the drain (the
  // ledger it folds must be complete) and before the briefing is instructed
  // (the specifier reads the packet while the documenter writes the day).
  | { kind: 'lean-packet'; shiftKey: string }
  // BL-1393: a sleep after no shift of work still ends in a RECORDED outcome -
  // "a silent ceremony is a failed ceremony" (BL-820 carried) - but sends no
  // briefing and delivers no packet.
  | { kind: 'record-empty-outcome'; shiftKey: string }
  // BL-1641: at the briefing hard deadline with nothing sent, give the
  // executor a chance to land the documenter's own commit for the day or,
  // failing that, compose the banked headless briefing - never touching a
  // briefing main already has. Emitted before 'surface'/'night-stop' below.
  | { kind: 'ensure-briefing'; dayKey: string }
  | { kind: 'night-stop' };

export type LiveObservation = {
  nowMs: number;
  nightKey: string;
  dayKey: string;
  ceremonyDue: boolean;
  drainBudgetMs: number;
  hardDeadlineMs: number;
  inFlightCount: number;
  activeRole: string | null;
  heldParcelIds: string[];
  briefingAlreadySent: boolean;
  /**
   * BL-1393: did the swarm actually work a shift since the last ceremony? The
   * human's directive is "each time the swarm does at least 1 shift and goes
   * to sleep", so a sleep after no work is explicit and quiet rather than a
   * full ceremony. Optional, defaulting to TRUE: every pre-BL-1393 caller
   * meant "a night that is due", and a missing field must never silence a
   * real ceremony.
   */
  workedAShift?: boolean;
  /**
   * BL-1640: was this advance triggered by a sleep (finish-shift, a bedtime
   * cron, night-stop) rather than the daemon's own periodic sweep? A
   * same-night `done` state only reopens into a new ceremony on a sleep
   * trigger with a worked shift since - the daemon's own sweep must never
   * reopen a night it already closed (its overnight window is untouched).
   * Optional, defaulting to false: every pre-BL-1640 caller is the daemon.
   */
  fromSleep?: boolean;
};

export type LiveAdvance = { state: LiveState; actions: LiveAction[] };

function pushUnique(seq: string[], step: string): void {
  if (seq[seq.length - 1] !== step) {
    seq.push(step);
  }
}

function idleState(nightKey: string): LiveState {
  return {
    nightKey,
    phase: 'idle',
    sequence: [],
    startedAtMs: 0,
    drainDeadlineMs: 0,
    hardDeadlineMs: 0,
    rotationRequested: false,
    loudSurfaces: [],
    parked: false,
    briefingInstructed: false,
    hadInFlight: false,
  };
}

// BL-1393 cleaner pass: the two "ceremony ends here, already done" exits
// below (no shift worked; already briefed) built the identical `done`-phase
// state shape and differed only in sequence/actions - factored out so the
// shape is written once.
function doneAdvance(obs: LiveObservation, sequence: string[], actions: LiveAction[]): LiveAdvance {
  return {
    state: {
      ...idleState(obs.nightKey),
      phase: 'done',
      sequence,
      startedAtMs: obs.nowMs,
      drainDeadlineMs: obs.nowMs,
      hardDeadlineMs: obs.hardDeadlineMs,
    },
    actions,
  };
}

function startFrozen(obs: LiveObservation): LiveAdvance {
  const actions: LiveAction[] = [
    { kind: 'freeze', untilMs: obs.hardDeadlineMs },
  ];
  const sequence = ['freeze-promotion'];
  if (obs.heldParcelIds.length > 0) {
    actions.push({ kind: 'record-cnp', heldParcelIds: [...obs.heldParcelIds] });
  }

  // BL-1393: a sleep after no shift of work. Promotion is still frozen and the
  // swarm still stops - it IS going to sleep - but there is nothing to brief
  // on and no ledger to fold, so the ceremony says so in one recorded outcome
  // instead of waking the documenter for an empty day.
  if (obs.workedAShift === false) {
    sequence.push('no-shift-since-last-ceremony', 'empty-outcome-recorded', 'swarm-stopped');
    actions.push({ kind: 'record-empty-outcome', shiftKey: obs.dayKey });
    actions.push({ kind: 'night-stop' });
    return doneAdvance(obs, sequence, actions);
  }
  if (obs.briefingAlreadySent) {
    // BL-1393: the day is already briefed, so there is no second briefing to
    // instruct - but the shift still HAPPENED, and "every ceremony ends in a
    // recorded outcome" (BL-820 carried) binds this path too. Before this the
    // short-circuit ended the ceremony with nothing recorded at all: no
    // packet, no outcome, indistinguishable from a ceremony that never ran.
    // Found by the invariant-3 property test.
    sequence.push('lean-packet', 'briefing-already-sent', 'swarm-stopped');
    actions.push({ kind: 'lean-packet', shiftKey: obs.dayKey });
    actions.push({ kind: 'night-stop' });
    return doneAdvance(obs, sequence, actions);
  }
  return {
    state: {
      nightKey: obs.nightKey,
      phase: 'frozen',
      sequence,
      startedAtMs: obs.nowMs,
      drainDeadlineMs: obs.nowMs + obs.drainBudgetMs,
      hardDeadlineMs: obs.hardDeadlineMs,
      rotationRequested: false,
      loudSurfaces: [],
      parked: false,
      briefingInstructed: false,
      hadInFlight: obs.inFlightCount > 0,
    },
    actions,
  };
}

function enterBriefing(state: LiveState, obs: LiveObservation): LiveAdvance {
  const sequence = [...state.sequence];
  const actions: LiveAction[] = [];
  const loudSurfaces = [...state.loudSurfaces];
  let parked = state.parked;
  let hadInFlight = state.hadInFlight || obs.inFlightCount > 0;

  if (obs.inFlightCount > 0) {
    pushUnique(sequence, 'parcel-parked');
    parked = true;
    loudSurfaces.push('closing-drain-deadline-exceeded');
    actions.push({ kind: 'surface', code: 'closing-drain-deadline-exceeded' });
  } else if (hadInFlight) {
    pushUnique(sequence, 'parcel-drained');
  }

  // BL-1393: the lean pass, here and nowhere else - after the drain, so the
  // ledger it folds is complete, and before the briefing, so the specifier has
  // the packet while the documenter writes the day.
  pushUnique(sequence, 'lean-packet');
  actions.push({ kind: 'lean-packet', shiftKey: obs.dayKey });

  const happyDays = !parked && obs.activeRole === 'documenter';
  let rotationRequested = state.rotationRequested;
  if (!happyDays) {
    pushUnique(sequence, 'rotate-documenter');
    rotationRequested = true;
    actions.push({ kind: 'rotate-documenter' });
  }

  actions.push({ kind: 'instruct-briefing', dayKey: obs.dayKey });
  const next: LiveState = {
    ...state,
    phase: 'briefing',
    sequence,
    loudSurfaces,
    parked,
    hadInFlight,
    rotationRequested,
    briefingInstructed: true,
  };
  return { state: next, actions };
}

function advanceBriefing(state: LiveState, obs: LiveObservation): LiveAdvance {
  const sequence = [...state.sequence];
  const actions: LiveAction[] = [];
  const loudSurfaces = [...state.loudSurfaces];

  if (obs.briefingAlreadySent) {
    pushUnique(sequence, 'briefing-committed');
    pushUnique(sequence, 'send-confirmed');
    pushUnique(sequence, 'swarm-stopped');
    actions.push({ kind: 'night-stop' });
    return {
      state: { ...state, phase: 'done', sequence, loudSurfaces },
      actions,
    };
  }

  if (obs.nowMs >= state.hardDeadlineMs) {
    pushUnique(sequence, 'briefing-missing');
    loudSurfaces.push('closing-briefing-missing');
    // BL-1641: before the surface and the stop, give the deps a chance to
    // land the documenter's own commit for today (byte-identical) or, when
    // nothing exists to land, compose the banked headless briefing - never
    // touching a briefing main already has. The pure machine only DECIDES
    // that this chance is due; which (if either) actually happened is
    // unknown until the executor runs it, so no forced-step name is added
    // to `sequence` here (see withForcedBriefingStep in the run CLI).
    actions.push({ kind: 'ensure-briefing', dayKey: obs.dayKey });
    actions.push({ kind: 'surface', code: 'closing-briefing-missing' });
    pushUnique(sequence, 'swarm-stopped');
    actions.push({ kind: 'night-stop' });
    return {
      state: { ...state, phase: 'done', sequence, loudSurfaces },
      actions,
    };
  }

  if (!state.briefingInstructed) {
    actions.push({ kind: 'instruct-briefing', dayKey: obs.dayKey });
    return {
      state: { ...state, briefingInstructed: true },
      actions,
    };
  }

  return { state, actions: [] };
}

function advanceFrozen(state: LiveState, obs: LiveObservation): LiveAdvance {
  const drainReady = obs.inFlightCount === 0 || obs.nowMs >= state.drainDeadlineMs;
  if (!drainReady) {
    const hadInFlight = state.hadInFlight || obs.inFlightCount > 0;
    return { state: { ...state, hadInFlight }, actions: [] };
  }
  return enterBriefing({ ...state, hadInFlight: state.hadInFlight || obs.inFlightCount > 0 }, obs);
}

// BL-1640: a second sleep the same day after a shift of work is a NEW
// ceremony, not the old one re-read - the human directive was "each time
// the swarm ... goes to sleep", not "once per calendar day". Extracted so
// `advanceNightClosingCeremony`'s own complexity does not carry this
// branch's decision points (differential complexity gate, workflow.prompt).
function advanceSameDayDone(prev: LiveState, obs: LiveObservation): LiveAdvance {
  if (obs.fromSleep && obs.workedAShift !== false) {
    return startFrozen(obs);
  }
  return { state: prev, actions: [] };
}

/**
 * Advance one sweep. Idempotent for a finished night; starts only when due.
 */
export function advanceNightClosingCeremony(
  prev: LiveState | null,
  obs: LiveObservation
): LiveAdvance {
  const sameNight = prev !== null && prev.nightKey === obs.nightKey;
  if (sameNight && prev.phase === 'done') {
    return advanceSameDayDone(prev, obs);
  }

  if (!sameNight || prev === null || prev.phase === 'idle') {
    if (!obs.ceremonyDue) {
      return { state: prev ?? idleState(obs.nightKey), actions: [] };
    }
    return startFrozen(obs);
  }

  if (prev.phase === 'frozen') {
    return advanceFrozen(prev, obs);
  }
  if (prev.phase === 'briefing') {
    return advanceBriefing(prev, obs);
  }
  return { state: prev, actions: [] };
}

export function briefingInstruction(dayKey: string): string {
  return `produce the morning briefing for ${dayKey}`;
}

// BL-1640: bedtime never hangs. `hardDeadlineMs` already folds in the drain
// and briefing budgets (see night-closing-ceremony-run.ts); this fixed grace
// is the extra margin a sleep's polling loop gets past that deadline before
// it gives up and stops the stack anyway. Not conf-configurable (constraint:
// no new conf key) - a fixed safety margin on top of two budgets that
// already are.
export const SLEEP_CEILING_GRACE_MS = 60_000;

export type SleepLoopDecision = 'wait' | 'done' | 'overran';

/**
 * The one decision a sleep's polling loop needs each tick: keep waiting for
 * the ceremony to reach `done`, or stop - either because it got there, or
 * because the ceiling (hardDeadlineMs + grace) has passed and the loop must
 * give up rather than hang bedtime forever. `phase` is `undefined` when the
 * loop's very first read fails (e.g. no state file yet); that reads as "not
 * done" so the ceiling still binds instead of waiting forever on a read
 * failure.
 */
// BL-1641: the pure machine decides an 'ensure-briefing' chance is due but
// cannot know its outcome; the executor runs it and folds the resulting
// forced-step name back into the written state's sequence, right before
// 'swarm-stopped' (matching the acceptance's "before swarm-stopped"
// wording), the same post-action fold shape BL-1528's loud-code folding
// already established for this file.
export function withForcedBriefingStep(state: LiveState, forcedStep: string | null): LiveState {
  if (!forcedStep) {
    return state;
  }
  const sequence = [...state.sequence];
  const stopIndex = sequence.lastIndexOf('swarm-stopped');
  if (stopIndex === -1) {
    sequence.push(forcedStep);
  } else {
    sequence.splice(stopIndex, 0, forcedStep);
  }
  return { ...state, sequence };
}

export function sleepLoopDecision(
  phase: LivePhase | undefined,
  nowMs: number,
  hardDeadlineMs: number
): SleepLoopDecision {
  if (phase === 'done') {
    return 'done';
  }
  if (nowMs >= hardDeadlineMs + SLEEP_CEILING_GRACE_MS) {
    return 'overran';
  }
  return 'wait';
}
