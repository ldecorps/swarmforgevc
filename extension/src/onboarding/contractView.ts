import * as yaml from 'js-yaml';
import { CONTRACT_AGREEMENT_STATES, ContractAgreementState, ProposedContract } from './contractTypes';

function isContractAgreementState(value: unknown): value is ContractAgreementState {
  return typeof value === 'string' && (CONTRACT_AGREEMENT_STATES as readonly string[]).includes(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

// BL-262: strict parse - unlike backlogReader.ts's parseBacklogYaml (which
// falls back to a lenient regex extractor for free-form ticket prose), a
// contract that fails to parse as well-shaped YAML is genuinely MALFORMED
// and must fail closed (returns null), never a best-effort guess.
export function parseContractYaml(raw: string): ProposedContract | null {
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    !isStringArray(candidate.scope) ||
    !isStringArray(candidate.outOfScope) ||
    !isStringArray(candidate.boundaries) ||
    typeof candidate.initialBacklogSummary !== 'string' ||
    !isContractAgreementState(candidate.agreement)
  ) {
    return null;
  }

  return {
    scope: candidate.scope,
    outOfScope: candidate.outOfScope,
    boundaries: candidate.boundaries,
    initialBacklogSummary: candidate.initialBacklogSummary,
    agreement: candidate.agreement,
  };
}

// dump-then-load round-trips byte-for-byte through js-yaml's own canonical
// formatting, so the structured source and the legible view below can never
// silently diverge from what parseContractYaml actually reads back.
export function renderContractYaml(contract: ProposedContract): string {
  return yaml.dump(contract, { lineWidth: -1 });
}

function renderBulletList(entries: string[]): string {
  return entries.map((entry) => `- ${entry}`).join('\n');
}

// BL-262 legible-view-mirrors-source-03: shows the SAME scope and agreement
// state as the structured source, so the hybrid artifact's two halves never
// diverge.
export function generateContractMarkdown(contract: ProposedContract): string {
  return [
    '# SwarmForge Onboarding Contract',
    '',
    `Agreement: ${contract.agreement}`,
    '',
    '## Scope',
    renderBulletList(contract.scope),
    '',
    '## Out of scope',
    renderBulletList(contract.outOfScope),
    '',
    '## Boundaries',
    renderBulletList(contract.boundaries),
    '',
    '## Initial backlog',
    contract.initialBacklogSummary,
    '',
    '---',
    'This contract firms the overall mandate for the swarm working on this repo.',
    'It sits above the per-ticket approval gate on each individual feature draft —',
    'it does not replace it. To change scope, flip `agreement` back to `pending`',
    'in `.swarmforge/contract.yaml` and re-negotiate.',
    '',
  ].join('\n');
}
