// BL-233 QA bounce follow-up (ddc0d351ed): the CLI orchestrator needs SOME
// production RoleTrialRunner. Mirrors discoverySource.ts's/signupSource.ts's
// own established choice: rather than build a live harness that drives an
// arbitrary candidate model through a representative task per swarm role
// (an undertaking nothing in the ticket specifies - no task definitions,
// no timeout/sandbox model), this resolves each candidate's recorded
// per-role battery gate args from an operator-maintained JSON map
// (model -> { role -> gateArgs }), populated by whatever process actually
// ran the trial (manual today; a future harness could fill the same seam
// later without touching qualify.ts/orchestrator.ts).

import * as fs from 'fs';
import { ModelCandidate, RoleTrial, RoleTrialRunner } from './candidate';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function createFileRoleTrialRunner(trialsFilePath: string): RoleTrialRunner {
  return {
    async runTrials(candidate: ModelCandidate): Promise<RoleTrial[]> {
      if (!fs.existsSync(trialsFilePath)) {
        return [];
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(trialsFilePath, 'utf-8'));
      const byRole =
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)[candidate.model] : undefined;
      if (typeof byRole !== 'object' || byRole === null) {
        return [];
      }
      return Object.entries(byRole as Record<string, unknown>)
        .filter((entry): entry is [string, string[]] => isStringArray(entry[1]))
        .map(([role, gateArgs]) => ({ role, gateArgs }));
    },
  };
}
