/**
 * BL-664: read-only transcript walker — classify intervals into the turn taxonomy
 * (git-mechanical, test-run, file-read, thinking-writing, turn-overhead, provider-outage).
 * handoff trail attribution: per-turn stage and ticket id when parcel active.
 */
import * as fs from 'fs';

/**
 * BL-1364: the category set as a RUNTIME value, with the type derived from it.
 * A union type alone vanishes at compile time, so anything that needed to
 * enumerate the categories - the turn-profile series, its store, a renderer -
 * had to restate the list and could then drift from the walker silently
 * (BL-897). This is the one definition; nothing downstream repeats it. The
 * six members and their order are exactly what the union declared, so no
 * classification changes here.
 */
export const INTERVAL_CATEGORIES = [
  'git-mechanical',
  'test-run',
  'file-read',
  'thinking-writing',
  'turn-overhead',
  'provider-outage',
] as const;

export type IntervalCategory = (typeof INTERVAL_CATEGORIES)[number];

export interface ClassifiedInterval {
  category: IntervalCategory;
  startMs: number;
  endMs: number;
  stage?: string;
  ticketId?: string;
}

export interface CoverageWindow {
  startMs: number;
  endMs: number;
}

export interface HandoffTrailEntry {
  ticketId: string;
  stage: string;
  startMs: number;
  endMs: number;
}

export interface WalkerResult {
  coverageWindow: CoverageWindow | null;
  intervals: ClassifiedInterval[];
  transcriptPaths: string[];
  extrapolated: boolean;
}

const GIT_MECHANICAL_RE = /\bgit\b.*(merge|fetch|rev-parse|fast-forward|ff-only)|fast-forward merge/i;
const TEST_RUN_RE = /\b(npm (run )?test|vitest|stryker|node --test|mutation)\b/i;
const PROVIDER_OUTAGE_RE = /rate.?limit|overloaded|retry storm|provider.?outage|503|529/i;

const INTERVAL_KIND_TO_CATEGORY: Record<string, IntervalCategory> = {
  'a trivial git fast-forward': 'git-mechanical',
  'a test or mutation run': 'test-run',
  'reading backlog or specs': 'file-read',
  'drafting or editing prose': 'thinking-writing',
  'boot before first action': 'turn-overhead',
  'a provider retry storm': 'provider-outage',
};

export function classifyIntervalKind(kind: string): IntervalCategory {
  const hit = INTERVAL_KIND_TO_CATEGORY[kind.trim()];
  if (!hit) {
    throw new Error(`unknown interval kind fixture: ${kind}`);
  }
  return hit;
}

function classifyShellCommand(command: string): IntervalCategory {
  if (GIT_MECHANICAL_RE.test(command)) {
    return 'git-mechanical';
  }
  if (TEST_RUN_RE.test(command)) {
    return 'test-run';
  }
  if (PROVIDER_OUTAGE_RE.test(command)) {
    return 'provider-outage';
  }
  return 'git-mechanical';
}

function classifyToolName(toolName: string, inputText: string): IntervalCategory {
  const lower = toolName.toLowerCase();
  if (lower === 'shell' || lower === 'bash') {
    return classifyShellCommand(inputText);
  }
  if (lower === 'read' || lower === 'grep' || lower === 'glob') {
    return 'file-read';
  }
  if (lower === 'write' || lower === 'strreplace' || lower === 'editnotebook') {
    return 'thinking-writing';
  }
  if (PROVIDER_OUTAGE_RE.test(inputText)) {
    return 'provider-outage';
  }
  return 'thinking-writing';
}

function parseTimestampMs(raw: unknown): number | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? undefined : ms;
}

function toolBlocks(message: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  const content = message?.content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter((block) => block && typeof block === 'object') as Array<Record<string, unknown>>;
}

function inputAsText(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input && typeof input === 'object') {
    try {
      return JSON.stringify(input);
    } catch {
      return '';
    }
  }
  return '';
}

function classifyLine(line: string, defaultDurationMs: number): ClassifiedInterval[] {
  if (!line.trim()) {
    return [];
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }
  const timestampMs = parseTimestampMs(parsed.timestamp);
  if (timestampMs === undefined) {
    return [];
  }
  const message = parsed.message as Record<string, unknown> | undefined;
  const intervals: ClassifiedInterval[] = [];
  for (const block of toolBlocks(message)) {
    if (block.type !== 'tool_use') {
      continue;
    }
    const name = typeof block.name === 'string' ? block.name : '';
    const inputText = inputAsText(block.input);
    const category = classifyToolName(name, inputText);
    intervals.push({
      category,
      startMs: timestampMs,
      endMs: timestampMs + defaultDurationMs,
    });
  }
  if (parsed.type === 'assistant' && intervals.length === 0 && message?.content) {
    intervals.push({
      category: 'thinking-writing',
      startMs: timestampMs,
      endMs: timestampMs + defaultDurationMs,
    });
  }
  return intervals;
}

