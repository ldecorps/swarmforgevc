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
 *
 * BL-268: git log --name-status -- <pathspec> FILTERS to paths under
 * targetPath's subtree - passing process.cwd() as targetPath silently
 * dropped every cross-directory co-changer when run from a subdirectory
 * (exactly the coupling this tool exists to surface). Resolving the repo
 * top-level first and passing THAT as targetPath makes the history query
 * cwd-independent; each changedFiles arg is normalized the same way (cwd-
 * relative -> repo-root-relative) so it still exact-string-matches history
 * paths regardless of where the tool was invoked from.
 */
import * as path from 'path';
import { execFileSync } from 'child_process';
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

// Pure - a changed-file arg may be written relative to the invoker's cwd
// (e.g. "src/foo.ts" run from extension/), but git log --name-status paths
// (and computeCoChangeReport's exact-string matching against them) are
// always repo-root-relative. Resolving against cwd first, then re-relativizing
// to repoRoot, normalizes every input shape - already repo-root-relative,
// cwd-relative, or absolute - to the one form history entries use.
export function toRepoRelativePath(cwd: string, repoRoot: string, filePath: string): string {
  const absolute = path.resolve(cwd, filePath);
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

// The one impure lookup this fix adds - isolated so parseArgs/
// toRepoRelativePath/formatCoChangeReport stay pure and directly testable.
function resolveRepoRoot(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
}

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const cwd = process.cwd();
  const repoRoot = resolveRepoRoot(cwd);
  const history = runGitLog(repoRoot, '.');
  const changedFiles = args.changedFiles.map((file) => toRepoRelativePath(cwd, repoRoot, file));
  const report = computeCoChangeReport(changedFiles, history, args.options);
  console.log(formatCoChangeReport(report));
});

if (require.main === module) {
  runCliMain(main);
}
