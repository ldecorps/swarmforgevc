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

function collectHandoffFilesAt(fullPath: string, entry: string): string[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return [];
  }
  if (stat.isDirectory()) {
    return readHandoffFiles(fullPath).map((f) => path.join(fullPath, f));
  }
  return entry.endsWith('.handoff') ? [fullPath] : [];
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
    for (const filePath of collectHandoffFilesAt(fullPath, entry)) {
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

function isBackwardRecipient(fromIdx: number, recipient: string): boolean {
  const toIdx = pipelineIndex(recipient);
  return toIdx !== -1 && fromIdx > toIdx;
}

function ticketFromHeaders(headers: Record<string, string>): string | null {
  return headers.task ? extractTicketId(headers.task) : null;
}

function countBackwardHandoffs(headers: Record<string, string>): Array<{ ticket: string | null }> {
  if (!isGitHandoff(headers)) {
    return [];
  }
  const fromIdx = pipelineIndex(headers.from ?? '');
  if (fromIdx === -1) {
    return [];
  }
  const ticket = ticketFromHeaders(headers);
  return getRecipients(headers.to)
    .filter((recipient) => isBackwardRecipient(fromIdx, recipient))
    .map(() => ({ ticket }));
}

// Counts git_handoff files whose sender sits later in the pipeline chain
// than the recipient. Scans each role's sent/ (the delivered original, one
// copy regardless of recipient count) rather than inbox/completed copies,
// so a broadcast is not double-counted per recipient.
function processSentFile(sentDir: string, file: string, perTicket: Record<string, number>): number {
  let headers: Record<string, string>;
  try {
    headers = parseHandoffHeaders(fs.readFileSync(path.join(sentDir, file), 'utf8'));
  } catch {
    return 0;
  }
  const backwardHandoffs = countBackwardHandoffs(headers);
  for (const handoff of backwardHandoffs) {
    if (handoff.ticket) {
      perTicket[handoff.ticket] = (perTicket[handoff.ticket] ?? 0) + 1;
    }
  }
  return backwardHandoffs.length;
}

export function computeRetries(roles: RoleWorktree[]): RetryCounts {
  let total = 0;
  const perTicket: Record<string, number> = {};

  for (const role of roles) {
    const sentDir = path.join(role.worktreePath, '.swarmforge', 'handoffs', 'sent');
    for (const file of readHandoffFiles(sentDir)) {
      total += processSentFile(sentDir, file, perTicket);
    }
  }

  return { total, perTicket };
}

export interface SuiteDurationStats {
  latestMs: number | null;
  meanMs: number | null;
  sampleCount: number;
  warn: boolean;
}

export interface SwarmMetrics {
  meanTicketTimeMs: number | null;
  ticketSampleCount: number;
  busyness: Record<string, number>;
  retryTotal: number;
  retryByTicket: Record<string, number>;
  suiteDuration: SuiteDurationStats;
  chaserTelemetry: ChaserTelemetry;
}

export const NO_SAMPLE_PLACEHOLDER = '—';

export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

// BL-078: distinct from formatDurationMs above - suite runs are seconds-scale
// (tens to low hundreds of seconds), not hours-scale, so this reports
// minutes+seconds rather than hours+minutes.
export function formatSuiteDurationMs(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
}

export const DEFAULT_SUITE_WARN_SECONDS = 120;

interface TestDurationRecord {
  finishedAtMs: number;
  durationMs: number;
}

function suiteDurationLogPath(worktreePath: string): string {
  return path.join(worktreePath, 'extension', '.test-durations.jsonl');
}

// No separate blank-line guard: JSON.parse on an empty or whitespace-only
// line throws, which the catch below already turns into the same null
// result - a dedicated check would be a redundant, unkillable branch.
function parseTestDurationLine(line: string): TestDurationRecord | null {
  try {
    const parsed = JSON.parse(line);
    const finishedAtMs = Date.parse(parsed.finished_at);
    const durationMs = Number(parsed.duration_ms);
    if (!Number.isNaN(finishedAtMs) && Number.isFinite(durationMs)) {
      return { finishedAtMs, durationMs };
    }
  } catch {
    // Malformed line: skip it, never let a bad record break the metrics
    // surface (BL-078's "recording failure never breaks" spirit extends to reading too).
  }
  return null;
}

function readTestDurationRecords(worktreePath: string): TestDurationRecord[] {
  let content: string;
  try {
    content = fs.readFileSync(suiteDurationLogPath(worktreePath), 'utf8');
  } catch {
    return [];
  }

  const records: TestDurationRecord[] = [];
  for (const line of content.split('\n')) {
    const record = parseTestDurationLine(line);
    if (record) {
      records.push(record);
    }
  }
  return records;
}

// Aggregates the test-suite duration log across the main checkout and every
// role worktree (each role runs the suite in its own checkout, so each has
// its own log) into one latest/mean/sampleCount view, flagging creep
// (BL-078). warnThresholdMs is the absolute floor; the 2x-rolling-mean check
// catches relative creep even under a generous absolute threshold.
export function computeSuiteDuration(
  targetPath: string,
  roles: RoleWorktree[],
  warnThresholdMs: number = DEFAULT_SUITE_WARN_SECONDS * 1000,
  sampleWindow: number = 20
): SuiteDurationStats {
  const worktreePaths = new Set<string>([targetPath, ...roles.map((r) => r.worktreePath)]);
  const allRecords = [...worktreePaths].flatMap(readTestDurationRecords);

  if (allRecords.length === 0) {
    return { latestMs: null, meanMs: null, sampleCount: 0, warn: false };
  }

  allRecords.sort((a, b) => b.finishedAtMs - a.finishedAtMs);
  const windowed = allRecords.slice(0, sampleWindow);
  const meanMs = windowed.reduce((sum, r) => sum + r.durationMs, 0) / windowed.length;
  const latestMs = allRecords[0].durationMs;

  // The relative-creep check compares the latest run against the mean of the
  // PRIOR runs only - including the latest in its own baseline would dilute
  // a genuine spike (e.g. one bad run among 20 barely moves an including
  // mean, silently defeating the 2x check that exists to catch it).
  // The `priorRecords.length > 0` guard is unkillable by design when
  // mutated to an always-true condition: with zero prior records the
  // reduce/length division is 0/0 = NaN, and every NaN comparison below is
  // false either way, so the guard's only real job is readability (an
  // explicit null beats a silent NaN propagating into the stats).
  const priorRecords = windowed.slice(1);
  const baselineMeanMs =
    priorRecords.length > 0 ? priorRecords.reduce((sum, r) => sum + r.durationMs, 0) / priorRecords.length : null;
  const warn = latestMs > warnThresholdMs || (baselineMeanMs !== null && latestMs > 2 * baselineMeanMs);

  return { latestMs, meanMs, sampleCount: windowed.length, warn };
}

// BL-098: durable per-role chase/nudge/dead-letter/respawn counts, read from
// handoffd.bb's chaser-YYYY-MM.jsonl telemetry log (chase_sweep_lib.bb emits
// one line per decision). The sidecars that used to hold these counts
// (.chase.json/.nudge) are abandoned once an item completes; this log is
// the durable answer to "how many nudges did a role need this week?"
export interface ChaserTelemetryEvent {
  type: string;
  role: string;
  handoffId?: string;
  count?: number;
  at: string;
}

export interface RoleChaserTelemetry {
  chases: number;
  nudges: number;
  deadLetters: number;
  respawns: number;
  /** (chases + nudges) within the recent window, per day. */
  recentDailyRate: number;
}

export type ChaserTelemetry = Record<string, RoleChaserTelemetry>;

export const CHASER_TELEMETRY_WINDOW_DAYS = 7;

function chaserTelemetryDir(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'telemetry');
}

