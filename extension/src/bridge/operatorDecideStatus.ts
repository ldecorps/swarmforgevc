// BL-285: Operator Decide+Status (Talk slice 4) - pure decision/composition
// logic + adapter-injected orchestration for handling a topic message that
// is either a status query or an approval decision. Recognising WHICH kind
// a free-text topic message is, and extracting its structured query (which
// ticket, "swarm", "gates"), is the disposable Operator LLM's own judgment
// (specifier-owned prompt guidance, sequenced with this ticket) - this
// module starts from an already-structured query/decision and stays pure
// or adapter-injected throughout, so it is testable with fixtures/fakes
// and never fabricates an answer or an approval.
import { RoleGateState } from './gateSnapshot';
import { BacklogDashboardData } from '../metrics/backlogDashboard';

// ── gate decision (pure) — decide-status-03/04/05 ────────────────────────

export type GateDecision = { action: 'answer'; role: string } | { action: 'ask-which'; roles: string[] } | { action: 'nothing' };

// Given the live pending-gate view, decides which gate (if any) an
// in-topic approval should answer. Never fabricates: zero pending -> there
// is nothing to approve; more than one -> ask rather than guess.
export function selectGateDecision(pendingGates: RoleGateState[]): GateDecision {
  if (pendingGates.length === 0) {
    return { action: 'nothing' };
  }
  if (pendingGates.length === 1) {
    return { action: 'answer', role: pendingGates[0].role };
  }
  return { action: 'ask-which', roles: pendingGates.map((g) => g.role) };
}

// BL-325 scope 6: when the caller names a specific backlog item's own
// ticket (an in-topic reply - targetBacklogId is that item's backlogId),
// the gate held by the role CURRENTLY HOLDING that ticket is answered
// directly - never the count-based ask-which, which would ask "which
// gate?" even though the topic itself already says which ticket. Mirrors
// conciergeTick.ts's own outbound `roleTicket[gate.role]` lookup, applied
// in reverse (ticket -> role instead of role -> ticket).
//
// Falls back to the ORIGINAL count-based selectGateDecision whenever
// targetBacklogId is absent (a SUP thread never names a backlogId, so this
// is automatic - no SUP/BL branch needed) or does not resolve to a
// currently-gated role (the genuine "this ticket has no pending gate of
// its own" fallback, scope 6's own wording) - so a SUP thread's existing
// answer-the-sole-pending-gate/ask-which behavior is completely unchanged.
export function selectGateDecisionForTicket(
  pendingGates: RoleGateState[],
  roleTicket: Record<string, string>,
  targetBacklogId: string | undefined
): GateDecision {
  if (targetBacklogId) {
    const targetRole = Object.keys(roleTicket).find((role) => roleTicket[role] === targetBacklogId);
    if (targetRole && pendingGates.some((g) => g.role === targetRole)) {
      return { action: 'answer', role: targetRole };
    }
  }
  return selectGateDecision(pendingGates);
}

export interface ApprovalDeps {
  // Mirrors gateAnswerPath.ts's own GateAnswerResult shape - the real
  // wiring passes answerCapturedGateLive here, tests a fake.
  answerGate: (role: string, answer: string) => { success: boolean; reason?: string };
  reply: (text: string) => void;
}

// The orchestration shared by both entry points below: answer the DECIDED
// gate through the injected write path ONLY when exactly one is targeted,
// then always confirm/refuse/ask in the topic via the injected reply
// adapter - reusing gateAnswerPath.ts's ONE write path, never a second
// gate-answer surface.
function applyGateDecision(decision: GateDecision, answerText: string, deps: ApprovalDeps): GateDecision {
  if (decision.action === 'answer') {
    const result = deps.answerGate(decision.role, answerText);
    deps.reply(
      result.success
        ? `Answered ${decision.role}'s gate: ${answerText}.`
        : `Could not answer ${decision.role}'s gate: ${result.reason ?? 'unknown error'}.`
    );
  } else if (decision.action === 'nothing') {
    deps.reply('Nothing to approve right now.');
  } else {
    deps.reply(`Which gate should I answer - ${decision.roles.join(', ')}?`);
  }
  return decision;
}

