import { execFileSync } from 'child_process';

// BL-096: thin, exported git-log adapter. Every derivation downstream
// (velocity/burndown/cycle-time/forecasts) is a pure function over
// GitLogEntry[] - only runGitLog itself shells out, and parseGitLog (the
// substantive parsing logic) is fully testable against a fixed fake string,
// no live git required (mirrors the `git log --format=COMMIT%x09...`
// convention swarmMetrics.ts's own gitFollowHistory already established).

export interface GitLogChange {
  status: string;
  path: string;
  oldPath?: string;
}

export interface GitLogEntry {
  commit: string;
  dateIso: string;
  changes: GitLogChange[];
}

function parseChangeLine(line: string): GitLogChange {
  const cols = line.split('\t');
  const status = cols[0];
  if (status.startsWith('R') || status.startsWith('C')) {
    return { status, oldPath: cols[1], path: cols[2] };
  }
  return { status, path: cols[1] };
}

export function parseGitLog(output: string): GitLogEntry[] {
  const entries: GitLogEntry[] = [];
  let current: GitLogEntry | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('COMMIT\t')) {
      const [, commit, dateIso] = line.split('\t');
      current = { commit, dateIso, changes: [] };
      entries.push(current);
    } else if (current && line.trim()) {
      current.changes.push(parseChangeLine(line));
    }
  }
  return entries;
}

// Rename detection (-M) so a `git mv` between backlog folders (active ->
// done, active -> paused -> active, done -> done/<milestone>) shows as one
// R change rather than a D+A pair that would otherwise look like the
// ticket file was deleted and a different one created.
export function runGitLog(targetPath: string, pathspec: string): GitLogEntry[] {
  let output: string;
  try {
    output = execFileSync(
      'git',
      ['-C', targetPath, 'log', '--format=COMMIT%x09%H%x09%cI', '--name-status', '-M', '--reverse', '--', pathspec],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch {
    return [];
  }
  return parseGitLog(output);
}

export interface TicketLifecycleEvent {
  ticketId: string;
  specDateIso: string;
  closeDateIso: string | null;
}

const TICKET_PATH_PATTERN = /(?:^|\/)([A-Za-z]+-\d+)(?:-[^/]+)?\.yaml$/;

function extractTicketId(filePath: string): string | null {
  const match = filePath.match(TICKET_PATH_PATTERN);
  return match ? match[1] : null;
}

function isArrival(status: string): boolean {
  return status === 'A' || status.startsWith('R') || status.startsWith('C');
}

function isDonePath(filePath: string): boolean {
  return filePath.includes('backlog/done/');
}

// Records one change's contribution to the earliest-spec/earliest-close
// maps, if any (a non-arrival change, or one with no extractable ticket id,
// contributes nothing). Split out of deriveTicketLifecycles so each
// function stays under the CRAP<=6 gate.
function recordArrival(
  change: GitLogChange,
  entryDateIso: string,
  specDates: Map<string, string>,
  closeDates: Map<string, string>
): void {
  if (!isArrival(change.status)) {
    return;
  }
  const ticketId = extractTicketId(change.path);
  if (!ticketId) {
    return;
  }
  if (!specDates.has(ticketId)) {
    specDates.set(ticketId, entryDateIso);
  }
  if (isDonePath(change.path) && !closeDates.has(ticketId)) {
    closeDates.set(ticketId, entryDateIso);
  }
}

// Pure: derives each ticket's earliest arrival anywhere under backlog/ (its
// spec date) and its earliest arrival under backlog/done/ (its close date,
// null if never closed). Earliest-wins for both, so a later re-milestoning
// move (done/ -> done/<other-milestone>/) never overwrites the original
// close date, and out-of-order input entries are sorted chronologically
// first so callers do not have to guarantee ordering themselves.
export function deriveTicketLifecycles(entries: GitLogEntry[]): Map<string, TicketLifecycleEvent> {
  const sorted = [...entries].sort((a, b) => Date.parse(a.dateIso) - Date.parse(b.dateIso));
  const specDates = new Map<string, string>();
  const closeDates = new Map<string, string>();

  for (const entry of sorted) {
    for (const change of entry.changes) {
      recordArrival(change, entry.dateIso, specDates, closeDates);
    }
  }

  const result = new Map<string, TicketLifecycleEvent>();
  for (const [ticketId, specDateIso] of specDates) {
    result.set(ticketId, { ticketId, specDateIso, closeDateIso: closeDates.get(ticketId) ?? null });
  }
  return result;
}

// BL-094: recent-activity's "merges to main" - a distinct git-log shape
// from the backlog-lifecycle walk above (merge commits only, one line per
// commit with its subject, no --name-status), so it gets its own thin
// adapter rather than overloading parseGitLog's per-commit-block format.
export interface MergeLogEntry {
  commit: string;
  dateIso: string;
  subject: string;
}

export function parseMergeLog(output: string): MergeLogEntry[] {
  const entries: MergeLogEntry[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const [commit, dateIso, ...subjectParts] = line.split('\t');
    if (!commit || !dateIso) {
      continue;
    }
    entries.push({ commit, dateIso, subject: subjectParts.join('\t') });
  }
  return entries;
}

export function runMergeLog(targetPath: string, limit: number = 20): MergeLogEntry[] {
  let output: string;
  try {
    output = execFileSync(
      'git',
      ['-C', targetPath, 'log', '--merges', `-n${limit}`, '--format=%H%x09%cI%x09%s'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch {
    return [];
  }
  return parseMergeLog(output);
}

// BL-097: backlog.json's "generated at this source SHA" field - a thin
// adapter with no pure half to split out (a single rev-parse has no
// text-parsing logic worth testing separately).
export function getCurrentSha(targetPath: string): string | null {
  try {
    return execFileSync('git', ['-C', targetPath, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}
