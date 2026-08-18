// BL-819: chaser-telemetry instrument -> LeanLedgerEvent[] for one ticket
// (time-window correlated).
import { mailboxDir } from '../swarm/swarmState';
import { LeanLedgerEvent } from '../quality/leanLedger';
import { readHandoffHeaderRecordsWithBatches, extractTicketId, readChaserTelemetryEvents, ChaserTelemetryEvent } from './swarmMetrics';
import { MinimalRoleEntry, definedData } from './leanLedgerComposeShared';

interface RoleTicketWindow {
  role: string;
  ticketId: string;
  startMs: number;
  endMs: number;
}

// BL-918: only these mean a human or daemon had to intervene - the rest of
// this file's own comment already named this set ("Chase/nudge/dead-letter/
// respawn telemetry") but the loop below never actually checked it, so any
// row sharing the chaser-*.jsonl file (periodic resource_sample/
// host_load_sample measurements included) became a `stall` regardless of
// type. An ALLOWLIST here (not a denylist of known sample types) is
// deliberate: a sample type invented later defaults to excluded without a
// code change, rather than silently becoming a stall.
export const CHASER_ATTENTION_SIGNAL_TYPES = ['chase', 'nudge', 'dead-letter', 'respawn'] as const;

// Recognised periodic measurements - fire on a timer whether or not
// anything is wrong. Distinguished from a genuinely unrecognised type only
// so unrecognizedChaserTelemetryTypes below can report the latter rather
// than folding it in with an already-understood, deliberately-excluded
// sample type.
const CHASER_PERIODIC_SAMPLE_TYPES = ['resource_sample', 'host_load_sample'];

function isAttentionSignal(type: string): boolean {
  return (CHASER_ATTENTION_SIGNAL_TYPES as readonly string[]).includes(type);
}

function parseWindowTimestamp(iso: string | undefined): number {
  return iso ? Date.parse(iso) : NaN;
}

function isValidWindow(ticketId: string | null, startMs: number, endMs: number): ticketId is string {
  return Boolean(ticketId) && !Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs >= startMs;
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
      const startMs = parseWindowTimestamp(h.enqueued_at);
      const endMs = parseWindowTimestamp(h.completed_at);
      if (isValidWindow(ticketId, startMs, endMs)) {
        windows.push({ role: entry.role, ticketId, startMs, endMs });
      }
    }
  }
  return windows;
}

// Attribution here is a FACTUAL correlation, not an inference: a role holds
// exactly one ticket at a time in task mode, so an event whose timestamp
// falls inside exactly one ticket's window for that role legitimately
// belongs to it. When two tickets' windows overlap for the same role (batch
// mode, or a race) and both contain the event, attribution is genuinely
// ambiguous - null is returned rather than guessing onto one of them.
// BL-918 hardening: split out of composeStallEvents to keep that function's
// own CRAP at/under 6 - this is where the split lands the branching that
// composeStallEvents' loop body used to carry directly.
function resolveStallEvent(telemetryEvent: ChaserTelemetryEvent, windows: RoleTicketWindow[], ticket: string): LeanLedgerEvent | null {
  const atMs = Date.parse(telemetryEvent.at);
  if (Number.isNaN(atMs)) {
    return null;
  }
  const matches = windows.filter((w) => w.role === telemetryEvent.role && atMs >= w.startMs && atMs <= w.endMs);
  const candidateTickets = [...new Set(matches.map((w) => w.ticketId))];
  if (candidateTickets.length !== 1 || candidateTickets[0] !== ticket) {
    return null;
  }
  return {
    ticket,
    type: 'stall',
    source: 'chaser-telemetry',
    at: telemetryEvent.at,
    role: telemetryEvent.role,
    data: definedData({ eventType: telemetryEvent.type, count: telemetryEvent.count ?? null }),
  };
}

// Chase/nudge/dead-letter/respawn telemetry is keyed by role + timestamp,
// not by ticket (handoffd.bb: `handoffId` is a mailbox filename, not a
// stable ticket reference).
export function composeStallEvents(mainWorktreePath: string, roles: MinimalRoleEntry[], ticket: string): LeanLedgerEvent[] {
  const windows = readAllRoleTicketWindows(roles);
  const events: LeanLedgerEvent[] = [];
  for (const telemetryEvent of readChaserTelemetryEvents(mainWorktreePath)) {
    if (!isAttentionSignal(telemetryEvent.type)) {
      continue;
    }
    const event = resolveStallEvent(telemetryEvent, windows, ticket);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

// BL-918 scenario 03: a chaser-telemetry `type` that is neither a known
// attention signal (would already produce a stall above) nor a recognised
// periodic sample (already excluded on purpose) is reported here rather
// than silently dropped the way an excluded sample type is - so a type
// nobody has classified yet stays visible instead of quietly vanishing into
// "not a stall". Reads the raw telemetry file directly (not per-ticket -
// unlike composeStallEvents this performs no window attribution) so one
// call surfaces every unrecognised type present, for lean-ledger-record.ts
// to report to its caller.
export function unrecognizedChaserTelemetryTypes(mainWorktreePath: string): string[] {
  const known = new Set<string>([...CHASER_ATTENTION_SIGNAL_TYPES, ...CHASER_PERIODIC_SAMPLE_TYPES]);
  const found = new Set<string>();
  for (const telemetryEvent of readChaserTelemetryEvents(mainWorktreePath)) {
    if (!known.has(telemetryEvent.type)) {
      found.add(telemetryEvent.type);
    }
  }
  return [...found].sort();
}
