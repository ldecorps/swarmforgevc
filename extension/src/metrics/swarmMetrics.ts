import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

// BL-071: single, vscode-free metrics computation module. Both the panel
// (swarmPanel.ts) and the CLI (tools/swarm-metrics.ts) call these functions
// directly - neither re-implements the computation.

export interface RoleWorktree {
  role: string;
  worktreePath: string;
}

export interface MeanTicketTime {
  meanMs: number | null;
  sampleCount: number;
}

// The forward pipeline chain (PIPELINE.md). The coordinator sits outside it
// and is never a retry participant.
const PIPELINE_ORDER = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

function pipelineIndex(role: string): number {
  return PIPELINE_ORDER.indexOf(role);
}

function listFilesInDoneDir(doneDir: string, subdir: string): string[] {
  const fullPath = path.join(doneDir, subdir);
  let entries: string[];
  try {
    entries = fs.readdirSync(fullPath).filter((f) => f.endsWith('.yaml'));
  } catch {
    return [];
  }
  return entries.map((f) => path.join('backlog', 'done', subdir, f));
}

function listDoneBacklogPaths(targetPath: string): string[] {
  const doneDir = path.join(targetPath, 'backlog', 'done');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(doneDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.yaml')) {
      paths.push(path.join('backlog', 'done', entry.name));
    } else if (entry.isDirectory()) {
      paths.push(...listFilesInDoneDir(doneDir, entry.name));
    }
  }
  return paths;
}

interface GitLogBlock {
  dateIso: string;
  statusLines: string[];
}

function parseGitBlocks(output: string): GitLogBlock[] {
  const blocks: GitLogBlock[] = [];
  let current: GitLogBlock | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('COMMIT\t')) {
      current = { dateIso: line.split('\t')[1], statusLines: [] };
      blocks.push(current);
    } else if (current && line.trim()) {
      current.statusLines.push(line);
    }
  }
  return blocks;
}

function gitFollowHistory(targetPath: string, relativePath: string): GitLogBlock[] {
  let output: string;
  try {
    output = execFileSync(
      'git',
      ['-C', targetPath, 'log', '--follow', '--name-status', '--format=COMMIT%x09%cI', '--', relativePath],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch {
    return [];
  }
  return parseGitBlocks(output);
}

function findArrivalDate(blocks: GitLogBlock[], matchesPath: (newPath: string) => boolean): Date | null {
  for (const block of blocks) {
    const arrived = block.statusLines.some((line) => {
      const cols = line.split('\t');
      const status = cols[0];
      const newPath = cols[cols.length - 1];
      return (status.startsWith('R') || status === 'A') && matchesPath(newPath);
    });
    if (arrived) {
      return new Date(block.dateIso);
    }
  }
  return null;
}

function getTicketDuration(blocks: GitLogBlock[], donePath: string): number | null {
  const posixDonePath = donePath.split(path.sep).join('/');
  const closedAt = findArrivalDate(blocks, (p) => p === posixDonePath);
  const activatedAt = findArrivalDate(blocks, (p) => p.startsWith('backlog/active/'));
  if (!closedAt || !activatedAt) {
    return null;
  }
  const durationMs = closedAt.getTime() - activatedAt.getTime();
  return durationMs > 0 ? durationMs : null;
}

// Derives a ticket's active -> done duration purely from git's own rename
// tracking on the backlog file's path history, rather than parsing commit
// message wording (which is a convention, not a protocol contract).
export function computeMeanTicketTime(targetPath: string): MeanTicketTime {
  const donePaths = listDoneBacklogPaths(targetPath);
  const durationsMs: number[] = [];

  for (const donePath of donePaths) {
    const blocks = gitFollowHistory(targetPath, donePath);
    if (blocks.length === 0) {
      continue;
    }
    const duration = getTicketDuration(blocks, donePath);
    if (duration !== null) {
      durationsMs.push(duration);
    }
  }

  if (durationsMs.length === 0) {
    return { meanMs: null, sampleCount: 0 };
  }
  const total = durationsMs.reduce((sum, d) => sum + d, 0);
  return { meanMs: total / durationsMs.length, sampleCount: durationsMs.length };
}

function parseHandoffHeaders(content: string): Record<string, string> {
  const header = content.split('\n\n')[0];
  const headers: Record<string, string> = {};
  for (const line of header.split('\n')) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      headers[match[1]] = match[2].trim();
    }
  }
  return headers;
}

function readHandoffFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
  } catch {
    return [];
  }
}

function intervalMs(start: number, end: number): number {
  return !Number.isNaN(start) && !Number.isNaN(end) && end > start ? end - start : 0;
}

function sumCompletedIntervalsMs(completedDir: string): number {
  let totalMs = 0;
  for (const file of readHandoffFiles(completedDir)) {
    let headers: Record<string, string>;
    try {
      headers = parseHandoffHeaders(fs.readFileSync(path.join(completedDir, file), 'utf8'));
    } catch {
      continue;
    }
    const start = headers.dequeued_at ? Date.parse(headers.dequeued_at) : NaN;
    const end = headers.completed_at ? Date.parse(headers.completed_at) : NaN;
    totalMs += intervalMs(start, end);
  }
  return totalMs;
}

