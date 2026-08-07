// BL-819: reads the five instruments the ticket names ("reuse before
// invent") and maps each, for ONE ticket, into LeanLedgerEvent[] -
// leanLedgerStore.ts then appends whatever is new. Every function here is a
// READER over data some other, already-shipping piece of code wrote; none
// of them write anything.
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { mailboxDir } from '../swarm/swarmState';
import { LeanLedgerEvent, LeanLedgerDataValue } from '../quality/leanLedger';
import { readHandoffHeaderRecordsWithBatches, extractTicketId, readChaserTelemetryEvents } from './swarmMetrics';
import { deriveDwellRecords } from './stageDwell';
import { parseBounceHistoryEntries } from '../quality/bounceHistory';

interface MinimalRoleEntry {
  role: string;
  worktreeName: string;
  worktreePath: string;
}

// Drops undefined values (an optional upstream field that wasn't present)
// rather than writing them as null - the KEY is simply absent, same as the
// upstream record never had it, and hasLeanLedgerEventShape only checks
// that PRESENT keys are in the closed allow-list.
function definedData(fields: Record<string, LeanLedgerDataValue | undefined>): Record<string, LeanLedgerDataValue> {
  const data: Record<string, LeanLedgerDataValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      data[key] = value;
    }
  }
  return data;
}

// ── stage-dwell ──────────────────────────────────────────────────────────

// Two ledger events per stage pass, not one: a stage-entry marker (at the
// dequeued_at moment, reconstructed as completedAtMs - processingMs since
// DwellRecord doesn't carry the raw dequeued timestamp itself - both are
// already-computed facts from the same shipped instrument, never a new
// one) and a stage-exit marker (at completed_at, carrying processingMs).
// The two are distinguished by data-key presence alone (exit carries
// processingMs, entry never does) - no extra field needed - so a ticket's
// dwell in the stage is derivable from the pair's `at` values alone, per
// the acceptance scenario's "those two entries" requirement.
export function composeStageTransitionEvents(roles: MinimalRoleEntry[], ticket: string): LeanLedgerEvent[] {
  const events: LeanLedgerEvent[] = [];
  for (const entry of roles) {
    const headers = readHandoffHeaderRecordsWithBatches(mailboxDir(entry, 'inbox', 'completed'));
    const { records } = deriveDwellRecords(headers, entry.role);
    for (const record of records) {
      if (record.ticketId !== ticket) {
        continue;
      }
      const entryAtMs = record.completedAtMs - record.processingMs;
      events.push({
        ticket,
        type: 'stage_transition',
        source: 'stage-dwell',
        at: new Date(entryAtMs).toISOString(),
        role: record.role,
        data: definedData({ queueWaitMs: record.queueWaitMs }),
      });
      events.push({
        ticket,
        type: 'stage_transition',
        source: 'stage-dwell',
        at: new Date(record.completedAtMs).toISOString(),
        role: record.role,
        data: definedData({ processingMs: record.processingMs }),
      });
    }
  }
  return events;
}

// ── bounce-store ─────────────────────────────────────────────────────────
//
// The ticket's own reuse list names bounce_count/bounce_history on the
// TICKET YAML (written by record-bounce.ts's updateTicketBounceHistory) as
// the instrument to compose from - not the gitignored qa_bounces/bounces
// JSONL aggregate (bounceStore.ts), which carries no evidence path at all.
// bounceHistory.ts's parseBounceHistoryEntries is that instrument's own
// reader, already shipping for BL-608's ticket-record display.

// Recursive: a ticket may sit flat under backlog/active/ or nested under
// backlog/done/<milestone>/ (this project's own close-into-done/<milestone>
// convention) by the time its lifecycle is recorded.
function findTicketYamlPathUnder(dir: string, ticket: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findTicketYamlPathUnder(full, ticket);
      if (found) {
        return found;
      }
    }
    if (entry.isFile() && entry.name.startsWith(`${ticket}-`) && entry.name.endsWith('.yaml')) {
      return full;
    }
  }
  return null;
}

// A ticket being recorded mid-pipeline is still under active/; one already
// closed is under done/ - check both, active first (the common case).
function findTicketYamlPath(targetPath: string, ticket: string): string | null {
  return findTicketYamlPathUnder(path.join(targetPath, 'backlog', 'active'), ticket) ?? findTicketYamlPathUnder(path.join(targetPath, 'backlog', 'done'), ticket);
}

export function composeBounceEvents(targetPath: string, ticket: string): LeanLedgerEvent[] {
  const yamlPath = findTicketYamlPath(targetPath, ticket);
  if (!yamlPath) {
    return [];
  }
  let yamlText: string;
  try {
    yamlText = fs.readFileSync(yamlPath, 'utf8');
  } catch {
    return [];
  }
  return parseBounceHistoryEntries(yamlText).map((entry) => ({
    ticket,
    type: 'bounce',
    source: 'bounce-store',
    // The ticket record stores a date only (yyyy-mm-dd), never a full
    // timestamp - the day boundary IS the instrument's own recorded
    // precision, not a fabricated finer one.
    at: `${entry.at}T00:00:00.000Z`,
    data: definedData({ by: entry.by, blamedRole: entry.blamed, failureClass: entry.failureClass, commit: entry.commit, evidence: entry.evidence }),
  }));
}

