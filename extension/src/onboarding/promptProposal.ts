import { ProposedPrompts, RepoSurveyFacts } from './contractTypes';

// BL-269: maps the SAME RepoSurveyFacts contractSurvey.ts's
// proposeContractFromSurvey uses into the target repo's own
// project.prompt/engineering.prompt content - populated from the survey,
// never targetBootstrap.ts's generic angle-bracket placeholder template
// ("Initialize Target"'s own scaffold). Mirrors that file's section
// headers (# Project / # Goals for this swarm run / # Constraints and
// # Tech Stack / # Conventions / # Architecture rules) so this is a
// drop-in upgrade of the same file shape, just filled in instead of blank.
// Pure, fixture-testable - the survey itself is swarm/agent behavior,
// exercised at QA's e2e level, identical boundary to BL-262.
export function proposePromptsFromSurvey(facts: RepoSurveyFacts): ProposedPrompts {
  const languageList = facts.languages.length > 0 ? facts.languages.join(', ') : 'the surveyed';

  const projectPrompt = [
    '# Project',
    facts.seedVision,
    '',
    '# Goals for this swarm run',
    facts.initialBacklogSummary,
    '',
    '# Constraints',
    `Work within the existing ${languageList} codebase (layout: ${facts.layoutSummary}).`,
    '',
  ].join('\n');

  const engineeringPrompt = [
    '# Tech Stack',
    languageList,
    '',
    '# Conventions',
    facts.layoutSummary,
    '',
    '# Architecture rules',
    facts.readmeSummary,
    '',
  ].join('\n');

  return { projectPrompt, engineeringPrompt };
}