function findEarliestDequeueInFile(filePath: string, current: number | null): number | null {
  let headers: Record<string, string>;
  try {
    headers = parseHandoffHeaders(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return current;
  }
  const dequeuedMs = headers.dequeued_at ? Date.parse(headers.dequeued_at) : NaN;
  if (Number.isNaN(dequeuedMs)) {
    return current;
  }
  return current === null || dequeuedMs < current ? dequeuedMs : current;
}

function findEarliestDequeueInDir(inProcessDir: string): number | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(inProcessDir);
  } catch {
    return null;
  }

  let earliest: number | null = null;
  for (const entry of entries) {
    const fullPath = path.join(inProcessDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    const files = stat.isDirectory() ? readHandoffFiles(fullPath).map((f) => path.join(fullPath, f)) : entry.endsWith('.handoff') ? [fullPath] : [];
    for (const filePath of files) {
      earliest = findEarliestDequeueInFile(filePath, earliest);
    }
  }
  return earliest;
}

function openIntervalMs(inProcessDir: string, nowMs: number): number {
  const earliestDequeueMs = findEarliestDequeueInDir(inProcessDir);
  return earliestDequeueMs === null ? 0 : Math.max(0, nowMs - earliestDequeueMs);
}

// Fraction (0..1) of the run's elapsed time each role's inbox was occupied:
// completed [dequeued_at, completed_at] intervals plus any still-open
// in_process interval.
export function computeBusyness(roles: RoleWorktree[], runStartMs: number, nowMs: number): Record<string, number> {
  const elapsedMs = Math.max(1, nowMs - runStartMs);
  const busyness: Record<string, number> = {};
  for (const role of roles) {
    const completedDir = path.join(role.worktreePath, '.swarmforge', 'handoffs', 'inbox', 'completed');
    const inProcessDir = path.join(role.worktreePath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
    const occupiedMs = sumCompletedIntervalsMs(completedDir) + openIntervalMs(inProcessDir, nowMs);
    busyness[role.role] = Math.min(1, occupiedMs / elapsedMs);
  }
  return busyness;
}

export interface RetryCounts {
  total: number;
  perTicket: Record<string, number>;
}

function extractTicketId(task: string): string | null {
  const match = task.match(/^([A-Za-z]+-\d+)/);
  return match ? match[1] : null;
}

function isGitHandoff(headers: Record<string, string>): boolean {
  return headers.type === 'git_handoff';
}

function getRecipients(toField: string): string[] {
  return (toField ?? '').split(',').map((r) => r.trim()).filter(Boolean);
}

function countBackwardHandoffs(headers: Record<string, string>): Array<{ ticket: string | null }> {
  if (!isGitHandoff(headers)) {
    return [];
  }
  const fromIdx = pipelineIndex(headers.from ?? '');
  if (fromIdx === -1) {
    return [];
  }
  const recipients = getRecipients(headers.to);
  const result: Array<{ ticket: string | null }> = [];
  for (const recipient of recipients) {
    const toIdx = pipelineIndex(recipient);
    if (toIdx !== -1 && fromIdx > toIdx) {
      result.push({ ticket: headers.task ? extractTicketId(headers.task) : null });
    }
  }
  return result;
}

// Counts git_handoff files whose sender sits later in the pipeline chain
// than the recipient. Scans each role's sent/ (the delivered original, one
// copy regardless of recipient count) rather than inbox/completed copies,
// so a broadcast is not double-counted per recipient.
export function computeRetries(roles: RoleWorktree[]): RetryCounts {
  let total = 0;
  const perTicket: Record<string, number> = {};

  for (const role of roles) {
    const sentDir = path.join(role.worktreePath, '.swarmforge', 'handoffs', 'sent');
    for (const file of readHandoffFiles(sentDir)) {
      let headers: Record<string, string>;
      try {
        headers = parseHandoffHeaders(fs.readFileSync(path.join(sentDir, file), 'utf8'));
      } catch {
        continue;
      }
      const backwardHandoffs = countBackwardHandoffs(headers);
      total += backwardHandoffs.length;
      for (const handoff of backwardHandoffs) {
        if (handoff.ticket) {
          perTicket[handoff.ticket] = (perTicket[handoff.ticket] ?? 0) + 1;
        }
      }
    }
  }

  return { total, perTicket };
}

export interface SwarmMetrics {
  meanTicketTimeMs: number | null;
  ticketSampleCount: number;
  busyness: Record<string, number>;
  retryTotal: number;
  retryByTicket: Record<string, number>;
}

export const NO_SAMPLE_PLACEHOLDER = '—';

export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

export function computeSwarmMetrics(
  targetPath: string,
  roles: RoleWorktree[],
  runStartMs: number | null,
  nowMs: number = Date.now()
): SwarmMetrics {
  const { meanMs, sampleCount } = computeMeanTicketTime(targetPath);
  const busyness =
    runStartMs !== null
      ? computeBusyness(roles, runStartMs, nowMs)
      : Object.fromEntries(roles.map((r) => [r.role, 0]));
  const { total, perTicket } = computeRetries(roles);

  return {
    meanTicketTimeMs: meanMs,
    ticketSampleCount: sampleCount,
    busyness,
    retryTotal: total,
    retryByTicket: perTicket,
  };
}
