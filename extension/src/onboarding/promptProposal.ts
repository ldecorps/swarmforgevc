import { DEFAULT_VERBOSITY, ProposedPrompts, RepoSurveyFacts, VERBOSITY_LEVELS, Verbosity } from './contractTypes';

// BL-382: the negotiated verbosity term's own KNOWN_VALUES lookup -
// undefined means the contract never mentioned it at all (a pre-existing
// contract, scenario 03) and resolves to DEFAULT_VERBOSITY; any OTHER
// value not in VERBOSITY_LEVELS is refused outright (scenario 02), never
// silently coerced or passed through into a generated prompt.
export function resolveVerbosity(raw: string | undefined): Verbosity {
  if (raw === undefined) {
    return DEFAULT_VERBOSITY;
  }
  if (!(VERBOSITY_LEVELS as readonly string[]).includes(raw)) {
    throw new Error(`invalid contract verbosity "${raw}" - must be one of: ${VERBOSITY_LEVELS.join(', ')}`);
  }
  return raw as Verbosity;
}

function verbosityInstruction(verbosity: Verbosity): string {
  return `Be ${verbosity} in your responses and explanations.`;
}

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
// BL-382: rawVerbosity is the contract's own negotiated term (optional 2nd
// param so every pre-existing caller - the CLI, every earlier test - is
// unaffected and keeps defaulting to DEFAULT_VERBOSITY unchanged).
export function proposePromptsFromSurvey(facts: RepoSurveyFacts, rawVerbosity?: string): ProposedPrompts {
  const verbosity = resolveVerbosity(rawVerbosity);
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
    '# Verbosity',
    verbosityInstruction(verbosity),
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
    '# Verbosity',
    verbosityInstruction(verbosity),
    '',
  ].join('\n');

  return { projectPrompt, engineeringPrompt };
}
