// BL-240: the remote gate-answer write path - the ONLY write surface the
// read bridge (BL-065) exposes. Deliberately narrow: an authenticated
// remote client may answer a role's CURRENTLY CAPTURED to-human gate and
// nothing else - no arbitrary keystrokes, no shell, no action on a role
// that isn't actually gated right now. This is not a new way to reach an
// agent's pane: it dispatches through the exact same tmux send-keys call
// PaneTailer.forwardInput already uses when the operator types into a tile
// locally (paneTailer.ts), just assembled fresh per-request rather than
// through a live PaneTailer instance, since the bridge is a separate,
// stateless HTTP surface.
//
// "Currently gated" is determined by capturing the role's pane fresh and
// running the SAME detectNeedsHuman classifier the local tile UI uses -
// there is no separate gate-id ledger to keep in sync; the live pane IS
// the source of truth, matching how a gate is only ever "answered" for as
// long as it's actually still showing.
//
// Auth is the caller's job (bridgeServer.ts's existing isAuthorizedForUrl,
// reused as-is, checked before this module is ever reached) - this module
// never touches auth itself, so it stays testable without an HTTP request
// object. Stronger threat-model hardening (token rotation/revocation, a
// read-vs-control auth step-up) is BL-241, sequenced after this ticket.

export interface GateAnswerRequest {
  role: string;
  answer: string;
}

export interface GateAnswerDeps {
  // undefined = the role's pane could not be captured (unknown role, dead
  // session, no live swarm) - treated the same as "not gated": refuse.
  capturePaneText: (role: string) => string | undefined;
  isPaneGated: (paneText: string) => boolean;
  sendAnswer: (role: string, answer: string) => void;
}

export interface GateAnswerResult {
  success: boolean;
  reason?: string;
}

export function answerCapturedGate(request: GateAnswerRequest, deps: GateAnswerDeps): GateAnswerResult {
  if (typeof request.role !== 'string' || !request.role) {
    return { success: false, reason: 'A gate answer must name a role.' };
  }
  if (typeof request.answer !== 'string') {
    return { success: false, reason: 'A gate answer must include answer text.' };
  }
  const paneText = deps.capturePaneText(request.role);
  if (paneText === undefined || !deps.isPaneGated(paneText)) {
    return { success: false, reason: `"${request.role}" has no captured gate to answer.` };
  }
  deps.sendAnswer(request.role, request.answer);
  return { success: true };
}
