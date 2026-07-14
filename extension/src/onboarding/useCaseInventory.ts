import { RepoSurveyFacts, UseCaseInventory } from './contractTypes';

// BL-360: derives the human-facing use-case inventory from the SAME
// RepoSurveyFacts contractSurvey.ts/promptProposal.ts already consume -
// a third derivation of one survey, never a second independent pass (see
// this ticket's own reasoning: two passes over a large target can drift,
// cost double the read, and the seam for "one facts record, N pure
// derivations" is already proven by the two siblings above). Pure and
// fixture-testable, no live repo required - the SURVEY itself (gathering
// useCaseObservations by reading the target's code) is swarm/agent
// behavior, exercised at QA's e2e level, the identical boundary
// RepoSurveyFacts already establishes for every other field.
export function deriveUseCaseInventory(facts: RepoSurveyFacts): UseCaseInventory {
  return {
    entries: facts.useCaseObservations.map((observation) => ({
      name: observation.name,
      summary: observation.summary,
      locations: observation.locations,
    })),
  };
}

function renderEntry(entry: UseCaseInventory['entries'][number]): string[] {
  return [
    `## ${entry.name}`,
    '',
    entry.summary,
    '',
    'Implemented in:',
    ...entry.locations.map((location) => `- ${location}`),
    '',
  ];
}

// BL-360 use-case-inventory-06: an empty inventory is a first-class
// outcome, not a blank document - the target's code genuinely supports no
// discernible use case, so the rendered file SAYS that plainly rather
// than silently omitting the section or (worse) never being written at
// all, which would read as "the survey never ran" instead of "the survey
// ran and found nothing".
export function generateUseCaseInventoryMarkdown(inventory: UseCaseInventory): string {
  if (inventory.entries.length === 0) {
    return [
      '# Use Cases',
      '',
      'No discernible use cases were found in this codebase.',
      '',
    ].join('\n');
  }

  return [
    '# Use Cases',
    '',
    'This inventory lists the capabilities this application supports today, derived',
    "from the target's own code. Cite an entry by its name when raising a change",
    'request against it.',
    '',
    ...inventory.entries.flatMap(renderEntry),
  ].join('\n');
}
