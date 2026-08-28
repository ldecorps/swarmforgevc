#!/usr/bin/env node
/**
 * BL-1211 architect bounce (D1, 2026-08-28): the operator-facing entry
 * point for filterRecoveryPaths (src/metrics/bounceResurrectionGitAdapter.ts)
 * - the required_wiring entry the first pass shipped without: "a recovery
 * that cannot consult the filter still resurrects bounced content" is the
 * exact BL-1189 incident this ticket exists to prevent, and until now
 * nothing operator-facing called this half of the fix. Thin wrapper only:
 * all decision logic stays in filterRecoveryPaths/decideRecoveryFilter.
 *
 * Exit 0 when every candidate path is safe to restore; exit 1 when at
 * least one is held back, so a caller can tell "restore all of these
 * verbatim" from "check the decisions before restoring" without parsing
 * the JSON.
 *
 * Usage: node recovery-filter-check.js --root <path> --by <role> --sibling <ref> --paths <comma-separated>
 */
import { filterRecoveryPaths } from '../metrics/bounceResurrectionGitAdapter';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';
import { parseArgs, USAGE, RecoveryFilterCliArgs } from './recoveryFilterCliArgs';

// Re-export for tests
export { parseArgs, RecoveryFilterCliArgs };

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const decisions = filterRecoveryPaths(args.root, args.by, args.sibling, args.paths);
  printJsonToStdout(decisions);
  if (decisions.some((d) => !d.restore)) {
    process.exitCode = 1;
  }
});

if (require.main === module) {
  runCliMain(main);
}
