import * as fs from 'fs';
import * as path from 'path';
import { classifyTranscriptText, walkTranscriptText } from './transcriptWalker';
import type { ClassifiedInterval } from './transcriptWalker';

/**
 * BL-1476: a persisted per-transcript verdict, keyed by absolute path, so a
 * tick can skip re-reading a file whose size and mtime still match what was
 * last summarised (invariant 2). `intervals` are the RAW per-file walk
 * result (walkTranscriptText's own output, stage never attached - stage
 * comes from whichever group's listing the path currently sits in, applied
 * fresh every tick so a role-worktree reassignment is never stale). Absent
 * for an unreadable file (nothing to walk).
 *
 * Split out of turnProfileProducer.ts (cleaner pass, same ticket): the
 * summary store's own persistence and freshness-check is a distinct concern
 * from window-record assembly, and BL-1476 nearly doubled the producer
 * file's mutation-site count (BL-485) - this half has no dependency on
 * window/series assembly at all, only on the walker's per-file primitives.
 */
export interface TranscriptSummary {
  size: number;
  mtimeMs: number;
  unreadable: boolean;
  truncatedTail: boolean;
  intervals: ClassifiedInterval[];
}

export type TranscriptSummaryStore = Record<string, TranscriptSummary>;

export const TURN_PROFILE_SUMMARY_STORE_FILE = 'turn-profile-transcript-summaries.json';

export function turnProfileSummaryStorePath(telemetryDir: string): string {
  return path.join(telemetryDir, TURN_PROFILE_SUMMARY_STORE_FILE);
}

// The `'utf8'` encoding argument here and in writeTranscriptSummaryStore
// below is an equivalent mutant target (Stryker StringLiteral -> ''):
// empirically verified (including multi-byte content) that Node's fs
// module treats a falsy/empty encoding the same as 'utf8' for both
// readFileSync and writeFileSync, and JSON.parse coerces the resulting
// Buffer via its own ToString - no test could ever observe a difference
// through this round trip (BL-1081 !x/typeof-guard equivalence class).
export function readTranscriptSummaryStore(telemetryDir: string): TranscriptSummaryStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(turnProfileSummaryStorePath(telemetryDir), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as TranscriptSummaryStore) : {};
  } catch {
    return {};
  }
}

export function writeTranscriptSummaryStore(telemetryDir: string, store: TranscriptSummaryStore): void {
  fs.mkdirSync(telemetryDir, { recursive: true });
  fs.writeFileSync(turnProfileSummaryStorePath(telemetryDir), JSON.stringify(store), 'utf8');
}

export function statOrNull(filePath: string): { size: number; mtimeMs: number } | null {
  try {
    const stat = fs.statSync(filePath);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

export function summaryIsCurrent(
  summary: TranscriptSummary | undefined,
  stat: { size: number; mtimeMs: number }
): summary is TranscriptSummary {
  return !!summary && summary.size === stat.size && summary.mtimeMs === stat.mtimeMs;
}

/** One read per changed file, not two: readability and the walk consume the same text. */
export function computeTranscriptSummary(
  filePath: string,
  stat: { size: number; mtimeMs: number },
  readFn: (path: string) => string
): TranscriptSummary {
  let text: string;
  try {
    text = readFn(filePath);
  } catch {
    return { size: stat.size, mtimeMs: stat.mtimeMs, unreadable: true, truncatedTail: false, intervals: [] };
  }
  const verdict = classifyTranscriptText(text);
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    unreadable: verdict.unreadable,
    truncatedTail: verdict.truncatedTail,
    intervals: verdict.unreadable ? [] : walkTranscriptText(text),
  };
}