// ── routing-skip-log ─────────────────────────────────────────────────────

interface RoutingSkipLogEntry {
  ticketId: string;
  skipped: string[];
  reasons: Record<string, string>;
  createdAt: string;
}

function parseRoutingSkipLine(line: string): RoutingSkipLogEntry | null {
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed['ticket-id'] !== 'string' || !Array.isArray(parsed.skipped) || typeof parsed.created_at !== 'string') {
      return null;
    }
    return {
      ticketId: parsed['ticket-id'],
      skipped: parsed.skipped.filter((s: unknown): s is string => typeof s === 'string'),
      reasons: typeof parsed.reasons === 'object' && parsed.reasons !== null ? parsed.reasons : {},
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

// Each routing-skips.jsonl entry names potentially several skipped roles in
// one decision - expanded to one LeanLedgerEvent per skipped role so the
// per-ticket snapshot's `skips` list reads one line per role, matching how
// stage_skip is folded (leanLedger.ts's foldStageSkip).
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
      if (skipEntry.ticketId !== ticket) {
        continue;
      }
      for (const skippedRole of skipEntry.skipped) {
        events.push({
          ticket,
          type: 'stage_skip',
          source: 'routing-skip-log',
          at: skipEntry.createdAt,
          role: skippedRole,
          data: { reason: skipEntry.reasons[skippedRole] ?? '' },
        });
      }
    }
  }
  return events;
}

// ── chaser-telemetry (time-window correlated) ───────────────────────────

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

// ── backlog-close ────────────────────────────────────────────────────────

interface ParsedTopicMessage {
  ts: number;
  text: string;
}

// The swarm's own topic-router convention (topicOpeningSummary.ts family):
// a ticket's completion is announced as a message whose text starts with
// "<ticket> ✅ done". Read-only reuse of that already-written record for
// the close event's timestamp - never a freshly generated one. The LAST
// such message wins (a ticket can only close once in practice, but this
// stays correct if evidence ever shows more than one).
function readDoneMessageTimestamp(targetPath: string, ticket: string): number | null {
  let parsed: { messages?: ParsedTopicMessage[] };
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(targetPath, 'backlog', 'topics', `${ticket}.json`), 'utf8'));
  } catch {
    return null;
  }
  const doneMessages = (parsed.messages ?? []).filter((m) => typeof m.text === 'string' && m.text.startsWith(`${ticket} ✅`));
  if (doneMessages.length === 0) {
    return null;
  }
  return doneMessages[doneMessages.length - 1].ts;
}

// The commit that landed the ticket's YAML into backlog/done/ IS the QA-
// approved close commit (BL-247: QA is the integration point - the same
// commit that moves the file also lands the approved work). git's own
// history is the already-shipping record of that fact - no new producer,
// just a read - so this is the "backlog folder transition" instrument the
// ticket names, not a separate one. Degrades to absent (never a guess) when
// git has no add-commit for the path: no repo, an uncommitted fixture, or a
// worktree where `git log` genuinely can't find it.
function findAddingCommit(targetPath: string, yamlPath: string): string | undefined {
  try {
    const out = execFileSync('git', ['-C', targetPath, 'log', '--diff-filter=A', '--format=%H', '--', path.relative(targetPath, yamlPath)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const commits = out.split('\n').filter(Boolean);
    // Oldest add wins (git log lists newest-first) - the first time this
    // ticket's file landed in done/, in the unlikely case it was ever
    // removed and re-added.
    return commits.length > 0 ? commits[commits.length - 1] : undefined;
  } catch {
    return undefined;
  }
}

export function composeCloseEvent(targetPath: string, ticket: string): LeanLedgerEvent | null {
  const doneYamlPath = findTicketYamlPathUnder(path.join(targetPath, 'backlog', 'done'), ticket);
  if (!doneYamlPath) {
    return null;
  }
  const doneAtMs = readDoneMessageTimestamp(targetPath, ticket);
  if (doneAtMs === null) {
    return null;
  }
  return {
    ticket,
    type: 'close',
    source: 'backlog-close',
    at: new Date(doneAtMs).toISOString(),
    data: definedData({ folder: 'done', commit: findAddingCommit(targetPath, doneYamlPath) }),
  };
}

// ── orchestrator ─────────────────────────────────────────────────────────

export function composeAllLeanLedgerEvents(mainWorktreePath: string, roles: MinimalRoleEntry[], ticket: string): LeanLedgerEvent[] {
  const closeEvent = composeCloseEvent(mainWorktreePath, ticket);
  return [
    ...composeStageTransitionEvents(roles, ticket),
    ...composeBounceEvents(mainWorktreePath, ticket),
    ...composeStageSkipEvents(roles, ticket),
    ...composeStallEvents(mainWorktreePath, roles, ticket),
    ...(closeEvent ? [closeEvent] : []),
  ];
}
