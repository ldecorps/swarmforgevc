// BL-250 cost-tier-labeled-03 (bake-off, companion to BL-233): labels a
// candidate paid-only or free/eval-tier alongside its plan cost, for the
// report. Pure and additive - never modifies rank.ts/recommend.ts, both
// stay BL-233-unchanged per the ticket's "reuse the best-value ranker and
// report writer unchanged" scope.

import { ModelCandidate } from './candidate';

export interface CostTierLabel {
  model: string;
  costTier: NonNullable<ModelCandidate['costTier']>;
  planCost: ModelCandidate['planCost'];
}

export function labelCostTier(candidate: ModelCandidate): CostTierLabel {
  if (!candidate.costTier) {
    throw new Error(
      `candidate "${candidate.model}" has no cost tier - the roster source must set one before it reaches the report`
    );
  }
  return { model: candidate.model, costTier: candidate.costTier, planCost: candidate.planCost };
}
