/**
 * BL-1211 architect bounce (D1, 2026-08-28): flag parsing for the
 * operator-facing recovery-filter CLI -
 * `--root <path> --by <role> --sibling <ref> --paths <comma-separated>`.
 * Mirrors quarantineLiftCliArgs.ts's shape for the sibling verb.
 */
import { BounceRole, isKnownBounceRole } from '../quality/qaBounce';

export interface RecoveryFilterCliArgs {
  root: string;
  by: BounceRole;
  sibling: string;
  paths: string[];
}

export const USAGE = 'Usage: recovery-filter-check --root <path> --by <role> --sibling <ref> --paths <comma-separated>\n';

interface RawFlags {
  root?: string;
  by?: string;
  sibling?: string;
  paths?: string;
}

// CRAP: a flag-name lookup table replaces an if/else-if chain per flag,
// keeping this function's own cyclomatic complexity (and therefore CRAP)
// low regardless of how many flags the CLI grows.
const FLAG_SETTERS: Record<string, (flags: RawFlags, value: string | undefined) => void> = {
  '--root': (flags, value) => { flags.root = value; },
  '--by': (flags, value) => { flags.by = value; },
  '--sibling': (flags, value) => { flags.sibling = value; },
  '--paths': (flags, value) => { flags.paths = value; },
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

// Split out of toRecoveryFilterCliArgs so each function's own cyclomatic
// complexity (and therefore CRAP) stays low: every required flag was
// actually given a value.
function hasRequiredStrings(flags: RawFlags): flags is Required<RawFlags> {
  return !!flags.root && !!flags.by && !!flags.sibling && !!flags.paths;
}

// A comma-separated flag value that splits into nothing but empty
// segments (e.g. ",,") has no real path in it.
function nonEmptyPathList(paths: string): string[] | null {
  const pathList = paths.split(',').filter((p) => p.length > 0);
  return pathList.length > 0 ? pathList : null;
}

function toRecoveryFilterCliArgs(flags: RawFlags): RecoveryFilterCliArgs | null {
  if (!hasRequiredStrings(flags) || !isKnownBounceRole(flags.by)) {
    return null;
  }
  const pathList = nonEmptyPathList(flags.paths);
  return pathList ? { root: flags.root, by: flags.by, sibling: flags.sibling, paths: pathList } : null;
}

export function parseArgs(argv: string[]): RecoveryFilterCliArgs | null {
  const flags = parseRawFlags(argv);
  return flags ? toRecoveryFilterCliArgs(flags) : null;
}
