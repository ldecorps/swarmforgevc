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

export function parseArgs(argv: string[]): RecoveryFilterCliArgs | null {
  let root: string | undefined;
  let by: string | undefined;
  let sibling: string | undefined;
  let paths: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--root') {
      root = value;
      i += 1;
    } else if (flag === '--by') {
      by = value;
      i += 1;
    } else if (flag === '--sibling') {
      sibling = value;
      i += 1;
    } else if (flag === '--paths') {
      paths = value;
      i += 1;
    } else {
      return null;
    }
  }
  if (!root || !by || !isKnownBounceRole(by) || !sibling || !paths) {
    return null;
  }
  const pathList = paths.split(',').filter((p) => p.length > 0);
  if (pathList.length === 0) {
    return null;
  }
  return { root, by, sibling, paths: pathList };
}
