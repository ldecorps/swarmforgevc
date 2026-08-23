// BL-1081: the seat's control state, folded from structured ACP facts.
//
// This is the half the deterministic layer consumes. It answers two questions
// the pane could only ever guess at:
//
//   is this seat idle?      - from a stop reason, not from a frozen pane
//   is it blocked on a
//   permission moment?      - from a structured request, not from a menu
//                             pattern matched against pane text
//
// Pure: a fold over events, with no clock, no filesystem and no process. The
// host writes the state out; nothing here reads anything.

import type { AcpEvent, AcpStopReason } from './acpSessionEvents';

export interface PendingPermission {
  requestId: string | number;
  tool: string;
}

export interface AcpSeatState {
  /** The stop reason of the most recently ended turn, if any has ended. */
  lastStopReason: AcpStopReason | null;
  /** Set while the agent is waiting on a permission decision. */
  pendingPermission: PendingPermission | null;
  /** Tools currently running, by name. A turn is not over while one is. */
  runningTools: string[];
  /** Human-readable transcript lines, in order, for the pane. */
  transcript: string[];
  /** How many turns have ended. Distinguishes "not started" from "idle". */
  turnsEnded: number;
}

export const EMPTY_SEAT_STATE: AcpSeatState = {
  lastStopReason: null,
  pendingPermission: null,
  runningTools: [],
  transcript: [],
  turnsEnded: 0,
};

/** Fold one fact into the state. Never mutates its argument. */
export function applyAcpEvent(state: AcpSeatState, event: AcpEvent): AcpSeatState {
  switch (event.kind) {
    case 'turn_ended':
      return {
        ...state,
        lastStopReason: event.stopReason,
        turnsEnded: state.turnsEnded + 1,
        // A turn that has ended cannot still be waiting on permission: the
        // agent returned. Leaving a stale request here would let one
        // permission moment mute the seat forever.
        pendingPermission: null,
        runningTools: [],
      };
    case 'permission_requested':
      return {
        ...state,
        pendingPermission: { requestId: event.requestId, tool: event.tool },
      };
    case 'tool_status': {
      const running = state.runningTools.filter((t) => t !== event.tool);
      return {
        ...state,
        runningTools: event.status === 'started' ? [...running, event.tool] : running,
        // A tool that resolved is a permission moment that resolved with it.
        pendingPermission:
          event.status !== 'started' && state.pendingPermission?.tool === event.tool
            ? null
            : state.pendingPermission,
      };
    }
    case 'transcript':
      return { ...state, transcript: [...state.transcript, `${event.role}: ${event.text}`] };
  }
}

export function foldAcpEvents(events: readonly AcpEvent[], from: AcpSeatState = EMPTY_SEAT_STATE): AcpSeatState {
  return events.reduce(applyAcpEvent, from);
}

// ── the two decisions the deterministic layer takes ──────────────────────

export type IdleVerdict = {
  idle: boolean;
  /** The structured fact the verdict was taken from. Never a pane excerpt. */
  from: string;
};

/**
 * Is the seat idle? Taken from the stop reason, and from nothing else.
 *
 * A turn that has never ended is not idle - the agent is working, and that is
 * the case a frozen pane got wrong in both directions. A turn waiting on a
 * permission decision is not idle either: the agent is blocked, which is a
 * different condition needing a different response, and conflating them is
 * how a permission moment used to read as a stall.
 */
export function decideIdle(state: AcpSeatState): IdleVerdict {
  if (state.pendingPermission) {
    return { idle: false, from: `permission_requested:${state.pendingPermission.tool}` };
  }
  if (state.runningTools.length > 0) {
    return { idle: false, from: `tool_running:${state.runningTools[0]}` };
  }
  if (state.lastStopReason === null) {
    return { idle: false, from: 'no_turn_ended' };
  }
  return { idle: true, from: `stop_reason:${state.lastStopReason}` };
}

export type PermissionVerdict =
  | { blocked: false; from: string }
  | { blocked: true; from: string; requestId: string | number; tool: string };

/**
 * Is the seat waiting on a permission decision, and which one?
 *
 * The value of answering this structurally is that it needs no pane pattern:
 * the babysitter's interactive-menu CRIT exists precisely because a menu is
 * only visible as text. A seat whose permission moments arrive here does not
 * need that check, and scenario 02 asserts it does not fire.
 */
export function decidePermission(state: AcpSeatState): PermissionVerdict {
  const p = state.pendingPermission;
  if (!p) return { blocked: false, from: 'no_permission_request' };
  return {
    blocked: true,
    from: `permission_requested:${p.tool}`,
    requestId: p.requestId,
    tool: p.tool,
  };
}

// ── the durable shape the deterministic layer reads ──────────────────────

export interface AcpSeatSnapshot {
  role: string;
  acp: true;
  stopReason: AcpStopReason | null;
  idle: boolean;
  idleFrom: string;
  permissionPending: boolean;
  permissionTool: string | null;
  turnsEnded: number;
}

/**
 * The state as the bb side consumes it. Deliberately flat and boring: it
 * crosses a language boundary no import bridges, so every field is a scalar
 * and the vocabulary is the protocol's own.
 */
export function snapshotForSeat(role: string, state: AcpSeatState): AcpSeatSnapshot {
  const idle = decideIdle(state);
  const perm = decidePermission(state);
  return {
    role,
    acp: true,
    stopReason: state.lastStopReason,
    idle: idle.idle,
    idleFrom: idle.from,
    permissionPending: perm.blocked,
    permissionTool: perm.blocked ? perm.tool : null,
    turnsEnded: state.turnsEnded,
  };
}
