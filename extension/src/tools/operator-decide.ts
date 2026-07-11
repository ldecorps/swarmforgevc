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

const USAGE =
  'Usage: operator-decide.js <thread-id> status-ticket <ticket-id> | status-swarm | status-gates | approve <answer-text>';

export type CliCommand =
  | { mode: 'status-ticket'; threadId: string; ticketId: string }
  | { mode: 'status-swarm'; threadId: string }
  | { mode: 'status-gates'; threadId: string }
  | { mode: 'approve'; threadId: string; answerText: string };

export function parseArgs(argv: string[]): CliCommand {
  const [threadId, mode, ...rest] = argv;
  if (!threadId || !mode) {
    throw new Error(USAGE);
  }
  if (mode === 'status-ticket') {
    if (!rest[0]) {
      throw new Error(USAGE);
    }
    return { mode, threadId, ticketId: rest[0] };
  }
  if (mode === 'status-swarm' || mode === 'status-gates') {
    return { mode, threadId };
  }
  if (mode === 'approve') {
    if (rest.length === 0) {
      throw new Error(USAGE);
    }
    return { mode, threadId, answerText: rest.join(' ') };
  }
  throw new Error(USAGE);
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

export function main(): void {
  const command = parseArgs(process.argv.slice(2));
  const { projectRoot, mainWorktreePath, roleWorktrees } = resolveCliMainWorktreeContext();
  const reply = (text: string) => appendToReplyOutbox(projectRoot, command.threadId, text);

  if (command.mode === 'approve') {
    const roles = readSwarmRoles(projectRoot).map((r) => r.role);
    const pendingGates = filterPendingGates(computeRoleGateStatesLive(projectRoot, roles));
    handleApprovalDecision(pendingGates, command.answerText, {
      answerGate: (role, answer) => answerCapturedGateLive(projectRoot, { role, answer }),
      reply,
    });
    return;
  }

  const projections: StatusProjections = {};
  let query: StatusQuery;
  if (command.mode === 'status-ticket') {
    projections.backlog = computeBacklogDashboard(mainWorktreePath, roleWorktrees);
    query = { kind: 'ticket', ticketId: command.ticketId };
  } else if (command.mode === 'status-swarm') {
    projections.operatorStatus = readOperatorStatus(projectRoot);
    query = { kind: 'swarm-liveness' };
  } else {
    const roles = readSwarmRoles(projectRoot).map((r) => r.role);
    projections.pendingGates = filterPendingGates(computeRoleGateStatesLive(projectRoot, roles));
    query = { kind: 'pending-gates' };
  }
  handleStatusQuery(query, projections, { reply });
}

if (require.main === module) {
  runCliMain(main);
}
