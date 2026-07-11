#!/usr/bin/env node
/**
 * BL-262 slice 1: the build-start gate the coordinator consults before its
 * first promotion for a target. Reads <target-repo-path>/.swarmforge/contract.yaml
 * (absent -> 'missing') and prints the pure evaluateBuildStartGate decision as
 * JSON: {"decision":"allow"} or {"decision":"hold","reason":"..."}. Never
 * throws on a missing/malformed contract - fail-closed is a `hold` result,
 * not a crash (BL-099 missing-data posture).
 *
 * Usage: node onboarding-contract-gate.js <target-repo-path>
 */
import * as fs from 'fs';
import * as path from 'path';
import { evaluateBuildStartGate } from '../onboarding/buildStartGate';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

// Exported (like bakeoff-run.ts's own parseArgs) so it runs in-process
// under coverage instead of only via the compiled CLI's subprocess.
export function parseArgs(argv: string[]): { targetRepoPath: string } | null {
  const [targetRepoPath] = argv;
  return targetRepoPath ? { targetRepoPath } : null;
}

function readContractYaml(targetRepoPath: string): string | undefined {
  const contractPath = path.join(targetRepoPath, '.swarmforge', 'contract.yaml');
  try {
    return fs.readFileSync(contractPath, 'utf8');
  } catch {
    return undefined;
  }
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node onboarding-contract-gate.js <target-repo-path>\n',
  async ({ targetRepoPath }) => {
    const rawContractYaml = readContractYaml(targetRepoPath);
    printJsonToStdout(evaluateBuildStartGate(rawContractYaml));
  }
);

if (require.main === module) {
  runCliMain(main);
}
