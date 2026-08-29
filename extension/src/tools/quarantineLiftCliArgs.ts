/**
 * BL-1211 (scenarios 06-07): flag parsing for the operator-facing
 * quarantine-lift CLI - `--root <path> --by <role> [--branch <ref>]`.
 * `--branch` is optional; when absent the check falls back to the role's
 * own bouncing branch (bouncingBranchForRole), same default
 * quarantineLiftCheck itself already has.
 */
import { BounceRole, isKnownBounceRole } from '../quality/qaBounce';

export interface QuarantineLiftCliArgs {
  root: string;
  by: BounceRole;
  branch?: string;
}

export const USAGE = 'Usage: quarantine-lift-check --root <path> --by <role> [--branch <ref>]\n';

interface RawFlags {
  root?: string;
  by?: string;
  branch?: string;
}

// CRAP: a flag-name lookup table replaces an if/else-if chain per flag,
// keeping this function's own cyclomatic complexity (and therefore CRAP)
// low regardless of how many flags the CLI grows.
const FLAG_SETTERS: Record<string, (flags: RawFlags, value: string | undefined) => void> = {
  '--root': (flags, value) => { flags.root = value; },
  '--by': (flags, value) => { flags.by = value; },
  '--branch': (flags, value) => { flags.branch = value; },
};

function parseRawFlags(argv: string[]): RawFlags | null {
  const flags: RawFlags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const setter = FLAG_SETTERS[argv[i]];
    if (!setter) {
      return null;
    }
    setter(flags, argv[i + 1]);
    i += 1;
  }
  return flags;
}

function toQuarantineLiftCliArgs(flags: RawFlags): QuarantineLiftCliArgs | null {
  const { root, by, branch } = flags;
  if (!root || !by || !isKnownBounceRole(by)) {
    return null;
  }
  return { root, by, branch };
}

export function parseArgs(argv: string[]): QuarantineLiftCliArgs | null {
  const flags = parseRawFlags(argv);
  return flags ? toQuarantineLiftCliArgs(flags) : null;
}
