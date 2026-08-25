/**
 * BL-1014 — Boy Scout slice 1: a deterministic, read-only scan that ranks
 * technical debt by RECURRENCE across the five evidence sources this repo
 * already keeps.
 *
 * Why recurrence and not severity: debt that costs once is just debt. Debt
 * that costs again and again is what the operator experiences as annoying,
 * and it is the only definition of "most annoying" that is measurable rather
 * than re-argued every run. Severity would be a fresh judgement call each
 * time, which invariant 1 (deterministic) forbids outright.
 *
 * Scope boundary: this slice RANKS and REPORTS. It never edits, never mints a
 * ticket and never cleans - that is BL-1015. Everything here is pure over
 * already-read data except the readers in ./readers.ts, which only read.
 *
 * Module layout (split from one file per BL-485's mutation-site-size check -
 * this is a behavior-preserving split along the Architecture Rules' own
 * seam of policy vs IO, not a line-count chop):
 *   ./types.ts    - shared interfaces
 *   ./rank.ts     - the rank key (pure)
 *   ./parsers.ts  - the five source parsers (pure over already-read data)
 *   ./report.ts   - the report renderer (pure)
 *   ./readers.ts  - the only IO, and it only reads
 *   ./scan.ts     - wires parsers to readers through an injected seam
 *   ./index.ts    - this file: the CLI entry, and the public surface
 */

import * as path from 'path';
import { scan } from './scan';
import { renderReport } from './report';

export * from './types';
export { mergeBySubject, rankInventory } from './rank';
export {
  normalizeSubject,
  parseHardeningLedger,
  parseBounceRecords,
  parseCrapReport,
  parseDuplicationReport,
  summarizeRuntimeBloat,
} from './parsers';
export { renderReport, EVIDENCE_SAMPLE } from './report';
export {
  readHardeningLedger,
  readBounceLines,
  readCrapReport,
  readDuplicationReport,
  readCountedPaths,
  defaultReaders,
  BLOAT_THRESHOLDS,
} from './readers';
export { scan } from './scan';

/**
 * CLI entry. Deliberately thin - it resolves a root, calls `scan`, and prints.
 * Everything worth testing is above and is exercised in-process.
 */
export function main(argv: string[] = process.argv.slice(2), cwd: string = process.cwd()): number {
  const root = argv[0] ? path.resolve(argv[0]) : cwd;
  const result = scan(root);
  process.stdout.write(renderReport(result));
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