// A malformed or unrecognized line is skipped, never a crash - the same
// forgiving-reader spirit as parseTestDurationLine above. The `type` field
// is what keeps the schema additive (BL-097 dwell/bounce events can join
// this same log later); an event whose type this reader does not know is
// silently ignored rather than rejected outright.
function parseChaserTelemetryLine(line: string): ChaserTelemetryEvent | null {
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed.type === 'string' && typeof parsed.role === 'string' && typeof parsed.at === 'string') {
      return parsed;
    }
  } catch {
    // malformed line: skip
  }
  return null;
}

// A single telemetry file's lines, parsed. Split out of
// readChaserTelemetryEvents so each function stays under the CRAP<=6 gate:
// an unreadable file (deleted/permission-denied between readdir and read)
// contributes nothing rather than aborting the whole read.
function readChaserTelemetryFile(dir: string, file: string): ChaserTelemetryEvent[] {
  let content: string;
  try {
    content = fs.readFileSync(path.join(dir, file), 'utf8');
  } catch {
    return [];
  }
  const events: ChaserTelemetryEvent[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const event = parseChaserTelemetryLine(line);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

function readChaserTelemetryEvents(targetPath: string): ChaserTelemetryEvent[] {
  const dir = chaserTelemetryDir(targetPath);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.startsWith('chaser-') && f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  return files.flatMap((file) => readChaserTelemetryFile(dir, file));
}

function emptyRoleTelemetry(): RoleChaserTelemetry {
  return { chases: 0, nudges: 0, deadLetters: 0, respawns: 0, recentDailyRate: 0 };
}

type ChaserCountField = 'chases' | 'nudges' | 'deadLetters' | 'respawns';

// Maps a telemetry event's `type` to the bucket field it increments; an
// unrecognized type has no field, which is how an event whose type this
// reader does not know is ignored rather than rejected (forward-compatible
// schema for BL-097's later stage-transition events).
function chaserCountField(eventType: string): ChaserCountField | null {
  switch (eventType) {
    case 'chase':
      return 'chases';
    case 'nudge':
      return 'nudges';
    case 'dead-letter':
      return 'deadLetters';
    case 'respawn':
      return 'respawns';
    default:
      return null;
  }
}

// Only chase/nudge events count toward the recent-window daily rate;
// dead-letters and respawns are lifetime totals only.
function countsTowardRecentRate(eventType: string): boolean {
  return eventType === 'chase' || eventType === 'nudge';
}

// Counts one event's timestamp toward its role's recent-window tally when
// the timestamp parses and falls inside the window; split out of
// applyChaserEvent so both functions stay under the CRAP<=6 gate.
function tallyRecentRate(recentCounts: Record<string, number>, role: string, atIso: string, windowStartMs: number): void {
  const atMs = Date.parse(atIso);
  if (!Number.isNaN(atMs) && atMs >= windowStartMs) {
    recentCounts[role] = (recentCounts[role] ?? 0) + 1;
  }
}

// Applies one telemetry event to its role's bucket (lifetime total) and,
// for chase/nudge events within the window, to the recent-rate tally. Split
// out of computeChaserTelemetry so each function stays under the CRAP<=6
// gate.
function applyChaserEvent(
  result: ChaserTelemetry,
  recentCounts: Record<string, number>,
  event: ChaserTelemetryEvent,
  windowStartMs: number
): void {
  const bucket = result[event.role];
  const field = chaserCountField(event.type);
  if (!bucket || !field) {
    return; // unknown role (not in roles.tsv) or unrecognized event type
  }
  bucket[field] += 1;
  if (countsTowardRecentRate(event.type)) {
    tallyRecentRate(recentCounts, event.role, event.at, windowStartMs);
  }
}

// Absent/empty telemetry (no directory yet, or a target with no chases ever
// logged) reads as all-zero totals for every known role, never an error
// (telemetry-05) - a fresh swarm or one whose chaser has never had to
// intervene is not a fault condition.
export function computeChaserTelemetry(
  targetPath: string,
  roleNames: string[],
  nowMs: number = Date.now(),
  windowDays: number = CHASER_TELEMETRY_WINDOW_DAYS
): ChaserTelemetry {
  const result: ChaserTelemetry = {};
  for (const role of roleNames) {
    result[role] = emptyRoleTelemetry();
  }

  const windowStartMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
  const recentCounts: Record<string, number> = {};
  for (const event of readChaserTelemetryEvents(targetPath)) {
    applyChaserEvent(result, recentCounts, event, windowStartMs);
  }

  for (const role of roleNames) {
    result[role].recentDailyRate = (recentCounts[role] ?? 0) / windowDays;
  }
  return result;
}

export function computeSwarmMetrics(
  targetPath: string,
  roles: RoleWorktree[],
  runStartMs: number | null,
  nowMs: number = Date.now(),
  suiteWarnSeconds: number = DEFAULT_SUITE_WARN_SECONDS
): SwarmMetrics {
  const { meanMs, sampleCount } = computeMeanTicketTime(targetPath);
  const busyness =
    runStartMs !== null
      ? computeBusyness(roles, runStartMs, nowMs)
      : Object.fromEntries(roles.map((r) => [r.role, 0]));
  const { total, perTicket } = computeRetries(roles);
  const suiteDuration = computeSuiteDuration(targetPath, roles, suiteWarnSeconds * 1000);
  const chaserTelemetry = computeChaserTelemetry(
    targetPath,
    roles.map((r) => r.role),
    nowMs
  );

  return {
    meanTicketTimeMs: meanMs,
    ticketSampleCount: sampleCount,
    busyness,
    retryTotal: total,
    retryByTicket: perTicket,
    suiteDuration,
    chaserTelemetry,
  };
}
