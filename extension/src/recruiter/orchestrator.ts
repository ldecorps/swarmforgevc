// BL-233 QA bounce (ddc0d351ed, "no orchestrator/report-writer ties slices
// 1-4 together"): runRecruiter is the missing "report writer" the
// ticket's own Scope line names. Every slice (discovery, acquire, qualify,
// rank, recommend) landed as an individually-tested, individually-correct
// function, but nothing chained them end-to-end - each slice's own
// acceptance steps built their own mid-pipeline fixture data rather than
// piping one slice's real output into the next. This file is PURE
// composition: no new business logic, every decision (compliance
// filtering, capability ordering, escalation, config-line wording)
// already lives in acquire.ts/qualify.ts/rank.ts/recommend.ts.
//
// Role grouping: a candidate's BatteryScorecard entries are keyed
// "<role>-gate" (compliance_battery.bb's own gate-<role> functions all
// follow this convention - see complianceBatteryGate.ts) - reusing that
// naming to derive which roles a candidate was trialled for, rather than
// asking RoleTrialRunner to report roles a second way.

import { acquireAccess } from './acquire';
import {
  BatteryGate,
  ConfChangeSuggestion,
  ModelCandidate,
  RoleLeaderboard,
  RoleTrialRunner,
  ScoredCandidate,
  SecretStore,
  SignupSource,
} from './candidate';
import { DiscoverySource } from './discoverySource';
import { qualifyCandidate } from './qualify';
import { rankForRole } from './rank';
import { suggestConfChange } from './recommend';

export interface RunRecruiterDeps {
  discovery: DiscoverySource;
  signup: SignupSource;
  secretStore: SecretStore;
  trialRunner: RoleTrialRunner;
  battery: BatteryGate;
  currentModelByRole: Record<string, string>;
}

export interface RoleReport {
  role: string;
  leaderboard: RoleLeaderboard;
  suggestion: ConfChangeSuggestion | null;
}

export interface EscalatedCandidate {
  model: string;
  wall: string;
}

export interface RecruiterReport {
  roles: RoleReport[];
  escalated: EscalatedCandidate[];
}

function rolesTrialledFor(scored: ScoredCandidate): string[] {
  return scored.scorecard.entries.map((entry) => entry.competency.replace(/-gate$/, ''));
}

export async function runRecruiter(deps: RunRecruiterDeps): Promise<RecruiterReport> {
  const candidates: ModelCandidate[] = await deps.discovery.discover();

  const scoredCandidates: ScoredCandidate[] = [];
  const escalated: EscalatedCandidate[] = [];

  for (const candidate of candidates) {
    const acquireOutcome = await acquireAccess(candidate, { signup: deps.signup, secretStore: deps.secretStore });
    if (acquireOutcome.status === 'escalated') {
      escalated.push({ model: candidate.model, wall: acquireOutcome.wall });
      continue;
    }
    const qualifyOutcome = await qualifyCandidate(candidate, { trialRunner: deps.trialRunner, battery: deps.battery });
    scoredCandidates.push({ candidate, scorecard: qualifyOutcome.scorecard });
  }

  const roles = new Set<string>();
  for (const scored of scoredCandidates) {
    for (const role of rolesTrialledFor(scored)) {
      roles.add(role);
    }
  }

  const roleReports: RoleReport[] = [];
  for (const role of roles) {
    const candidatesForRole = scoredCandidates.filter((scored) => rolesTrialledFor(scored).includes(role));
    const currentModel = deps.currentModelByRole[role] ?? '';
    const leaderboard = rankForRole(role, candidatesForRole, currentModel);
    roleReports.push({ role, leaderboard, suggestion: suggestConfChange(leaderboard) });
  }

  return { roles: roleReports, escalated };
}
