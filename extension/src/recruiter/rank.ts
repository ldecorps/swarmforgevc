// BL-233 slice 4 (best-value-ranking-05): ranks already-qualified
// candidates (slice 3's own ScoredCandidate output) for one swarm role. A
// pure function over data already produced upstream - no battery
// invocation, no IO - matching "REUSE, don't reimplement: use BL-231's
// battery for compliance scoring," never a second scoring pass here.

import { RoleLeaderboard, RoleLeaderboardEntry, ScoredCandidate } from './candidate';

function capabilityOf(scored: ScoredCandidate): number {
  return scored.scorecard.entries.filter((entry) => entry.status === 'pass').length;
}

export function rankForRole(role: string, scoredCandidates: ScoredCandidate[], currentModel: string): RoleLeaderboard {
  const ranked: RoleLeaderboardEntry[] = scoredCandidates
    .filter((scored) => scored.scorecard.overall === 'swarm-compliant')
    .map((scored) => ({
      model: scored.candidate.model,
      capability: capabilityOf(scored),
      planCost: scored.candidate.planCost,
    }))
    .sort((a, b) => (b.capability !== a.capability ? b.capability - a.capability : a.planCost.amountUsd - b.planCost.amountUsd));

  return {
    role,
    reference: { model: currentModel },
    ranked,
    recommended: ranked.length > 0 ? ranked[0].model : null,
  };
}
