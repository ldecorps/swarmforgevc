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

export function parseArgs(argv: string[]): QuarantineLiftCliArgs | null {
  let root: string | undefined;
  let by: string | undefined;
  let branch: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--root') {
      root = value;
      i += 1;
    } else if (flag === '--by') {
      by = value;
      i += 1;
    } else if (flag === '--branch') {
      branch = value;
      i += 1;
    } else {
      return null;
    }
  }
  if (!root || !by || !isKnownBounceRole(by)) {
    return null;
  }
  return { root, by, branch };
}
