import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// BL-100: the claude CLI writes per-message token usage into JSONL
// transcripts under ~/.claude/projects/<cwd-slug>/, one directory per
// working directory. Read-only; these files are never modified. Every
// substantive parsing decision lives in parseTranscriptLines, a pure
// function over already-read lines - readTranscriptUsage is the thin fs
// adapter (glob + read), matching this ticket's own non-behavioral gate.

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface TranscriptUsageRecord {
  messageId: string;
  timestampMs: number;
  model: string;
  usage: UsageTotals;
}

// Matches the real ~/.claude/projects/<slug>/ directory naming: every path
// separator and dot in the cwd becomes a dash (verified against this
// machine's actual project directories, e.g.
// /home/carillon/swarmforgevc/.worktrees/coder ->
// -home-carillon-swarmforgevc--worktrees-coder).
export function projectSlug(cwd: string): string {
  return cwd.replace(/[/.]/g, '-');
}

function toTokenCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseUsageTotals(usage: Record<string, unknown>): UsageTotals {
  return {
    inputTokens: toTokenCount(usage.input_tokens),
    outputTokens: toTokenCount(usage.output_tokens),
    cacheCreationTokens: toTokenCount(usage.cache_creation_input_tokens),
    cacheReadTokens: toTokenCount(usage.cache_read_input_tokens),
  };
}

interface AssistantEntry {
  type?: unknown;
  timestamp?: unknown;
  message?: Record<string, unknown>;
}

// JSON.parse + the one shape check ("is this an assistant-type line at
// all") that every line needs before field-level validation is worthwhile.
function tryParseAssistantEntry(line: string): AssistantEntry | null {
  if (!line.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(line) as AssistantEntry;
    return parsed.type === 'assistant' ? parsed : null;
  } catch {
    return null;
  }
}

// Validates and extracts a usage record from an already-confirmed assistant
// entry, or null if it is missing the fields a usage record needs.
function buildUsageRecord(entry: AssistantEntry): TranscriptUsageRecord | null {
  if (typeof entry.message?.id !== 'string') {
    return null;
  }
  const usage = entry.message.usage as Record<string, unknown> | undefined;
  if (!usage) {
    return null;
  }
  const timestampMs = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
  if (Number.isNaN(timestampMs)) {
    return null;
  }
  return {
    messageId: entry.message.id,
    timestampMs,
    model: typeof entry.message.model === 'string' ? entry.message.model : 'unknown',
    usage: parseUsageTotals(usage),
  };
}

// Parses and validates one JSONL line into a usage record, or null if the
// line is blank, malformed, not an assistant message, or missing the fields
// a usage record needs. Split (tryParseAssistantEntry / buildUsageRecord)
// out of a single function so each stays under the CRAP<=6 gate.
function parseAssistantLine(line: string): TranscriptUsageRecord | null {
  const entry = tryParseAssistantEntry(line);
  return entry ? buildUsageRecord(entry) : null;
}

// A single API response is split across multiple JSONL "assistant" lines
// (one per content block - thinking, tool_use, text, ...), and every one of
// those lines repeats the identical message.usage object for the same
// message.id. Summing per-line would overcount usage by however many
// content blocks the response had, so this dedups to one record per unique
// message.id (first occurrence wins - the usage totals are identical across
// every line sharing an id, so which one wins does not matter).
export function parseTranscriptLines(lines: string[]): TranscriptUsageRecord[] {
  const byMessageId = new Map<string, TranscriptUsageRecord>();

  for (const line of lines) {
    const record = parseAssistantLine(line);
    if (record && !byMessageId.has(record.messageId)) {
      byMessageId.set(record.messageId, record);
    }
  }

  return [...byMessageId.values()];
}

function defaultClaudeProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

// Missing directory (role never ran here) reads as zero records, never an
// error (cost-07: absent data degrades to zeros).
export function readTranscriptUsage(
  worktreePath: string,
  projectsDir: string = defaultClaudeProjectsDir()
): TranscriptUsageRecord[] {
  const dir = path.join(projectsDir, projectSlug(worktreePath));
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  // Dedup by message.id across ALL of the role's transcript files together,
  // not per file: parseTranscriptLines only dedups within the lines it is
  // given, so calling it once per file would miss a message.id that somehow
  // recurs across two files (a session resume/retry writing the same turn
  // into a new file) and double-count it, the exact overcounting this
  // dedup exists to prevent.
  const allLines: string[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch {
      continue;
    }
    allLines.push(...content.split('\n'));
  }
  return parseTranscriptLines(allLines);
}
