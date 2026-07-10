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

import * as fs from 'fs';
import { createComplianceBatteryGate } from '../recruiter/complianceBatteryGate';
import { createFileDiscoverySource } from '../recruiter/discoverySource';
import { runRecruiter } from '../recruiter/orchestrator';
import { createFileRoleTrialRunner } from '../recruiter/roleTrialRunner';
import { createFileSecretStore } from '../recruiter/secretStore';
import { createFileSignupSource } from '../recruiter/signupSource';
import { printJsonToStdout, runCliMain } from './swarm-metrics';

// Exported so it can be unit tested directly (in-process) rather than only
// through the subprocess CLI test - same posture as secretStore.ts's own
// readExisting, which is covered because its caller (store()) is always
// invoked in-process. A CLI main() run only via execFileSync never shows up
// under coverage instrumentation, so any real logic left inline in main()
// is invisible to the CRAP gate; hardener split (BL-233 hardening pass).
export function readCurrentModelByRole(currentModelsFile: string): Record<string, string> {
  if (!fs.existsSync(currentModelsFile)) {
    return {};
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(currentModelsFile, 'utf-8'));
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
}

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

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }

  const report = await runRecruiter({
    discovery: createFileDiscoverySource(args.candidatesFile),
    signup: createFileSignupSource(args.signupKeysFile),
    secretStore: createFileSecretStore(args.secretsFile),
    trialRunner: createFileRoleTrialRunner(args.roleTrialsFile),
    battery: createComplianceBatteryGate(),
    currentModelByRole: readCurrentModelByRole(args.currentModelsFile),
  });
  printJsonToStdout(report);
}

if (require.main === module) {
  runCliMain(main);
}
