// BL-820: flag parsing for closing-ceremony-outcome.js - the CLI the
// specifier's own lean pass calls to record the outcome that ends a
// ceremony run (process ticket / spec-gate tweak / explicit no-change).
// `--ref` is required for the two outcome types that name a concrete
// change (human decision 7: reversible from the record alone); `no_change`
// takes none because there is nothing to reverse.
import { parseFlagPairs } from './bounceArgsCore';
import { isKnownCeremonyOutcomeType, CeremonyOutcomeType } from '../quality/closingCeremony';

export interface ClosingCeremonyOutcomeArgs {
  shift: string;
  outcomeType: CeremonyOutcomeType;
  ref?: string;
  target?: string;
  at?: string;
}

const SHIFT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FLAG_NAMES = ['--shift', '--outcome', '--ref', '--target', '--at'] as const;

export function parseArgs(argv: string[]): ClosingCeremonyOutcomeArgs | null {
  const flags = parseFlagPairs(argv, FLAG_NAMES);
  if (!flags) {
    return null;
  }
  const { '--shift': shift, '--outcome': outcome, '--ref': ref, '--target': target, '--at': at } = flags;
  if (!shift || !SHIFT_PATTERN.test(shift)) {
    return null;
  }
  if (!outcome || !isKnownCeremonyOutcomeType(outcome)) {
    return null;
  }
  if (outcome !== 'no_change' && !ref) {
    return null;
  }
  const args: ClosingCeremonyOutcomeArgs = { shift, outcomeType: outcome };
  if (ref !== undefined) {
    args.ref = ref;
  }
  if (target !== undefined) {
    args.target = target;
  }
  if (at !== undefined) {
    args.at = at;
  }
  return args;
}

export const USAGE = 'Usage: closing-ceremony-outcome.js --shift <yyyy-MM-dd> --outcome <process_ticket|spec_gate_tweak|no_change> [--ref <id>] [--target <path>] [--at <iso-timestamp>]\n';
