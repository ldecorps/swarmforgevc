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

// BL-233 slice 3 (qualify-via-battery-04): qualifying a candidate means
// driving it through a representative trial task for each swarm role, then
// scoring that trial's output with BL-231's swarm-compliance battery
// (swarmforge/scripts/compliance_battery.bb). gateArgs is deliberately a
// plain string array, not a typed per-role shape: the battery CLI's own
// `gate <role> <args...>` argument list already varies per role (coder
// takes a project dir + shell command, hardener takes complexity/coverage/
// mutants-survived, etc.) - RoleTrialRunner passes through whatever that
// role's gate needs, never re-deriving its own copy of that contract.
export interface RoleTrial {
  role: string;
  gateArgs: string[];
}

// Injectable seam (TESTABLE-boundary constraint): actually driving an
// arbitrary candidate model through a representative task per role is a
// separate, provider-specific undertaking with nothing in the ticket
// specifying it (same posture as acquire.ts's SignupSource - no real
// automation shipped here). Faked in unit tests.
export interface RoleTrialRunner {
  runTrials(candidate: ModelCandidate): Promise<RoleTrial[]>;
}

export interface BatteryEntry {
  competency: string;
  status: string;
  reason?: string;
}

export interface BatteryScorecard {
  model: string;
  entries: BatteryEntry[];
  overall: string;
}

// Wraps the REAL compliance_battery.bb CLI (see complianceBatteryGate.ts) -
// unlike RoleTrialRunner, this is genuinely real/safe to run in tests: the
// battery is already-existing, already-tested local infrastructure with no
// network or external signup involved (the same "real, not faked" posture
// discoverySource.ts's and secretStore.ts's own file I/O have).
export interface BatteryGate {
  gate(role: string, args: string[]): Promise<BatteryEntry>;
  scorecard(model: string, entries: BatteryEntry[]): Promise<BatteryScorecard>;
}

export interface QualifyOutcome {
  model: string;
  scorecard: BatteryScorecard;
}

// BL-233 slice 4 (best-value-ranking-05 / recommend-not-adopt-06): a
// candidate's qualify-slice output (candidate.ts:ModelCandidate + its
// BatteryScorecard), the input rankForRole ranks per role.
export interface ScoredCandidate {
  candidate: ModelCandidate;
  scorecard: BatteryScorecard;
}

// capability is a "pure-capability" number (operator's own wording,
// visible independent of the ranking/cost weighting) - the count of
// PASSING battery entries, reused directly from the scorecard slice 3
// already produced rather than inventing a second capability metric.
export interface RoleLeaderboardEntry {
  model: string;
  capability: number;
  planCost: PlanCost;
}

export interface RoleLeaderboard {
  role: string;
  reference: { model: string };
  ranked: RoleLeaderboardEntry[];
  recommended: string | null;
}

export interface ConfChangeSuggestion {
  role: string;
  suggestedModel: string;
  swarmforgeConfLine: string;
}
