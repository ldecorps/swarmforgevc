// BL-713 (slice A of BL-712): the seat's structured decision surface.
//
// Split out of cursorSeatDriver.ts (BL-485 mutation-site advisory — this file
// was 360 sites, then 193 after the first split). This half is the pure
// decision logic: the `SessionSignal` type and `decideNextStep`, the one
// function that turns a signal into a step. Wire-format text (handoff draft,
// ready_for_next parsing, transcript rendering) lives in
// ./cursorSeatWireFormat.
//
// Invariant 2 (BL-713): `decideNextStep` is a pure function of a
// `SessionSignal` — no deps, nothing to scrape even if it wanted to.
// Rendered pane text is not an input anywhere here.

export * from './cursorSeatWireFormat';

// ── structured session signals ────────────────────────────────────────────

export type HelperName = 'ready_for_next' | 'swarm_handoff';

export type SessionSignal =
  | { kind: 'stop_reason'; value: 'completed' | 'refused' | 'error'; detail?: string }
  | { kind: 'tool_event'; tool: string; permission: 'granted' | 'denied'; detail?: string }
  | { kind: 'helper_exit'; helper: HelperName; exitCode: number; forwarded?: boolean; detail?: string };

export type SeatStep = 'forward_handoff' | 'continue_session' | 'await_wake' | 'abort';

export interface SeatDecision {
  step: SeatStep;
  /** The exact structured signal this step was taken from. */
  fromSignal: string;
  reason: string;
}

function decideFromStopReason(stop: Extract<SessionSignal, { kind: 'stop_reason' }>): SeatDecision {
  if (stop.value === 'completed') {
    return {
      step: 'forward_handoff',
      fromSignal: 'stop_reason:completed',
      reason: 'the session reported the stage work finished',
    };
  }
  return {
    step: 'abort',
    fromSignal: `stop_reason:${stop.value}`,
    reason: `the session stopped with reason "${stop.value}"${stop.detail ? `: ${stop.detail}` : ''}`,
  };
}

function decideFromToolEvent(tool: Extract<SessionSignal, { kind: 'tool_event' }>): SeatDecision {
  if (tool.permission === 'granted') {
    return {
      step: 'continue_session',
      fromSignal: `tool_event:${tool.tool}:granted`,
      reason: `the session was granted "${tool.tool}"`,
    };
  }
  return {
    step: 'abort',
    fromSignal: `tool_event:${tool.tool}:denied`,
    reason: `the session was denied "${tool.tool}"; a human decides what happens next`,
  };
}

function decideFromHelperExit(helper: Extract<SessionSignal, { kind: 'helper_exit' }>): SeatDecision {
  const from = `helper_exit:${helper.helper}:${helper.exitCode}`;
  if (helper.exitCode !== 0) {
    return { step: 'abort', fromSignal: from, reason: `${helper.helper} exited ${helper.exitCode}` };
  }
  if (helper.forwarded) {
    return {
      step: 'await_wake',
      fromSignal: from,
      reason: `${helper.helper} delivered the parcel; the seat waits for its next wake and never polls on its own`,
    };
  }
  return { step: 'continue_session', fromSignal: from, reason: `${helper.helper} exited 0` };
}

/**
 * The whole decision surface, and a PURE function of the signal — no deps, no
 * environment, no rendered text. Two signals that a pane scraper would render
 * identically ("completed" as a stop reason vs a denied tool named
 * "completed") decide differently here precisely because the structure, not
 * the words, is what is read.
 */
export function decideNextStep(signal: SessionSignal | { kind: string }): SeatDecision {
  const kind = signal?.kind;
  if (kind === 'stop_reason') return decideFromStopReason(signal as Extract<SessionSignal, { kind: 'stop_reason' }>);
  if (kind === 'tool_event') return decideFromToolEvent(signal as Extract<SessionSignal, { kind: 'tool_event' }>);
  if (kind === 'helper_exit') return decideFromHelperExit(signal as Extract<SessionSignal, { kind: 'helper_exit' }>);
  return {
    step: 'abort',
    fromSignal: `unrecognised:${typeof kind === 'string' ? kind : 'none'}`,
    reason: 'unrecognised session signal; the driver refuses to guess a next step from it',
  };
}
