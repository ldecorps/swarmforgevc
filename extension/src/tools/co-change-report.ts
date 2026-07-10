#!/usr/bin/env node
/**
 * BL-255: the co-change coupling tool - automates the architect's manual
 * Feathers check (architect.prompt:32-37). Given the parcel's changed
 * files, reports which OTHER files most often co-changed with them across
 * git history, ranked by co-occurrence count, flagging pairs at or above
 * the tunable frequency threshold as suspected logical coupling. INFORMS
 * only - the architect still makes the pass/bounce judgment; this never
 * auto-bounces anything.
 *
 * Usage: node co-change-report.js [--min-frequency=N] [--min-group-size=N]
 *          [--window=N] <changed-file> [<changed-file> ...]
 *
 * Runnable from anywhere inside the git repo whose history should be
 * analyzed - no .swarmforge/roles.tsv dependency (unlike swarm-metrics.ts/
 * queue-status.ts), since this is a general git-history tool, not
 * swarm-specific. Read-only, headless.
 */
import { runGitLog } from '../metrics/gitHistoryAdapter';
import { computeCoChangeReport, CoChangeOptions, CoChangeReport, DEFAULT_CO_CHANGE_OPTIONS } from '../quality/coChange';
import { makeArgsGuardedMain, runCliMain } from './swarm-metrics';

export interface CoChangeCliArgs {
  changedFiles: string[];
  options: CoChangeOptions;
}

const USAGE =
  'Usage: co-change-report.js [--min-frequency=N] [--min-group-size=N] [--window=N] <changed-file> [<changed-file> ...]\n';

// Pure - same "keep main() a thin dispatcher over a testable pure helper"
// split this codebase's other CLIs already established, so a
// subprocess-only test would never leave this logic coverage-invisible.
export function parseArgs(argv: string[]): CoChangeCliArgs | null {
  const changedFiles: string[] = [];
  const options: CoChangeOptions = { ...DEFAULT_CO_CHANGE_OPTIONS };
  for (const arg of argv) {
    if (arg.startsWith('--min-frequency=')) {
      options.minFrequency = Number(arg.slice('--min-frequency='.length));
    } else if (arg.startsWith('--min-group-size=')) {
      options.minGroupSize = Number(arg.slice('--min-group-size='.length));
    } else if (arg.startsWith('--window=')) {
      options.windowCommits = Number(arg.slice('--window='.length));
    } else {
      changedFiles.push(arg);
    }
  }
  return changedFiles.length > 0 ? { changedFiles, options } : null;
}

function formatCoChanger(entry: { file: string; count: number; coupled: boolean }): string {
  const suffix = entry.coupled ? ' (SUSPECTED COUPLING)' : '';
  return `  ${entry.file}: ${entry.count} co-change(s)${suffix}`;
}

export function formatCoChangeReport(report: CoChangeReport[]): string {
  return report
    .map((r) => {
      const lines = r.coChangers.length > 0 ? r.coChangers.map(formatCoChanger) : ['  (no co-changers found)'];
      return [`${r.file}:`, ...lines].join('\n');
    })
    .join('\n\n');
}

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const history = runGitLog(process.cwd(), '.');
  const report = computeCoChangeReport(args.changedFiles, history, args.options);
  console.log(formatCoChangeReport(report));
});

if (require.main === module) {
  runCliMain(main);
}
