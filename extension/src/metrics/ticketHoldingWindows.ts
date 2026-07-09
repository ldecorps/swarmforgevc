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

export function deriveHoldingWindows(headerRecords: Array<Record<string, string>>): TicketHoldingWindow[] {
  const windows: TicketHoldingWindow[] = [];
  for (const headers of headerRecords) {
    if (!headers.task) {
      continue;
    }
    const ticketId = extractTicketId(headers.task);
    if (!ticketId) {
      continue;
    }
    const startMs = headers.dequeued_at ? Date.parse(headers.dequeued_at) : NaN;
    if (Number.isNaN(startMs)) {
      continue;
    }
    const endMs = headers.completed_at ? Date.parse(headers.completed_at) : NaN;
    windows.push({ ticketId, startMs, endMs: Number.isNaN(endMs) ? null : endMs });
  }
  return windows;
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

// in_process may hold direct .handoff files or batch subdirectories
// containing them (mirrors swarmMetrics.ts's own in_process walk).
function readInProcessHeaderRecords(inProcessDir: string): Array<Record<string, string>> {
  let entries: string[];
  try {
    entries = fs.readdirSync(inProcessDir);
  } catch {
    return [];
  }

  const records: Array<Record<string, string>> = [];
  for (const entry of entries) {
    const fullPath = path.join(inProcessDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      records.push(...readHandoffHeaderRecordsIn(fullPath));
    } else if (entry.endsWith('.handoff')) {
      try {
        records.push(parseHandoffHeaders(fs.readFileSync(fullPath, 'utf8')));
      } catch {
        continue;
      }
    }
  }
  return records;
}

// Absent handoff directories (role never ran here) read as zero windows,
// never an error (cost-07).
export function readRoleHoldingWindows(worktreePath: string): TicketHoldingWindow[] {
  const completedDir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'completed');
  const inProcessDir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  const headerRecords = [...readHandoffHeaderRecordsIn(completedDir), ...readInProcessHeaderRecords(inProcessDir)];
  return deriveHoldingWindows(headerRecords);
}
