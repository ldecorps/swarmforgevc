// BL-423: pure decision logic for the guarded Telegram control topic that
// drives swarm stop (drain/emergency), restart, and timed-pause. This is
// the ONE pure host-side module the ticket calls for (mirrors
// operatorDecideStatus.ts's own pure-decision/adapter-injected-orchestration
// split): the verb/callback parse + guard (authorised? control-topic?
// confirm-pending?) + the confirm state machine + the pause state machine +
// the bounded-drain state machine, all decided here with no I/O at all -
// telegramFrontDeskBotCore.ts/telegram-front-desk-bot.ts wire the real
// Telegram/tmux/process effects around these decisions.

// ── pending confirm / pause state (persisted by the wiring, read here) ────

export type PendingControlConfirm = { kind: 'stop-modes' } | { kind: 'restart-confirm' } | undefined;

// untilMs undefined means "Until I resume" - no timer, stays frozen until
// an explicit resume-now. active:false is the normal (not paused) state.
export type PauseState = { active: true; untilMs: number | undefined } | { active: false };

// ── inbound event (already-resolved shape; the wiring extracts this from
//    a real TelegramUpdate) ───────────────────────────────────────────────

export type ControlEvent =
  | { kind: 'text'; text: string; fromId: string | number; topicId: number | undefined }
  | { kind: 'callback'; data: string; fromId: string | number; topicId: number | undefined };

// ── the closed decision set (ticket's own vocabulary, verbatim) ──────────

export type ControlDecision =
  | { action: 'ignore' }
  | { action: 'refuse' }
  | { action: 'prompt-stop-modes' }
  | { action: 'prompt-restart-confirm' }
  | { action: 'cancel' }
  | { action: 'execute-emergency-stop' }
  | { action: 'execute-drain-stop' }
  | { action: 'execute-restart' }
  | { action: 'post-pause-menu' }
  | { action: 'apply-pause'; durationMs: number | undefined }
  | { action: 'resume-now' }
  | { action: 'engage-ambulance'; ticket: string }
  | { action: 'release-ambulance' }
  | { action: 'execute-shared-operator'; verb: string; args?: string };

// The one callback_data namespace this ticket owns - deliberately its own
// prefix ("control:"), never sharing BL-410's approve/reject/amend pattern:
// the two verb spaces are semantically unrelated (ticket approvals vs.
// swarm control), and a shared regex/union would coincidentally couple
// their CRAP budgets and exhaustiveness switches for no reason.
const CONTROL_CALLBACK_PATTERN = /^control:(.+)$/;

export const CONTROL_CALLBACK_DATA = {
  cancel: 'control:cancel',
  emergencyStop: 'control:emergency-stop',
  drainStop: 'control:drain-stop',
  confirmRestart: 'control:confirm-restart',
  resumeNow: 'control:resume-now',
  pause15m: 'control:pause-15m',
  pause1h: 'control:pause-1h',
  pause4h: 'control:pause-4h',
  pauseUntilResume: 'control:pause-until-resume',
} as const;

const PAUSE_DURATIONS_MS: Record<string, number> = {
  'pause-15m': 15 * 60 * 1000,
  'pause-1h': 60 * 60 * 1000,
  'pause-4h': 4 * 60 * 60 * 1000,
};

// BL-655: bare "ambulance <BL-id>" / "ambulance off" - deliberately NOT
// slash-prefixed like /stop /restart /pause (the ticket's own vocabulary,
// verbatim, and the feature file's own scenarios type it bare). The ticket
// id is self-contained in the text, so - unlike pause/stop/restart - this
// never needs a confirm menu or button: the human's one message is the
// whole decision. BL-698 also accepts slash /ambulance as a Control alias.
const AMBULANCE_ENGAGE_PATTERN = /^(?:\/)?ambulance\s+(BL-\d+)$/i;
const HOLD_REINSTATE_PATTERN = /^\/(hold|reinstate)\s+(BL-\d+)$/i;

function decideControlTextAction(text: string): ControlDecision {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (lower === '/stop') {
    return { action: 'prompt-stop-modes' };
  }
  if (lower === '/restart') {
    return { action: 'prompt-restart-confirm' };
  }
  if (lower === '/pause') {
    return { action: 'post-pause-menu' };
  }
  if (lower === 'ambulance off' || lower === '/ambulance off') {
    return { action: 'release-ambulance' };
  }
  const ambulanceMatch = trimmed.match(AMBULANCE_ENGAGE_PATTERN);
  if (ambulanceMatch) {
    return { action: 'engage-ambulance', ticket: ambulanceMatch[1].toUpperCase() };
  }
  const holdMatch = trimmed.match(HOLD_REINSTATE_PATTERN);
  if (holdMatch) {
    return {
      action: 'execute-shared-operator',
      verb: `/${holdMatch[1].toLowerCase()}`,
      args: holdMatch[2].toUpperCase(),
    };
  }
  if (lower === '/kill-all') {
    return { action: 'execute-emergency-stop' };
  }
  if (lower === '/drain-agents' || lower === '/drain-swarm') {
    return { action: 'execute-shared-operator', verb: lower };
  }
  return { action: 'ignore' };
}

// Per-verb handlers, keyed by the callback's own verb suffix. Each handler
// decides against exactly the confirm/pause state it needs - a stop-mode
// pick with no pending stop-modes confirm (a stale/already-actioned tap), a
// restart confirm with no pending restart confirm, or a resume-now tap
// while not actually paused, all resolve to 'ignore' (a decision, never a
// crash) rather than executing on ambient state that no longer applies.
type ControlCallbackHandler = (pendingConfirm: PendingControlConfirm, pauseState: PauseState) => ControlDecision;

