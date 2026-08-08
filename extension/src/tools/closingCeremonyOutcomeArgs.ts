// BL-820: flag parsing for closing-ceremony-outcome.js - the CLI the
// specifier's own lean pass calls to record the outcome that ends a
// ceremony run (process ticket / spec-gate tweak / explicit no-change).
// `--ref` is required for the two outcome types that name a concrete
// change (human decision 7: reversible from the record alone); `no_change`
// takes none because there is nothing to reverse.
import { parseFlagPairs } from './bounceArgsCore';
import { isKnownCeremonyOutcomeType, isValidShiftKey, CeremonyOutcomeType } from '../quality/closingCeremony';

export interface ClosingCeremonyOutcomeArgs {
  shift: string;
  outcomeType: CeremonyOutcomeType;
  ref?: string;
  target?: string;
  at?: string;
}

const FLAG_NAMES = ['--shift', '--outcome', '--ref', '--target', '--at'] as const;

function isValidShiftOutcomeRef(shift: string | undefined, outcome: string | undefined, ref: string | undefined): boolean {
  if (!isValidShiftKey(shift)) {
    return false;
  }
  if (!outcome || !isKnownCeremonyOutcomeType(outcome)) {
    return false;
  }
  return outcome === 'no_change' || !!ref;
}

export function parseArgs(argv: string[]): ClosingCeremonyOutcomeArgs | null {
  const flags = parseFlagPairs(argv, FLAG_NAMES);
  if (!flags) {
    return null;
  }
  const { '--shift': shift, '--outcome': outcome, '--ref': ref, '--target': target, '--at': at } = flags;
  if (!isValidShiftOutcomeRef(shift, outcome, ref)) {
    return null;
  }
  const args: ClosingCeremonyOutcomeArgs = { shift: shift as string, outcomeType: outcome as CeremonyOutcomeType };
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
