#!/usr/bin/env node
/**
 * BL-285: thin CLI the disposable Operator LLM calls once its own
 * reasoning (specifier-owned prompt guidance, sequenced with this ticket)
 * has recognised a topic message as a status query or an approval
 * decision, and - for a status query - extracted which one. Reuses ONLY
 * existing seams: computeBacklogDashboard (BL-097) for ticket questions,
 * the operator status.json operator_runtime.bb already writes (BL-281)
 * for swarm-liveness questions, computeRoleGateStatesLive/
 * filterPendingGates (BL-265) for gate questions AND for the approval
 * disambiguation, and answerCapturedGateLive (BL-240) as the ONE gate-
 * answer write path. Replies through the SAME reply-outbox file
 * operator_runtime.bb's own idle nudge already writes to (BL-276/BL-281),
 * so a status/decide reply reaches the topic over the identical bridge SSE
 * -> Front Desk Bot egress as any other Operator reply - no new comms path.
 *
 * Usage:
 *   operator-decide.js <thread-id> status-ticket <ticket-id>
 *   operator-decide.js <thread-id> status-swarm
 *   operator-decide.js <thread-id> status-gates
 *   operator-decide.js <thread-id> approve <answer-text>
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeBacklogDashboard } from '../metrics/backlogDashboard';
import { computeRoleGateStatesLive, filterPendingGates } from '../bridge/gateSnapshot';
import { answerCapturedGateLive } from '../bridge/gateAnswerLive';
import { readSwarmRoles } from '../swarm/tmuxClient';
import {
  handleStatusQuery,
  handleApprovalDecisionForTicket,
  selectGateDecisionForTicket,
  GateDecision,
  StatusProjections,
  StatusQuery,
  OperatorStatusProjection,
} from '../bridge/operatorDecideStatus';
import { classifyApprovalReplyAction, isTicketPendingApproval, ApprovalReplyAction } from '../concierge/pendingApprovalReply';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';
import { RoleWorktree } from '../metrics/swarmMetrics';
import { readRoleTicket } from './telegram-front-desk-bot';

const USAGE =
  'Usage: operator-decide.js <thread-id> status-ticket <ticket-id> | status-swarm | status-gates | approve <answer-text>';

export type CliCommand =
  | { mode: 'status-ticket'; threadId: string; ticketId: string }
  | { mode: 'status-swarm'; threadId: string }
  | { mode: 'status-gates'; threadId: string }
  | { mode: 'approve'; threadId: string; answerText: string };

// Each split out of parseArgs so that function's own branch count stays
// low, same technique as every other CLI's parseArgs in this directory.
function parseStatusTicketArgs(threadId: string, rest: string[]): CliCommand {
  if (!rest[0]) {
    throw new Error(USAGE);
  }
  return { mode: 'status-ticket', threadId, ticketId: rest[0] };
}

function parseApproveArgs(threadId: string, rest: string[]): CliCommand {
  if (rest.length === 0) {
    throw new Error(USAGE);
  }
  return { mode: 'approve', threadId, answerText: rest.join(' ') };
}

// Table-driven dispatch (mirrors bridgeServer.ts's JsonRoute/WriteRoute
// tables and telegram-bridge.ts's ACTIONS table): a future mode adds a row
// here, never another branch in parseArgs itself.
const MODE_PARSERS: Record<string, (threadId: string, rest: string[]) => CliCommand> = {
  'status-ticket': parseStatusTicketArgs,
  'status-swarm': (threadId) => ({ mode: 'status-swarm', threadId }),
  'status-gates': (threadId) => ({ mode: 'status-gates', threadId }),
  approve: parseApproveArgs,
};

export function parseArgs(argv: string[]): CliCommand {
  const [threadId, mode, ...rest] = argv;
  if (!threadId || !mode || !MODE_PARSERS[mode]) {
    throw new Error(USAGE);
  }
  return MODE_PARSERS[mode](threadId, rest);
}

function replyOutboxFile(projectRoot: string): string {
  return path.join(projectRoot, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
}

export function appendToReplyOutbox(projectRoot: string, threadId: string, text: string): void {
  const file = replyOutboxFile(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // String keys (not the TS field names) so JSON.stringify prints EXACTLY
  // {"threadId":...,"text":...} - operatorEventQueue.ts's
  // readNewReplyOutboxEntries and operator_runtime.bb's own writer both
  // read/write these two field names verbatim.
  fs.appendFileSync(file, JSON.stringify({ threadId, text }) + '\n');
}

function readOperatorStatus(projectRoot: string): OperatorStatusProjection | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, '.swarmforge', 'operator', 'status.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

interface RunContext {
  projectRoot: string;
  mainWorktreePath: string;
  roleWorktrees: RoleWorktree[];
  reply: (text: string) => void;
}

// BL-416: composes the ticket-scoped reply for a backlog item's OWN
// human_approval sign-off, which selectGateDecisionForTicket's role-gate
// fallback knows nothing about - that selector only ever answers a ROLE
// currently live-gated on a tmux prompt, and falls back to a GLOBAL,
// ticket-blind "nothing pending anywhere" count whenever no such role
// exists for this exact ticket. A ticket awaiting its own sign-off (BL-357/
// 408/409's `human_approval: pending`) is neither of those things, so that
// fallback fired "Nothing to approve right now." for BOTH a successful
// approve (BL-412) and a genuine question on a still-pending ticket
// (BL-414) - false in both cases. Returns undefined when there is no
// ticket-scoped override to apply, so the caller falls through to the
// ORIGINAL role-gate composition unchanged - this never touches
// gateDecision's own 'answer'/'ask-which' behavior (BL-325 scope 6).
export function composeTicketApprovalOverride(
  gateDecision: GateDecision,
  replyActionKind: ApprovalReplyAction['kind'],
  ticketPending: boolean,
  backlogId: string
): string | undefined {
  if (gateDecision.action !== 'nothing') {
    return undefined;
  }
  if (replyActionKind === 'approve') {
    // The separate poll-cycle path (telegramFrontDeskBotCore.ts's
    // deliverOperatorContext) already flipped - or found already-flipped -
    // this exact ticket's own human_approval field on the SAME reply;
    // confirm BY NAME rather than the generic, ticket-blind fallback.
    return `${backlogId} approved.`;
  }
  if (replyActionKind === 'none' && ticketPending) {
    // A non-keyword reply (a question, a comment) on a ticket that is
    // STILL pending must never claim there is nothing to approve - that
    // claim is factually false for this exact ticket.
    return `${backlogId} is still awaiting approval - reply "approve" to confirm.`;
  }
  return undefined;
}

// Each split out of main() so that function's own branch count stays low.
function runApprove(command: Extract<CliCommand, { mode: 'approve' }>, ctx: RunContext): void {
  const roles = readSwarmRoles(ctx.projectRoot).map((r) => r.role);
  const pendingGates = filterPendingGates(computeRoleGateStatesLive(ctx.projectRoot, roles));
  // BL-325 scope 6: threadId names a specific backlog item's own ticket
  // when this call came from that item's own Telegram topic (bl-topic-
  // approval-sweep! passes the backlogId as threadId) - resolved via the
  // SAME role->ticket mapping BL-301's outbound NeedsApproval routing
  // already uses, applied in reverse. A SUP-### threadId never matches a
  // roleTicket value, so this falls back to the original count-based
  // selector automatically - no SUP/BL branch needed here.
  const roleTicket = readRoleTicket(ctx.projectRoot);
  const override = composeTicketApprovalOverride(
    selectGateDecisionForTicket(pendingGates, roleTicket, command.threadId),
    classifyApprovalReplyAction(command.answerText).kind,
    isTicketPendingApproval(ctx.projectRoot, command.threadId),
    command.threadId
  );
  if (override !== undefined) {
    ctx.reply(override);
    return;
  }
  handleApprovalDecisionForTicket(pendingGates, roleTicket, command.threadId, command.answerText, {
    answerGate: (role, answer) => answerCapturedGateLive(ctx.projectRoot, { role, answer }),
    reply: ctx.reply,
  });
}

export function buildStatusQuery(
  command: Exclude<CliCommand, { mode: 'approve' }>,
  ctx: RunContext
): { query: StatusQuery; projections: StatusProjections } {
  if (command.mode === 'status-ticket') {
    return {
      query: { kind: 'ticket', ticketId: command.ticketId },
      projections: { backlog: computeBacklogDashboard(ctx.mainWorktreePath, ctx.roleWorktrees) },
    };
  }
  if (command.mode === 'status-swarm') {
    return { query: { kind: 'swarm-liveness' }, projections: { operatorStatus: readOperatorStatus(ctx.projectRoot) } };
  }
  const roles = readSwarmRoles(ctx.projectRoot).map((r) => r.role);
  return {
    query: { kind: 'pending-gates' },
    projections: { pendingGates: filterPendingGates(computeRoleGateStatesLive(ctx.projectRoot, roles)) },
  };
}

export function main(): void {
  const command = parseArgs(process.argv.slice(2));
  const { projectRoot, mainWorktreePath, roleWorktrees } = resolveCliMainWorktreeContext();
  const ctx: RunContext = {
    projectRoot,
    mainWorktreePath,
    roleWorktrees,
    reply: (text) => appendToReplyOutbox(projectRoot, command.threadId, text),
  };

  if (command.mode === 'approve') {
    runApprove(command, ctx);
    return;
  }
  const { query, projections } = buildStatusQuery(command, ctx);
  handleStatusQuery(query, projections, { reply: ctx.reply });
}

if (require.main === module) {
  runCliMain(main);
}
