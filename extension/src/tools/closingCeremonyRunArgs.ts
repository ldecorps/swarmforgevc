// BL-820: flag parsing for closing-ceremony-run.js. `--target` and `--at`
// are explicit injected seams (constitution: "CLI main() is a thin
// wrapper... inject side effects, not *_FORCE_RESULT env bypasses") so
// main() is testable in-process against a fixture directory with a fixed
// clock, mirroring leanLedgerRecordArgs.ts.
import { parseFlagPairs } from './bounceArgsCore';

export interface ClosingCeremonyRunArgs {
  target?: string;
  at?: string;
}

const FLAG_NAMES = ['--target', '--at'] as const;

export function parseArgs(argv: string[]): ClosingCeremonyRunArgs | null {
  const flags = parseFlagPairs(argv, FLAG_NAMES);
  if (!flags) {
    return null;
  }
  const { '--target': target, '--at': at } = flags;
  const args: ClosingCeremonyRunArgs = {};
  if (target !== undefined) {
    args.target = target;
  }
  if (at !== undefined) {
    args.at = at;
  }
  return args;
}

export const USAGE = 'Usage: closing-ceremony-run.js [--target <path>] [--at <iso-timestamp>]\n';
