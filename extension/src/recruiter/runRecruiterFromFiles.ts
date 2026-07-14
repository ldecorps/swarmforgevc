// Shared by recruiter-run.ts and bakeoff-run.ts: both wire the SAME five
// file-backed production adapters (signup/secret-store/role-trials/battery/
// current-models) into runRecruiter, differing only in which DiscoverySource
// they supply (createFileDiscoverySource vs createFileRosterSource). Keeps
// orchestrator.ts itself free of any fs-touching adapter construction (its
// own header: "PURE composition, no new business logic").

import * as fs from 'fs';
import { createComplianceBatteryGate } from './complianceBatteryGate';
import { DiscoverySource } from './discoverySource';
import { RecruiterReport, runRecruiter } from './orchestrator';
import { createFileRoleTrialRunner } from './roleTrialRunner';
import { createFileSecretStore } from './secretStore';
import { createFileSignupSource } from './signupSource';

export function readCurrentModelByRole(currentModelsFile: string): Record<string, string> {
  if (!fs.existsSync(currentModelsFile)) {
    return {};
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(currentModelsFile, 'utf-8'));
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
}

export interface FileAdapterArgs {
  signupKeysFile: string;
  roleTrialsFile: string;
  secretsFile: string;
  currentModelsFile: string;
}

export async function runRecruiterWithFileAdapters(discovery: DiscoverySource, args: FileAdapterArgs): Promise<RecruiterReport> {
  return runRecruiter({
    discovery,
    signup: createFileSignupSource(args.signupKeysFile),
    secretStore: createFileSecretStore(args.secretsFile),
    trialRunner: createFileRoleTrialRunner(args.roleTrialsFile),
    battery: createComplianceBatteryGate(),
    currentModelByRole: readCurrentModelByRole(args.currentModelsFile),
  });
}
