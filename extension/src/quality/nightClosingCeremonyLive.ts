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

function startFrozen(obs: LiveObservation): LiveAdvance {
  const actions: LiveAction[] = [
    { kind: 'freeze', untilMs: obs.hardDeadlineMs },
  ];
  const sequence = ['freeze-promotion'];
  if (obs.heldParcelIds.length > 0) {
    actions.push({ kind: 'record-cnp', heldParcelIds: [...obs.heldParcelIds] });
  }
  if (obs.briefingAlreadySent) {
    sequence.push('briefing-already-sent', 'swarm-stopped');
    actions.push({ kind: 'night-stop' });
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

/**
 * Advance one sweep. Idempotent for a finished night; starts only when due.
 */
export function advanceNightClosingCeremony(
  prev: LiveState | null,
  obs: LiveObservation
): LiveAdvance {
  const sameNight = prev !== null && prev.nightKey === obs.nightKey;
  if (sameNight && prev.phase === 'done') {
    return { state: prev, actions: [] };
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
