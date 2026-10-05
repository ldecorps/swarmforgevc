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
import { runGitLog, deriveCloseDates, listGitTreeFiles, readFileAtRef } from './gitHistoryAdapter';
import { extractTicketId, computeReworkEvents, ReworkEvent, RoleWorktree } from './swarmMetrics';
import { CompletedTicketRecord } from './reworkObservatory';

const MUTATION_COST_PATTERN = /^mutation_cost:\s*(\S+)/m;
// BL-1873: record-bounce.js (BL-608/BL-635) writes this field on every
// reviewing role's send-back - the single structured signal a closed
// ticket actually bounced, independent of which evidence files a role
// happened to also leave behind on a clean pass.
const BOUNCE_COUNT_PATTERN = /^bounce_count:\s*(\d+)/m;

interface TicketYamlMeta {
  ticketClass: string | null;
  bounceCount: number;
}

// BL-1873: reads BOTH mutation_cost and bounce_count from the SAME
// `readFileAtRef` call - never a second YAML parser/second read of the
// ticket file for the bounce signal.
function ticketYamlMetaAtRef(targetPath: string, ref: string, filePath: string): TicketYamlMeta {
  const content = readFileAtRef(targetPath, ref, filePath);
  if (!content) {
    return { ticketClass: null, bounceCount: 0 };
  }
  const classMatch = content.match(MUTATION_COST_PATTERN);
  const bounceMatch = content.match(BOUNCE_COUNT_PATTERN);
  return {
    ticketClass: classMatch ? classMatch[1] : null,
    bounceCount: bounceMatch ? parseInt(bounceMatch[1], 10) : 0,
  };
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

// Split out of loadCompletedTicketRecords below so that function's own
// branch count stays at or below the CRAP threshold - the same "extract so
// branch count stays at or below the CRAP threshold" reasoning already
// applied elsewhere in this codebase (see conciergeTick.ts's
// syncAllTitleAgeBuckets/syncStandingTopicIcons). One entry per done
// ticket's own YAML meta (class + bounce_count), first-seen wins (a ticket
// appearing at more than one path in the tree is not expected, but never
// overwritten if it did).
//
// BL-1873: `wantedTicketIds` (the caller's own already-scoped closeDates
// keys) skips the per-ticket `readFileAtRef` (a real `git show` subprocess)
// entirely for a ticket outside the window - listGitTreeFiles' own single
// ls-tree call still names every done ticket ever (cheap), but with 1700+
// done tickets on a live repo, shelling `git show` for every one of them
// (not just the ~460 actually inside a 28-day window) was the real
// remaining cost `--since` alone left behind.
function yamlMetaByTicket(targetPath: string, ref: string, wantedTicketIds: Set<string>): Map<string, TicketYamlMeta> {
  const metaByTicket = new Map<string, TicketYamlMeta>();
  for (const filePath of listGitTreeFiles(targetPath, ref, 'backlog/done')) {
    const ticketId = extractTicketId(path.basename(filePath));
    if (ticketId && wantedTicketIds.has(ticketId) && !metaByTicket.has(ticketId)) {
      metaByTicket.set(ticketId, ticketYamlMetaAtRef(targetPath, ref, filePath));
    }
  }
  return metaByTicket;
}

// BL-1873: a closed ticket counts as reworked only on a RECORDED bounce -
// an evidence file whose name contains "bounce" (committed QA bounce
// evidence), never any evidence file merely naming the ticket (every
// reviewing role leaves routine pass evidence too, e.g.
// `<id>-QA-<date>.md`, which is not a bounce).
function bounceEvidenceTicketIdSet(targetPath: string, ref: string): Set<string> {
  return new Set(
    listGitTreeFiles(targetPath, ref, 'backlog/evidence')
      .filter((filePath) => path.basename(filePath).toLowerCase().includes('bounce'))
      .map((filePath) => extractTicketId(path.basename(filePath)))
      .filter((id): id is string => id !== null)
      .map((id) => id.toUpperCase())
  );
}

// BL-1873: sinceMs optionally scopes the backlog/ history walk to commits
// at/after that instant (the caller's own trailing-window start) - a
// ticket whose promotion predates sinceMs but whose close lands inside the
// window still gets its close date (deriveCloseDates never needs the spec
// arrival). Omitted, the walk is unscoped - the prior, full-history
// behaviour, unchanged for any caller that does not pass it.
export function loadCompletedTicketRecords(targetPath: string, roles: RoleWorktree[], sinceMs?: number): CompletedTicketRecord[] {
  const sinceIso = sinceMs !== undefined ? new Date(sinceMs).toISOString() : undefined;
  const closeDates = deriveCloseDates(runGitLog(targetPath, 'backlog', 'main', undefined, sinceIso));
  const metaByTicket = yamlMetaByTicket(targetPath, 'main', new Set(closeDates.keys()));
  const bounceEvidenceTicketIds = bounceEvidenceTicketIdSet(targetPath, 'main');
  const roleByTicket = latestReworkRoleByTicket(computeReworkEvents(roles));

  const records: CompletedTicketRecord[] = [];
  for (const [ticketId, closeDateIso] of closeDates) {
    const meta = metaByTicket.get(ticketId) ?? { ticketClass: null, bounceCount: 0 };
    records.push({
      ticketId,
      completedAtMs: Date.parse(closeDateIso),
      bounced: roleByTicket.has(ticketId) || bounceEvidenceTicketIds.has(ticketId.toUpperCase()) || meta.bounceCount > 0,
      bouncedFromRole: roleByTicket.get(ticketId) ?? null,
      ticketClass: meta.ticketClass,
    });
  }
  return records;
}
