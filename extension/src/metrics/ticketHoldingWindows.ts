import * as fs from 'fs';
import * as path from 'path';
import { parseHandoffHeaders } from './swarmMetrics';

// BL-100 cost-02: per-ticket token attribution needs each role's actual
// ticket-holding windows (dequeued_at -> completed_at), not just the
// aggregate busy fraction swarmMetrics.ts's computeBusyness already
// provides. deriveHoldingWindows is pure over already-read handoff header
// records; readRoleHoldingWindows is the thin fs adapter.

export interface TicketHoldingWindow {
  ticketId: string;
  startMs: number;
  /** null means still open (in_process) at read time. */
  endMs: number | null;
}

function extractTicketId(task: string): string | null {
  const match = task.match(/^([A-Za-z]+-\d+)/);
  return match ? match[1] : null;
}

// Parses an ISO timestamp header, or null if absent/unparsable - the one
// shared shape both startMs (required) and endMs (optional) need.
function parseMsOrNull(iso: string | undefined): number | null {
  if (!iso) {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// Derives one holding window from a header record, or null if it names no
// ticket or has no valid start time. Split out of deriveHoldingWindows so
// each function stays under the CRAP<=6 gate.
function deriveOneHoldingWindow(headers: Record<string, string>): TicketHoldingWindow | null {
  if (!headers.task) {
    return null;
  }
  const ticketId = extractTicketId(headers.task);
  if (!ticketId) {
    return null;
  }
  const startMs = parseMsOrNull(headers.dequeued_at);
  if (startMs === null) {
    return null;
  }
  return { ticketId, startMs, endMs: parseMsOrNull(headers.completed_at) };
}

export function deriveHoldingWindows(headerRecords: Array<Record<string, string>>): TicketHoldingWindow[] {
  return headerRecords
    .map(deriveOneHoldingWindow)
    .filter((w): w is TicketHoldingWindow => w !== null);
}

function readHandoffHeaderRecordsIn(dir: string): Array<Record<string, string>> {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
  } catch {
    return [];
  }
  const records: Array<Record<string, string>> = [];
  for (const file of files) {
    try {
      records.push(parseHandoffHeaders(fs.readFileSync(path.join(dir, file), 'utf8')));
    } catch {
      continue;
    }
  }
  return records;
}

// Reads the header record(s) at one in_process entry: recurses into a batch
// subdirectory, reads a direct .handoff file, or yields nothing for
// anything else/unreadable. Split out of readInProcessHeaderRecords so each
// function stays under the CRAP<=6 gate.
function readEntryHeaderRecords(fullPath: string, isHandoffFile: boolean): Array<Record<string, string>> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return [];
  }
  if (stat.isDirectory()) {
    return readHandoffHeaderRecordsIn(fullPath);
  }
  if (!isHandoffFile) {
    return [];
  }
  try {
    return [parseHandoffHeaders(fs.readFileSync(fullPath, 'utf8'))];
  } catch {
    return [];
  }
}

// in_process may hold direct .handoff files or batch subdirectories
// containing them (mirrors swarmMetrics.ts's own in_process walk).
function readInProcessHeaderRecords(inProcessDir: string): Array<Record<string, string>> {
  let entries: string[];
  try {
    entries = fs.readdirSync(inProcessDir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) =>
    readEntryHeaderRecords(path.join(inProcessDir, entry), entry.endsWith('.handoff'))
  );
}

// Absent handoff directories (role never ran here) read as zero windows,
// never an error (cost-07).
export function readRoleHoldingWindows(worktreePath: string): TicketHoldingWindow[] {
  const completedDir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'completed');
  const inProcessDir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  const headerRecords = [...readHandoffHeaderRecordsIn(completedDir), ...readInProcessHeaderRecords(inProcessDir)];
  return deriveHoldingWindows(headerRecords);
}