interface TimedEvent {
  type: string;
  timestampMs: number;
  intervals: ClassifiedInterval[];
}

function parseTimedEvents(text: string, defaultDurationMs: number): TimedEvent[] {
  const events: TimedEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const timestampMs = parseTimestampMs(parsed.timestamp);
    if (timestampMs === undefined) {
      continue;
    }
    const type = typeof parsed.type === 'string' ? parsed.type : '';
    events.push({
      type,
      timestampMs,
      intervals: classifyLine(line, defaultDurationMs),
    });
  }
  return events;
}

function overheadIntervals(events: TimedEvent[]): ClassifiedInterval[] {
  const overhead: ClassifiedInterval[] = [];
  let turnStart: number | undefined;
  for (const event of events) {
    if (event.type === 'user') {
      turnStart = event.timestampMs;
      continue;
    }
    if (turnStart !== undefined && event.intervals.length > 0) {
      const firstToolMs = event.timestampMs;
      if (firstToolMs > turnStart) {
        overhead.push({
          category: 'turn-overhead',
          startMs: turnStart,
          endMs: firstToolMs,
        });
      }
      turnStart = undefined;
    }
  }
  return overhead;
}

function attributeTrail(
  intervals: ClassifiedInterval[],
  trail: HandoffTrailEntry[]
): ClassifiedInterval[] {
  return intervals.map((row) => {
    const hit = trail.find(
      (entry) => row.startMs >= entry.startMs && row.startMs <= entry.endMs
    );
    if (!hit) {
      return row;
    }
    return { ...row, stage: hit.stage, ticketId: hit.ticketId };
  });
}

/**
 * BL-1364: folded by hand rather than by `Math.min(...intervals.map(...))`.
 * The spread passes one ARGUMENT per interval, so it throws RangeError
 * ("Maximum call stack size exceeded") once the walk is large enough - and
 * every caller before this ticket walked one worktree group at a time, which
 * stayed under the limit and hid it. The first caller to walk every role's
 * transcripts in one pass (turnProfileProducer, 2256 files on the live repo)
 * hit it immediately. Exported so the fold itself is testable without
 * building a quarter of a million intervals out of real files.
 */
export function coverageFromIntervals(intervals: ClassifiedInterval[]): CoverageWindow | null {
  if (intervals.length === 0) {
    return null;
  }
  let startMs = intervals[0].startMs;
  let endMs = intervals[0].endMs;
  for (const row of intervals) {
    if (row.startMs < startMs) {
      startMs = row.startMs;
    }
    if (row.endMs > endMs) {
      endMs = row.endMs;
    }
  }
  return { startMs, endMs };
}

/** Profile one fixture interval kind (acceptance taxonomy scenarios). */
export function profileIntervalKind(kind: string): IntervalCategory {
  return classifyIntervalKind(kind);
}

/** Read-only walk over transcript JSONL paths; never modifies files. */
export function walkTranscriptFiles(
  transcriptPaths: string[],
  handoffTrail: HandoffTrailEntry[] = [],
  defaultDurationMs = 1000
): WalkerResult {
  const intervals: ClassifiedInterval[] = [];
  const resolvedPaths: string[] = [];
  for (const filePath of transcriptPaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    resolvedPaths.push(filePath);
    const text = fs.readFileSync(filePath, 'utf8');
    const events = parseTimedEvents(text, defaultDurationMs);
    intervals.push(...overheadIntervals(events));
    for (const event of events) {
      intervals.push(...event.intervals);
    }
  }
  const attributed = attributeTrail(intervals, handoffTrail);
  return {
    coverageWindow: coverageFromIntervals(attributed),
    intervals: attributed,
    transcriptPaths: resolvedPaths,
    extrapolated: false,
  };
}

export function snapshotTranscriptFiles(transcriptPaths: string[]): Map<string, string> {
  const snapshots = new Map<string, string>();
  for (const filePath of transcriptPaths) {
    if (fs.existsSync(filePath)) {
      snapshots.set(filePath, fs.readFileSync(filePath, 'utf8'));
    }
  }
  return snapshots;
}

export function transcriptsUnchanged(
  before: Map<string, string>,
  transcriptPaths: string[]
): boolean {
  for (const filePath of transcriptPaths) {
    if (!fs.existsSync(filePath)) {
      if (before.has(filePath)) {
        return false;
      }
      continue;
    }
    const prior = before.get(filePath);
    if (prior === undefined) {
      return false;
    }
    if (prior !== fs.readFileSync(filePath, 'utf8')) {
      return false;
    }
  }
  return true;
}