const CONTROL_CALLBACK_HANDLERS: Record<string, ControlCallbackHandler> = {
  cancel: () => ({ action: 'cancel' }),
  'emergency-stop': (pendingConfirm) =>
    pendingConfirm?.kind === 'stop-modes' ? { action: 'execute-emergency-stop' } : { action: 'ignore' },
  'drain-stop': (pendingConfirm) =>
    pendingConfirm?.kind === 'stop-modes' ? { action: 'execute-drain-stop' } : { action: 'ignore' },
  'confirm-restart': (pendingConfirm) =>
    pendingConfirm?.kind === 'restart-confirm' ? { action: 'execute-restart' } : { action: 'ignore' },
  'resume-now': (_pendingConfirm, pauseState) => (pauseState.active ? { action: 'resume-now' } : { action: 'ignore' }),
  'pause-until-resume': () => ({ action: 'apply-pause', durationMs: undefined }),
  'pause-15m': () => ({ action: 'apply-pause', durationMs: PAUSE_DURATIONS_MS['pause-15m'] }),
  'pause-1h': () => ({ action: 'apply-pause', durationMs: PAUSE_DURATIONS_MS['pause-1h'] }),
  'pause-4h': () => ({ action: 'apply-pause', durationMs: PAUSE_DURATIONS_MS['pause-4h'] }),
};

function decideControlCallbackAction(data: string, pendingConfirm: PendingControlConfirm, pauseState: PauseState): ControlDecision {
  const match = data.match(CONTROL_CALLBACK_PATTERN);
  if (!match) {
    return { action: 'ignore' };
  }
  const handler = CONTROL_CALLBACK_HANDLERS[match[1]];
  return handler ? handler(pendingConfirm, pauseState) : { action: 'ignore' };
}

// The whole guard + dispatch decision, per event. Guard order is load-
// bearing (mirrors decideSteeringAction's own "topic scope checked first"
// precedent): a message/tap in the WRONG topic (or before the control
// topic is even bound) is 'ignore' regardless of sender - it was never
// addressed to swarm control at all. Only once the topic matches does the
// PRINCIPAL guard apply, distinguishing an unauthorised sender/tap
// ('refuse' - a real attempted control action from the wrong party) from
// an ordinary off-topic message ('ignore' - just noise). This one guard
// pair covers BOTH a typed verb AND a button tap (guard #4: "a callback
// tap RE-APPLIES the principal + topic guards") - callers never need a
// second, separate re-guard step for taps.
export function decideControlEventAction(
  event: ControlEvent,
  principalUserId: string | number,
  controlTopicId: number | undefined,
  pendingConfirm: PendingControlConfirm,
  pauseState: PauseState
): ControlDecision {
  if (controlTopicId === undefined || event.topicId !== controlTopicId) {
    return { action: 'ignore' };
  }
  if (String(event.fromId) !== String(principalUserId)) {
    return { action: 'refuse' };
  }
  if (event.kind === 'callback') {
    return decideControlCallbackAction(event.data, pendingConfirm, pauseState);
  }
  return decideControlTextAction(event.text);
}

// ── pause auto-resume (tick-driven, injected clock - never part of the
//    per-event decision above, since its trigger is a periodic sweep, not
//    an inbound Telegram event) ───────────────────────────────────────────

export type PauseAutoResumeDecision = 'auto-resume' | 'none';

// "Until I resume" (untilMs undefined) never auto-resumes - only an
// explicit resume-now tap clears it. A timed pause auto-resumes once
// nowMs reaches its own untilMs, evaluated against an INJECTED clock
// (never the real system clock) so this is deterministic to test.
export function decidePauseAutoResume(pauseState: PauseState, nowMs: number): PauseAutoResumeDecision {
  // Hardener note: a mutant forcing `pauseState.untilMs === undefined` to
  // `false` here is an EQUIVALENT mutant, not a coverage gap. It only
  // changes behavior when active is true AND untilMs really is undefined -
  // exactly the case the guard exists to short-circuit. Forced past the
  // guard, the fallthrough evaluates `nowMs >= undefined`, which coerces to
  // `nowMs >= NaN` and is FALSE for every nowMs (JS comparison semantics),
  // landing on 'none' again by the fallthrough's own default branch - the
  // same result the guard returns directly. No input can ever tell the two
  // apart; no assertion should be forced to pretend otherwise.
  if (!pauseState.active || pauseState.untilMs === undefined) {
    return 'none';
  }
  return nowMs >= pauseState.untilMs ? 'auto-resume' : 'none';
}

// ── bounded drain wait (the drain-stop's own state machine) ──────────────

export type DrainOutcome = 'wait' | 'drained' | 'forced';

// Mirrors bounceDrain.ts's own decideDrainAction shape exactly (wait/bounce/
// timeout there -> wait/drained/forced here): pipelineEmpty (no parcel in
// any role's inbox/in_process) wins outright and reports 'drained'; short
// of that, the wait is bounded by timeoutMs from startedAtMs - past the
// bound, 'forced' (teardown proceeds anyway, reported as forced rather
// than drained); short of both, 'wait' (poll again).
export function decideDrainOutcome(pipelineEmpty: boolean, startedAtMs: number, nowMs: number, timeoutMs: number): DrainOutcome {
  if (pipelineEmpty) {
    return 'drained';
  }
  return nowMs - startedAtMs >= timeoutMs ? 'forced' : 'wait';
}