// Orchestrates an in-topic approval end to end via the count-based
// selector - unchanged since BL-285, the exact behavior a SUP thread (no
// ticket context of its own) still needs.
export function handleApprovalDecision(pendingGates: RoleGateState[], answerText: string, deps: ApprovalDeps): GateDecision {
  return applyGateDecision(selectGateDecision(pendingGates), answerText, deps);
}

// BL-325 scope 6: the ticket-directed variant - same orchestration, gate
// selection resolved via selectGateDecisionForTicket above instead.
export function handleApprovalDecisionForTicket(
  pendingGates: RoleGateState[],
  roleTicket: Record<string, string>,
  targetBacklogId: string | undefined,
  answerText: string,
  deps: ApprovalDeps
): GateDecision {
  return applyGateDecision(selectGateDecisionForTicket(pendingGates, roleTicket, targetBacklogId), answerText, deps);
}

// ── status answer (pure + adapter-injected) — decide-status-01/02 ───────

export type StatusQuery = { kind: 'ticket'; ticketId: string } | { kind: 'swarm-liveness' } | { kind: 'pending-gates' };

export interface OperatorStatusProjection {
  state: string;
  agents_running: number;
  pending_events: number;
}

export interface StatusProjections {
  backlog?: Pick<BacklogDashboardData, 'board'>;
  operatorStatus?: OperatorStatusProjection;
  pendingGates?: RoleGateState[];
}

function findTicket(backlog: StatusProjections['backlog'], ticketId: string) {
  if (!backlog) {
    return undefined;
  }
  const done = ([] as { id: string; status: string; title: string }[]).concat(...Object.values(backlog.board.doneByMilestone));
  return [...backlog.board.active, ...backlog.board.paused, ...done].find((t) => t.id === ticketId);
}

// Each split out of composeStatusAnswer so that function's own branch
// count stays low - one answer-builder per query kind, same anti-
// fabrication contract (an id/kind absent from its projection answers
// "I don't know", never a guess).
function answerTicketQuery(projections: StatusProjections, ticketId: string): string {
  const ticket = findTicket(projections.backlog, ticketId);
  return ticket ? `${ticket.id} is ${ticket.status} - ${ticket.title}.` : `I don't know - ${ticketId} isn't in the projection.`;
}

function answerSwarmLivenessQuery(projections: StatusProjections): string {
  const status = projections.operatorStatus;
  return status
    ? `Swarm state: ${status.state}, ${status.agents_running} agent(s) running, ${status.pending_events} pending event(s).`
    : "I don't know - no swarm status is available.";
}

function answerPendingGatesQuery(projections: StatusProjections): string {
  const gates = projections.pendingGates ?? [];
  return gates.length === 0 ? 'No gates pending.' : `${gates.length} gate(s) pending: ${gates.map((g) => g.role).join(', ')}.`;
}

// Composes a status answer STRICTLY from the given projections - never a
// guess. An id/kind absent from its projection answers "I don't know",
// exactly like the ticket's own anti-fabrication contract, rather than
// inventing a plausible-sounding state.
export function composeStatusAnswer(query: StatusQuery, projections: StatusProjections): string {
  if (query.kind === 'ticket') {
    return answerTicketQuery(projections, query.ticketId);
  }
  if (query.kind === 'swarm-liveness') {
    return answerSwarmLivenessQuery(projections);
  }
  return answerPendingGatesQuery(projections);
}

export interface StatusDeps {
  reply: (text: string) => void;
}

export function handleStatusQuery(query: StatusQuery, projections: StatusProjections, deps: StatusDeps): string {
  const answer = composeStatusAnswer(query, projections);
  deps.reply(answer);
  return answer;
}
