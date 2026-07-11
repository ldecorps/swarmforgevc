// BL-262 slice 1: the onboarding scope contract. A hybrid artifact git-tracked
// in the TARGET repo - .swarmforge/contract.yaml is the structured source the
// build-start gate parses; CONTRACT.md is a generated legible view for the
// target's humans. The agreement marker reuses the human_approval field
// PATTERN (see backlogReader.ts's VALID_HUMAN_APPROVALS) without depending on
// its code - this is its own field on its own artifact.
export const CONTRACT_AGREEMENT_STATES = ['agreed', 'proposed', 'pending'] as const;
export type ContractAgreementState = (typeof CONTRACT_AGREEMENT_STATES)[number];

export interface ProposedContract {
  scope: string[];
  outOfScope: string[];
  boundaries: string[];
  initialBacklogSummary: string;
  agreement: ContractAgreementState;
}

// Facts an agent gathers by reading the target repo (languages, layout,
// README) plus any seed vision and initial backlog - the SURVEY itself is
// swarm/agent behavior (exercised at QA's e2e level), never live I/O in a
// unit test. This type is the pure boundary: everything past this point is a
// deterministic function of already-gathered facts.
export interface RepoSurveyFacts {
  languages: string[];
  layoutSummary: string;
  readmeSummary: string;
  seedVision: string;
  initialBacklogSummary: string;
}

export type GateDecisionKind = 'allow' | 'hold';

export interface GateDecision {
  decision: GateDecisionKind;
  // Present on every 'hold' decision (BL-262 gate-decides-by-agreement-state-02:
  // "a held decision names the unagreed contract as the reason"); absent on 'allow'.
  reason?: string;
}
