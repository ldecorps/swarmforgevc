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

// BL-233 slice 2 (auto-acquire-free-02 / acquire-wall-escalates-03): a
// candidate whose signupPath.automation isn't 'automatable' - the three
// wall kinds discovery can classify a candidate under.
export type WallAutomation = Exclude<SignupAutomation, 'automatable'>;

export type AcquireOutcome =
  | { model: string; status: 'acquired' }
  | { model: string; status: 'escalated'; wall: WallAutomation };

// Injectable seams (TESTABLE-boundary constraint): faked in unit tests, no
// real network/signup/secret writes there. signUp() resolves the raw API
// key; callers must hand it straight to a SecretStore and never surface it
// elsewhere (a printed report, a log, an outcome value) - see acquire.ts.
export interface SignupSource {
  signUp(candidate: ModelCandidate): Promise<string>;
}

export interface SecretStore {
  store(candidate: ModelCandidate, apiKey: string): Promise<void>;
}
