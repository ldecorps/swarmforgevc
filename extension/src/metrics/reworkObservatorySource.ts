/**
 * BL-430: assembles CompletedTicketRecord[] (reworkObservatory.ts's pure
 * input shape) from real repo state. A ticket counts as "bounced" via the
 * OR of two independent signals: a live backward-handoff trail
 * (computeReworkEvents, this swarm run's own worktrees) and committed QA
 * bounce evidence (backlog/evidence/). Both "completed" (backlog/done/) and
 * the evidence check are read from the MAIN ref (BL-340), never this
 * worktree's own checkout - a role's branch can lag commits already landed
 * on main, and a filesystem-only read of either would undercount.
 */
import * as path from 'path';
import { runGitLog, deriveTicketLifecycles, listGitTreeFiles, readFileAtRef } from './gitHistoryAdapter';
import { extractTicketId, computeReworkEvents, ReworkEvent, RoleWorktree } from './swarmMetrics';
import { CompletedTicketRecord } from './reworkObservatory';

const MUTATION_COST_PATTERN = /^mutation_cost:\s*(\S+)/m;

function ticketClassAtRef(targetPath: string, ref: string, filePath: string): string | null {
  const content = readFileAtRef(targetPath, ref, filePath);
  if (!content) {
    return null;
  }
  const match = content.match(MUTATION_COST_PATTERN);
  return match ? match[1] : null;
}

// Pure: which role a ticket most recently bounced FROM, when it bounced
// more than once - the latest event wins, most representative of where the
// ticket currently sits. Split out so the reduction is testable without a
// real git repo.
export function latestReworkRoleByTicket(events: ReworkEvent[]): Map<string, string> {
  const latest = new Map<string, { fromRole: string; atMs: number }>();
  for (const event of events) {
    const current = latest.get(event.ticketId);
    if (!current || event.atMs > current.atMs) {
      latest.set(event.ticketId, { fromRole: event.fromRole, atMs: event.atMs });
    }
  }
  const roles = new Map<string, string>();
  for (const [ticketId, entry] of latest) {
    roles.set(ticketId, entry.fromRole);
  }
  return roles;
}

export function loadCompletedTicketRecords(targetPath: string, roles: RoleWorktree[]): CompletedTicketRecord[] {
  const lifecycles = deriveTicketLifecycles(runGitLog(targetPath, 'backlog', 'main'));

  const classByTicket = new Map<string, string | null>();
  for (const filePath of listGitTreeFiles(targetPath, 'main', 'backlog/done')) {
    const ticketId = extractTicketId(path.basename(filePath));
    if (ticketId && !classByTicket.has(ticketId)) {
      classByTicket.set(ticketId, ticketClassAtRef(targetPath, 'main', filePath));
    }
  }

  const evidenceTicketIds = new Set(
    listGitTreeFiles(targetPath, 'main', 'backlog/evidence')
      .map((filePath) => extractTicketId(path.basename(filePath)))
      .filter((id): id is string => id !== null)
      .map((id) => id.toUpperCase())
  );

  const roleByTicket = latestReworkRoleByTicket(computeReworkEvents(roles));

  const records: CompletedTicketRecord[] = [];
  for (const [ticketId, lifecycle] of lifecycles) {
    if (!lifecycle.closeDateIso) {
      continue; // not yet completed - active/paused tickets carry no rework signal yet
    }
    records.push({
      ticketId,
      completedAtMs: Date.parse(lifecycle.closeDateIso),
      bounced: roleByTicket.has(ticketId) || evidenceTicketIds.has(ticketId.toUpperCase()),
      bouncedFromRole: roleByTicket.get(ticketId) ?? null,
      ticketClass: classByTicket.get(ticketId) ?? null,
    });
  }
  return records;
}
