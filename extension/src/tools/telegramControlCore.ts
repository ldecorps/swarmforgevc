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
  | { action: 'resume-now' };

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

function decideControlTextAction(text: string): ControlDecision {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === '/stop') {
    return { action: 'prompt-stop-modes' };
  }
  if (trimmed === '/restart') {
    return { action: 'prompt-restart-confirm' };
  }
  if (trimmed === '/pause') {
    return { action: 'post-pause-menu' };
  }
  return { action: 'ignore' };
}

// A tap is only ever actioned against the confirm/pause state it actually
// matches - a stop-mode pick with no pending stop-modes confirm (a stale/
// already-actioned tap), a restart confirm with no pending restart confirm,
// or a resume-now tap while not actually paused, all resolve to 'ignore'
// (a decision, never a crash) rather than executing on ambient state that
// no longer applies.
function decideControlCallbackAction(data: string, pendingConfirm: PendingControlConfirm, pauseState: PauseState): ControlDecision {
  const match = data.match(CONTROL_CALLBACK_PATTERN);
  if (!match) {
    return { action: 'ignore' };
  }
  const verb = match[1];
  if (verb === 'cancel') {
    return { action: 'cancel' };
  }
  if (verb === 'emergency-stop') {
    return pendingConfirm?.kind === 'stop-modes' ? { action: 'execute-emergency-stop' } : { action: 'ignore' };
  }
  if (verb === 'drain-stop') {
    return pendingConfirm?.kind === 'stop-modes' ? { action: 'execute-drain-stop' } : { action: 'ignore' };
  }
  if (verb === 'confirm-restart') {
    return pendingConfirm?.kind === 'restart-confirm' ? { action: 'execute-restart' } : { action: 'ignore' };
  }
  if (verb === 'resume-now') {
    return pauseState.active ? { action: 'resume-now' } : { action: 'ignore' };
  }
  if (verb in PAUSE_DURATIONS_MS) {
    return { action: 'apply-pause', durationMs: PAUSE_DURATIONS_MS[verb] };
  }
  if (verb === 'pause-until-resume') {
    return { action: 'apply-pause', durationMs: undefined };
  }
  return { action: 'ignore' };
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
