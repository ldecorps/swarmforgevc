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
    if (!line.trim()) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = parsed as { type?: unknown; timestamp?: unknown; message?: Record<string, unknown> };
    if (entry.type !== 'assistant' || typeof entry.message?.id !== 'string') {
      continue;
    }
    const usage = entry.message.usage as Record<string, unknown> | undefined;
    if (!usage) {
      continue;
    }
    const messageId = entry.message.id;
    if (byMessageId.has(messageId)) {
      continue;
    }
    const timestampMs = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
    if (Number.isNaN(timestampMs)) {
      continue;
    }
    byMessageId.set(messageId, {
      messageId,
      timestampMs,
      model: typeof entry.message.model === 'string' ? entry.message.model : 'unknown',
      usage: {
        inputTokens: toTokenCount(usage.input_tokens),
        outputTokens: toTokenCount(usage.output_tokens),
        cacheCreationTokens: toTokenCount(usage.cache_creation_input_tokens),
        cacheReadTokens: toTokenCount(usage.cache_read_input_tokens),
      },
    });
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

  const records: TranscriptUsageRecord[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch {
      continue;
    }
    records.push(...parseTranscriptLines(content.split('\n')));
  }
  return records;
}
