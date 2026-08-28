#!/usr/bin/env node
/**
 * BL-1211 (scenarios 06-07): the operator-facing entry point for
 * quarantineLiftCheck (src/metrics/bounceResurrectionGitAdapter.ts) - lets
 * an operator reach the lift verdict without writing code. Thin wrapper
 * only: all decision logic stays in quarantineLiftCheck/decideQuarantineLift.
 *
 * Exit 0 + granted:true on a lift; exit 1 + granted:false on a refusal -
 * including the fail-closed "could not decide" shape (refusedTickets
 * non-empty, refusedPaths empty) so a caller can tell "explicitly refused"
 * from "refused because it could not decide" without parsing prose.
 *
 * Usage: node quarantine-lift-check.js --root <path> --by <role> [--branch <ref>]
 */
import { quarantineLiftCheck } from '../metrics/bounceResurrectionGitAdapter';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';
import { parseArgs, USAGE, QuarantineLiftCliArgs } from './quarantineLiftCliArgs';

// Re-export for tests
export { parseArgs, QuarantineLiftCliArgs };

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const verdict = quarantineLiftCheck(args.root, args.by, args.branch);
  printJsonToStdout(verdict);
  if (!verdict.granted) {
    process.exitCode = 1;
  }
});

if (require.main === module) {
  runCliMain(main);
}
