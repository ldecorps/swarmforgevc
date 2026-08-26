import { ProposedContract, RepoSurveyFacts } from './contractTypes';

// BL-262 survey-proposes-populated-contract-01: maps already-gathered survey
// facts into a proposed contract whose scope/out-of-scope/boundaries are
// POPULATED FROM THE SURVEY, never a blank placeholder - a pure function so
// it is testable with a fixture RepoSurveyFacts, no live repo required.
export function proposeContractFromSurvey(facts: RepoSurveyFacts): ProposedContract {
  const languageList = facts.languages.length > 0 ? facts.languages.join(', ') : 'the surveyed';

  return {
    scope: [
      `Deliver the seed vision: ${facts.seedVision}`,
      `Work within the existing ${languageList} codebase (layout: ${facts.layoutSummary}).`,
    ],
    outOfScope: [
      `Rewriting or replacing the existing ${languageList} stack.`,
      `Changes outside the surveyed layout (${facts.layoutSummary}) unless the initial backlog explicitly calls for them.`,
    ],
    boundaries: [
      `Constraints stated in the target's README: ${facts.readmeSummary}`,
      'Every feature still passes through its own per-ticket human_approval gate; this contract sets the overall mandate, not per-ticket sign-off.',
    ],
    initialBacklogSummary: facts.initialBacklogSummary,
    agreement: 'proposed',
  };
}
