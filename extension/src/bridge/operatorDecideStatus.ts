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

export interface ApprovalDeps {
  // Mirrors gateAnswerPath.ts's own GateAnswerResult shape - the real
  // wiring passes answerCapturedGateLive here, tests a fake.
  answerGate: (role: string, answer: string) => { success: boolean; reason?: string };
  reply: (text: string) => void;
}

// Orchestrates an in-topic approval end to end: select the gate (pure,
// above), answer it through the injected write path ONLY when exactly one
// is pending, then always confirm/refuse/ask in the topic via the injected
// reply adapter - reusing gateAnswerPath.ts's ONE write path, never a
// second gate-answer surface.
export function handleApprovalDecision(pendingGates: RoleGateState[], answerText: string, deps: ApprovalDeps): GateDecision {
  const decision = selectGateDecision(pendingGates);
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

// Composes a status answer STRICTLY from the given projections - never a
// guess. An id/kind absent from its projection answers "I don't know",
// exactly like the ticket's own anti-fabrication contract, rather than
// inventing a plausible-sounding state.
export function composeStatusAnswer(query: StatusQuery, projections: StatusProjections): string {
  if (query.kind === 'ticket') {
    const ticket = findTicket(projections.backlog, query.ticketId);
    return ticket ? `${ticket.id} is ${ticket.status} - ${ticket.title}.` : `I don't know - ${query.ticketId} isn't in the projection.`;
  }
  if (query.kind === 'swarm-liveness') {
    const status = projections.operatorStatus;
    return status
      ? `Swarm state: ${status.state}, ${status.agents_running} agent(s) running, ${status.pending_events} pending event(s).`
      : "I don't know - no swarm status is available.";
  }
  const gates = projections.pendingGates ?? [];
  return gates.length === 0 ? 'No gates pending.' : `${gates.length} gate(s) pending: ${gates.map((g) => g.role).join(', ')}.`;
}

export interface StatusDeps {
  reply: (text: string) => void;
}

export function handleStatusQuery(query: StatusQuery, projections: StatusProjections, deps: StatusDeps): string {
  const answer = composeStatusAnswer(query, projections);
  deps.reply(answer);
  return answer;
}
