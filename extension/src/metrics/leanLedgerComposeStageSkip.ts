// BL-819: routing-skip-log instrument -> LeanLedgerEvent[] for one ticket.
import * as fs from 'fs';
import * as path from 'path';
import { LeanLedgerEvent } from '../quality/leanLedger';
import { MinimalRoleEntry } from './leanLedgerComposeShared';

interface RoutingSkipLogEntry {
  ticketId: string;
  skipped: string[];
  reasons: Record<string, string>;
  createdAt: string;
}

function isValidRoutingSkipShape(parsed: any): boolean {
  return typeof parsed['ticket-id'] === 'string' && Array.isArray(parsed.skipped) && typeof parsed.created_at === 'string';
}

function routingSkipReasons(parsed: any): Record<string, string> {
  return typeof parsed.reasons === 'object' && parsed.reasons !== null ? parsed.reasons : {};
}

function parseRoutingSkipLine(line: string): RoutingSkipLogEntry | null {
  try {
    const parsed = JSON.parse(line);
    if (!isValidRoutingSkipShape(parsed)) {
      return null;
    }
    return {
      ticketId: parsed['ticket-id'],
      skipped: parsed.skipped.filter((s: unknown): s is string => typeof s === 'string'),
      reasons: routingSkipReasons(parsed),
      createdAt: parsed.created_at,
    };
  } catch {
    return null;
  }
}

function readRoutingSkipLogEntries(worktreePath: string): RoutingSkipLogEntry[] {
  let content: string;
  try {
    content = fs.readFileSync(path.join(worktreePath, '.swarmforge', 'routing-skips.jsonl'), 'utf8');
  } catch {
    return [];
  }
  return content
    .split('\n')
    .filter((l) => l.trim())
    .map(parseRoutingSkipLine)
    .filter((e): e is RoutingSkipLogEntry => e !== null);
}

// One routing-skips.jsonl entry names potentially several skipped roles in
// one decision - expanded to one LeanLedgerEvent per skipped role so the
// per-ticket snapshot's `skips` list reads one line per role, matching how
// stage_skip is folded (leanLedger.ts's foldStageSkip). Empty (not this
// ticket) rather than a guessed match.
function eventsForSkipEntry(skipEntry: RoutingSkipLogEntry, ticket: string): LeanLedgerEvent[] {
  if (skipEntry.ticketId !== ticket) {
    return [];
  }
  return skipEntry.skipped.map((skippedRole) => ({
    ticket,
    type: 'stage_skip' as const,
    source: 'routing-skip-log' as const,
    at: skipEntry.createdAt,
    role: skippedRole,
    data: { reason: skipEntry.reasons[skippedRole] ?? '' },
  }));
}

export function composeStageSkipEvents(roles: MinimalRoleEntry[], ticket: string): LeanLedgerEvent[] {
  const events: LeanLedgerEvent[] = [];
  const seenWorktrees = new Set<string>();
  for (const entry of roles) {
    // routing-skips.jsonl lives at the WORKTREE root (sibling of
    // .swarmforge/handoffs/), one file per worktree regardless of how many
    // roles share it (master-resident specifier/coordinator) - read each
    // distinct worktree path once.
    if (seenWorktrees.has(entry.worktreePath)) {
      continue;
    }
    seenWorktrees.add(entry.worktreePath);
    for (const skipEntry of readRoutingSkipLogEntries(entry.worktreePath)) {
      events.push(...eventsForSkipEntry(skipEntry, ticket));
    }
  }
  return events;
}
