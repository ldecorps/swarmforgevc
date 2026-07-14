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

// BL-360: one capability the surveying agent found evidence of IN THE
// TARGET'S OWN CODE (never inferred from the README alone - that is the
// gap this ticket exists to close). `locations` names the place(s) in the
// target's code that implement it, so a human reading the inventory can
// go straight to the implementation. `name` is stable so a later change
// request can cite this entry by name (scenario 05).
export interface UseCaseObservation {
  name: string;
  summary: string;
  locations: string[];
}

// Facts an agent gathers by reading the target repo (languages, layout,
// README) plus any seed vision and initial backlog - the SURVEY itself is
// swarm/agent behavior (exercised at QA's e2e level), never live I/O in a
// unit test. This type is the pure boundary: everything past this point is a
// deterministic function of already-gathered facts.
//
// BL-360: useCaseObservations is raw, code-derived evidence gathered in
// the SAME survey pass as every other field here (one read of the target
// yields one internally-consistent fact set - a second, independent pass
// could drift). An empty array is a first-class, legitimate outcome (a
// target with no discernible use cases), never treated as "the field was
// omitted" - see deriveUseCaseInventory's own empty-case handling.
export interface RepoSurveyFacts {
  languages: string[];
  layoutSummary: string;
  readmeSummary: string;
  seedVision: string;
  initialBacklogSummary: string;
  useCaseObservations: UseCaseObservation[];
}

// BL-360: the derived, human-facing shape - today a direct carry-over of
// the raw observations (the derivation's real job is the empty-case
// handling in generateUseCaseInventoryMarkdown, and keeping this as its
// own named type/function pair, per proposeContractFromSurvey's own
// precedent, is what keeps a future, richer derivation from having to
// touch every caller of the raw facts).
export interface UseCaseInventoryEntry {
  name: string;
  summary: string;
  locations: string[];
}

export interface UseCaseInventory {
  entries: UseCaseInventoryEntry[];
}

// BL-269: the target repo's own project.prompt/engineering.prompt, generated
// from the SAME survey that proposes the contract - a sibling artifact that
// rides the contract's agreement marker (one agreement, whole artifact set):
// withheld from the target repo while proposed/pending, released for commit
// only once the contract is agreed.
export interface ProposedPrompts {
  projectPrompt: string;
  engineeringPrompt: string;
}

export type GateDecisionKind = 'allow' | 'hold';

export interface GateDecision {
  decision: GateDecisionKind;
  // Present on every 'hold' decision (BL-262 gate-decides-by-agreement-state-02:
  // "a held decision names the unagreed contract as the reason"); absent on 'allow'.
  reason?: string;
}
