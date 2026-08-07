// BL-819: chaser-telemetry instrument -> LeanLedgerEvent[] for one ticket
// (time-window correlated).
import { mailboxDir } from '../swarm/swarmState';
import { LeanLedgerEvent } from '../quality/leanLedger';
import { readHandoffHeaderRecordsWithBatches, extractTicketId, readChaserTelemetryEvents } from './swarmMetrics';
import { MinimalRoleEntry, definedData } from './leanLedgerComposeShared';

interface RoleTicketWindow {
  role: string;
  ticketId: string;
  startMs: number;
  endMs: number;
}

// A ticket's [enqueued_at, completed_at] window in one role's completed
// handoffs - both ends must parse, or the record contributes no window
// (never a guessed bound). Read across ALL roles/tickets (not just the one
// being composed) because the ambiguity check below needs to see every
// ticket that could have been "live" in a role at a given moment.
function readAllRoleTicketWindows(roles: MinimalRoleEntry[]): RoleTicketWindow[] {
  const windows: RoleTicketWindow[] = [];
  for (const entry of roles) {
    const headers = readHandoffHeaderRecordsWithBatches(mailboxDir(entry, 'inbox', 'completed'));
    for (const h of headers) {
      const ticketId = h.task ? extractTicketId(h.task) : null;
      const startMs = h.enqueued_at ? Date.parse(h.enqueued_at) : NaN;
      const endMs = h.completed_at ? Date.parse(h.completed_at) : NaN;
      if (ticketId && !Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs >= startMs) {
        windows.push({ role: entry.role, ticketId, startMs, endMs });
      }
    }
  }
  return windows;
}

// Chase/nudge/dead-letter/respawn telemetry is keyed by role + timestamp,
// not by ticket (handoffd.bb: `handoffId` is a mailbox filename, not a
// stable ticket reference). Attribution here is a FACTUAL correlation, not
// an inference: a role holds exactly one ticket at a time in task mode, so
// an event whose timestamp falls inside exactly one ticket's window for
// that role legitimately belongs to it. When two tickets' windows overlap
// for the same role (batch mode, or a race) and both contain the event,
// attribution is genuinely ambiguous - the event is dropped for every
// ticket rather than guessed onto one of them.
export function composeStallEvents(mainWorktreePath: string, roles: MinimalRoleEntry[], ticket: string): LeanLedgerEvent[] {
  const windows = readAllRoleTicketWindows(roles);
  const events: LeanLedgerEvent[] = [];
  for (const telemetryEvent of readChaserTelemetryEvents(mainWorktreePath)) {
    const atMs = Date.parse(telemetryEvent.at);
    if (Number.isNaN(atMs)) {
      continue;
    }
    const matches = windows.filter((w) => w.role === telemetryEvent.role && atMs >= w.startMs && atMs <= w.endMs);
    const candidateTickets = [...new Set(matches.map((w) => w.ticketId))];
    if (candidateTickets.length !== 1 || candidateTickets[0] !== ticket) {
      continue;
    }
    events.push({
      ticket,
      type: 'stall',
      source: 'chaser-telemetry',
      at: telemetryEvent.at,
      role: telemetryEvent.role,
      data: definedData({ eventType: telemetryEvent.type, count: telemetryEvent.count ?? null }),
    });
  }
  return events;
}
