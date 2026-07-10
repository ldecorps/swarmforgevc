#!/usr/bin/env node
/**
 * BL-233 QA bounce (ddc0d351ed, "no orchestrator/report-writer ties slices
 * 1-4 together"): the recruiter's end-to-end entry point - the "report
 * writer" the ticket's own Scope line names. Discovers candidates,
 * acquires access (escalating wall candidates to a human), qualifies each
 * acquired candidate via the swarm-compliance battery, ranks compliant
 * candidates per role, and prints the combined per-role report (each
 * role's leaderboard plus its suggested swarmforge.conf --model line) as
 * JSON to stdout. Out-of-band tooling, same posture as BL-231's
 * compliance battery and recruiter-discover.ts - no worktree/mailbox/
 * pipeline role, no live swarm state touched, no swarmforge.conf mutation
 * (recommend.ts structurally cannot write it - see its own header).
 *
 * Usage: node recruiter-run.js <candidates-file> <signup-keys-file>
 *          <role-trials-file> <secrets-file> <current-models-file>
 *
 * Thin presenter over orchestrator.ts - no derivation logic here, same
 * posture as recruiter-discover.ts.
 */

import { createFileDiscoverySource } from '../recruiter/discoverySource';
import { readCurrentModelByRole, runRecruiterWithFileAdapters } from '../recruiter/runRecruiterFromFiles';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

export { readCurrentModelByRole };

export interface RecruiterRunArgs {
  candidatesFile: string;
  signupKeysFile: string;
  roleTrialsFile: string;
  secretsFile: string;
  currentModelsFile: string;
}

const USAGE =
  'Usage: recruiter-run.js <candidates-file> <signup-keys-file> <role-trials-file> <secrets-file> <current-models-file>\n';

// Pure - no process.argv/stderr/exitCode access here, so it is unit
// testable without the subprocess boundary main() itself needs. Same
// "keep main() a thin dispatcher over a testable pure helper" split
// trace-hop.ts already established for this codebase's other multi-arg CLIs.
// A single `files.some(...)` check over the five positional args (rather
// than a five-way `||` chain) so the required-ness check is one decision
// point here, not five - lower CRAP surface for the same behavior.
export function parseArgs(argv: string[]): RecruiterRunArgs | null {
  const [candidatesFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile] = argv;
  const files = [candidatesFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile];
  if (files.some((file) => !file)) {
    return null;
  }
  return { candidatesFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile };
}

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const report = await runRecruiterWithFileAdapters(createFileDiscoverySource(args.candidatesFile), args);
  printJsonToStdout(report);
});

if (require.main === module) {
  runCliMain(main);
}
