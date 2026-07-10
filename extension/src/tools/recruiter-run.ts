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

function readCurrentModelByRole(currentModelsFile: string): Record<string, string> {
  if (!fs.existsSync(currentModelsFile)) {
    return {};
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(currentModelsFile, 'utf-8'));
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
}

export async function main(): Promise<void> {
  const [candidatesFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile] = process.argv.slice(2);
  if (!candidatesFile || !signupKeysFile || !roleTrialsFile || !secretsFile || !currentModelsFile) {
    process.stderr.write(
      'Usage: recruiter-run.js <candidates-file> <signup-keys-file> <role-trials-file> <secrets-file> <current-models-file>\n'
    );
    process.exitCode = 1;
    return;
  }

  const report = await runRecruiter({
    discovery: createFileDiscoverySource(candidatesFile),
    signup: createFileSignupSource(signupKeysFile),
    secretStore: createFileSecretStore(secretsFile),
    trialRunner: createFileRoleTrialRunner(roleTrialsFile),
    battery: createComplianceBatteryGate(),
    currentModelByRole: readCurrentModelByRole(currentModelsFile),
  });
  printJsonToStdout(report);
}

if (require.main === module) {
  runCliMain(main);
}
