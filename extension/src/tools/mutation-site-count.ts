#!/usr/bin/env node
/**
 * BL-485: the cleaner's count-only mutation-site helper - reports each
 * changed file's mutation-site count from its compiled out/ counterpart,
 * WITHOUT running the test-per-mutant loop. Stryker (installed 9.6.1) has
 * no built-in "count mutants without executing them" mode - even its own
 * --dryRunOnly still runs the full test suite once for coverage. The
 * genuine count-only mechanism is @stryker-mutator/instrumenter's pure
 * AST-instrumentation step directly (the SAME step Stryker's own
 * MutantInstrumenterExecutor calls internally, before any sandbox/test-
 * runner/checker-pool machinery ever starts) - this wrapper owns only that
 * real Instrumenter + filesystem wiring; mutationSiteCount.ts's
 * countMutationSites/verdictFor own the count/mapping/threshold logic.
 *
 * The entrypoint-boilerplate ignorer (extension/stryker.config.json's own
 * "ignorers": ["entrypoint-boilerplate"]) is wired in here too, so this
 * count matches what the real hardener mutation gate would actually count
 * against - without it every CLI-entrypoint module would overcount by its
 * fixed require.main/__esModule boilerplate residue (BL-447).
 *
 * Usage:
 *   node mutation-site-count.js [--threshold N] <file> [<file> ...]
 *
 * <file> paths are repo-root-relative (e.g. "extension/src/quality/foo.ts"),
 * matching this project's other changed-file-list tools (dependency-gate.js,
 * co-change-report.js) - the caller (the cleaner, via its own `git diff`)
 * supplies the list; this tool never computes it itself. --threshold is the
 * upstream ~100 starting point by default, overridable - the production
 * value and whether the gate is HARD or SOFT are cleaner.prompt's own
 * governance call (BL-485's approval_context), not baked in here: this CLI
 * only reports counts + a within/over verdict, never enforces one.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import type { Logger } from '@stryker-mutator/api/logging';
import { EntrypointBoilerplateIgnorer } from '../mutation/entrypointBoilerplateIgnorer';
import { countMutationSites, verdictFor, MutationSiteCountAdapters } from '../quality/mutationSiteCount';
import { runCliMain, printJsonToStdout } from './swarm-metrics';

// extension/out/tools/ -> repo root.
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const DEFAULT_THRESHOLD = 100;

const NOOP_LOGGER: Logger = {
  isTraceEnabled: () => false,
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => false,
  isErrorEnabled: () => false,
  isFatalEnabled: () => false,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

export interface MutationSiteCountCliArgs {
  threshold: number;
  files: string[];
}

// Pure - '--threshold N' may appear anywhere among the positional file
// args; every remaining argument is a changed-file path.
export function parseArgs(argv: string[]): MutationSiteCountCliArgs {
  const flagIndex = argv.indexOf('--threshold');
  if (flagIndex === -1) {
    return { threshold: DEFAULT_THRESHOLD, files: argv };
  }
  const threshold = Number(argv[flagIndex + 1]);
  const files = [...argv.slice(0, flagIndex), ...argv.slice(flagIndex + 2)];
  return { threshold: Number.isFinite(threshold) ? threshold : DEFAULT_THRESHOLD, files };
}

// Real wiring: instruments already-read file contents and counts the
// resulting mutants per fileName - a pure AST transform, no sandbox, no
// test runner, no subprocess. mutate: true instruments the WHOLE file
// (this helper counts sites, it never scopes to a sub-range).
//
// instrument()'s raw result includes EVERY generated mutant regardless of
// its ignorer - an ignorer only ATTACHES ignoreReason/status:'Ignored'
// metadata (instrumenter's own Mutant#toApiMutant), it does not drop the
// mutant from the returned list (verified empirically: instrumenting with
// vs. without the entrypoint-boilerplate ignorer produced the identical
// mutant count until this filter was added). A real Stryker run reads
// that SAME status field to exclude an Ignored mutant from testing and
// reporting, so filtering on it here is what makes this count match what
// the real hardener mutation gate would actually count against, not an
// inflated one.
async function countMutantsPerFileReal(
  files: ReadonlyArray<{ path: string; content: string }>
): Promise<Record<string, number>> {
  const instrumenter = new Instrumenter(NOOP_LOGGER);
  const result = await instrumenter.instrument(
    files.map((f) => ({ name: f.path, mutate: true, content: f.content })),
    { plugins: null, ignorers: [new EntrypointBoilerplateIgnorer()], excludedMutations: [] }
  );
  const counts: Record<string, number> = {};
  for (const file of files) {
    counts[file.path] = 0;
  }
  for (const mutant of result.mutants) {
    if (mutant.status === 'Ignored') {
      continue;
    }
    counts[mutant.fileName] = (counts[mutant.fileName] ?? 0) + 1;
  }
  return counts;
}

export const realAdapters: MutationSiteCountAdapters = {
  readOutFile: (outPath: string) => {
    const absolute = path.isAbsolute(outPath) ? outPath : path.join(PROJECT_ROOT, outPath);
    return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : undefined;
  },
  countMutantsPerFile: countMutantsPerFileReal,
};

export async function main(): Promise<void> {
  const { threshold, files } = parseArgs(process.argv.slice(2));
  if (files.length === 0) {
    process.stderr.write('Usage: mutation-site-count.js [--threshold N] <file> [<file> ...]\n');
    process.exitCode = 1;
    return;
  }
  const counts = await countMutationSites(files, realAdapters);
  const report = counts.map((c) => ({ ...c, verdict: verdictFor(c.siteCount, threshold) }));
  printJsonToStdout({ threshold, files: report });
}

if (require.main === module) {
  runCliMain(main);
}
