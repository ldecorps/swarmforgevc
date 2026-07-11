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
import { handleStatusQuery, handleApprovalDecision, StatusProjections, StatusQuery, OperatorStatusProjection } from '../bridge/operatorDecideStatus';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';
import { RoleWorktree } from '../metrics/swarmMetrics';

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

// Each split out of main() so that function's own branch count stays low.
function runApprove(command: Extract<CliCommand, { mode: 'approve' }>, ctx: RunContext): void {
  const roles = readSwarmRoles(ctx.projectRoot).map((r) => r.role);
  const pendingGates = filterPendingGates(computeRoleGateStatesLive(ctx.projectRoot, roles));
  handleApprovalDecision(pendingGates, command.answerText, {
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
