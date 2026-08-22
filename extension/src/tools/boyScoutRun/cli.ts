/**
 * BL-1015 — the CLI entrypoint: resolve a root, run, print. Split out of
 * `boyScoutRun.ts` (BL-485 mutation-site size).
 */

import * as path from 'path';

import { renderRunReport } from './report';
import type { RunEnvironment } from './types';
import { boyScoutRun } from '../boyScoutRun';

/**
 * Thin wrapper over `boyScoutRun`/`renderRunReport`: resolve a root, run,
 * print. Exit 0 whenever the run produced a RESULT — a refusal is a
 * successful run that reported a reason — and 1 only when the run could not
 * complete at all.
 */
export function main(
  argv: string[] = process.argv.slice(2),
  cwd: string = process.cwd(),
  overrides: Partial<RunEnvironment> = {}
): number {
  const root = argv[0] ? path.resolve(cwd, argv[0]) : cwd;
  try {
    process.stdout.write(renderRunReport(boyScoutRun(root, overrides)));
    return 0;
  } catch (err) {
    process.stderr.write(`boy scout run failed: ${(err as Error).message}\n`);
    return 1;
  }
}
