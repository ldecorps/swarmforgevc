// BL-233: shared candidate/report shapes for the recruiter tool - kept
// separate from discovery/acquire/qualify/rank logic (as those slices land)
// so each can import just the shapes it needs.

export type SignupAutomation = 'automatable' | 'payment-wall' | 'captcha-wall' | 'manual-tos-wall';

export interface SignupPath {
  url: string;
  automation: SignupAutomation;
}

// A candidate's up-front PLAN cost (what it costs to get access at all) -
// distinct from extension/src/metrics/pricingTable.ts's ModelPricing, which
// prices per-token USAGE of an already-adopted model. The recruiter's
// best-value ranking (a later slice) weighs capability against this plan
// cost, not ongoing token spend.
export interface PlanCost {
  amountUsd: number;
  unit: 'free' | 'monthly';
}

export interface ModelCandidate {
  model: string;
  provider: string;
  planCost: PlanCost;
  signupPath: SignupPath;
}
