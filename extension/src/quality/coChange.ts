// BL-255 (operator intake 2026-07-10): automates the architect's manual
// Feathers co-change check (architect.prompt:32-37) - files that
// repeatedly change together in the same commit are logically coupled
// even with no static import link (Michael Feathers, "Using Repository
// Analysis to Find Single Responsibility Violations"). File-level MVP
// only; method-level clustering is a later slice, per the specifier's
// scope decision.
//
// REUSE: takes GitLogEntry[] directly - the SAME injectable seam BL-096's
// delivery metrics already established (gitHistoryAdapter.ts's
// parseGitLog/runGitLog). No second git-log parser; every unit test here
// feeds a hand-built GitLogEntry[] fixture, never real git.
//
// INFORMS, does not gate: this module only computes and ranks; the
// architect makes the pass/bounce judgment (no auto-bounce here or in the
// CLI that wraps it).
import { GitLogEntry } from '../metrics/gitHistoryAdapter';

export interface CoChangeOptions {
  // Feathers' own reference point ("group size > 2 and frequency > 3");
  // sensible defaults, always tunable - never hardcoded past this object.
  minFrequency: number;
  minGroupSize: number;
  // undefined = full history; N = only the N most recent commits (by date).
  windowCommits?: number;
}

export const DEFAULT_CO_CHANGE_OPTIONS: CoChangeOptions = { minFrequency: 3, minGroupSize: 2 };

export interface CoChangeCount {
  file: string;
  count: number;
  coupled: boolean;
}

export interface CoChangeReport {
  file: string;
  coChangers: CoChangeCount[];
}

// Newest-first, then bounded to the window (minGroupSize filters commits
// whose OWN file count is too small to be trustworthy coupling evidence -
// e.g. a single-file commit trivially has no co-changer at all).
function windowedFileSets(history: GitLogEntry[], options: CoChangeOptions): string[][] {
  const sorted = [...history].sort((a, b) => Date.parse(b.dateIso) - Date.parse(a.dateIso));
  const windowed = options.windowCommits !== undefined ? sorted.slice(0, options.windowCommits) : sorted;
  return windowed.map((entry) => entry.changes.map((change) => change.path)).filter((paths) => paths.length >= options.minGroupSize);
}

function rankCoChangers(file: string, fileSets: string[][], minFrequency: number): CoChangeCount[] {
  const counts = new Map<string, number>();
  for (const paths of fileSets) {
    if (!paths.includes(file)) {
      continue;
    }
    for (const other of paths) {
      if (other === file) {
        continue;
      }
      counts.set(other, (counts.get(other) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([otherFile, count]) => ({ file: otherFile, count, coupled: count >= minFrequency }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

export function computeCoChangeReport(
  changedFiles: string[],
  history: GitLogEntry[],
  options: CoChangeOptions = DEFAULT_CO_CHANGE_OPTIONS
): CoChangeReport[] {
  const fileSets = windowedFileSets(history, options);
  return changedFiles.map((file) => ({ file, coChangers: rankCoChangers(file, fileSets, options.minFrequency) }));
}
