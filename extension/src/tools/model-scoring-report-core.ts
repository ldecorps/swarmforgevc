/**
 * BL-1510: pure domain logic for the model-scoring report - parsing the
 * steward's role-matrix line shape, joining with the registry's certified
 * set, and rendering the markdown table. No IO, no CLI wiring: those live
 * in render-model-scoring-report.ts, which re-exports these symbols so
 * existing callers/tests keep importing from one place.
 */

// The steward's seven scored roles (operator directive, 2026-09-09). The
// coordinator is deliberately excluded - the steward does not track it as a
// role-matrix role at all.
export const SCORED_ROLES: readonly string[] = [
  'specifier',
  'coder',
  'cleaner',
  'architect',
  'hardender',
  'documenter',
  'QA',
];

export interface RoleMatrixLine {
  provider: string;
  model: string;
  score: string;
  evidence: string;
}

export interface RegistryEntry {
  provider: string;
  model: string;
  status: string;
  cost_class?: string;
}

// Parses the CLI's own line shape (verified 2026-09-10):
// `<provider>/<model> <score> <evidence>`. Evidence may itself contain
// spaces, so only the first two fields are fixed-width.
export function parseRoleMatrixLine(line: string): RoleMatrixLine | null {
  const match = line.match(/^(\S+)\/(\S+) (\S+) (.*)$/);
  if (!match) {
    return null;
  }
  const [, provider, model, score, evidence] = match;
  return { provider, model, score, evidence };
}

export interface ScoringReportRow {
  role: string;
  provider: string;
  model: string;
  score: string;
  plan: string;
  evidence: string;
  certified: boolean;
}

export interface ScoringReportDeps {
  runRoleMatrix: (role: string) => string[];
  readRegistry: () => RegistryEntry[];
  roles?: readonly string[];
}

export function buildScoringReportRows(deps: ScoringReportDeps): ScoringReportRow[] {
  const roles = deps.roles ?? SCORED_ROLES;
  const registryByKey = new Map(deps.readRegistry().map((entry) => [`${entry.provider}/${entry.model}`, entry]));
  const rows: ScoringReportRow[] = [];
  for (const role of roles) {
    for (const line of deps.runRoleMatrix(role)) {
      const parsed = parseRoleMatrixLine(line);
      if (!parsed) {
        continue;
      }
      const entry = registryByKey.get(`${parsed.provider}/${parsed.model}`);
      rows.push({
        role,
        provider: parsed.provider,
        model: parsed.model,
        score: parsed.score,
        plan: entry?.cost_class ?? '',
        evidence: parsed.evidence,
        certified: entry?.status === 'certified',
      });
    }
  }
  return rows;
}

const COORDINATOR_FOOTER =
  'The model steward does not track the coordinator as a role-matrix role.';

export function renderScoringReportMarkdown(rows: ScoringReportRow[]): string {
  const header = '| Role | Model | Score | Provider/plan | Evidence |\n|---|---|---|---|---|';
  const body = rows
    .map((row) => {
      const mark = row.certified ? '*' : '';
      return `| ${row.role} | ${mark}${row.provider}/${row.model} | ${row.score} | ${row.plan} | ${row.evidence} |`;
    })
    .join('\n');
  return `${header}\n${body}\n\n${COORDINATOR_FOOTER}\n`;
}

export function renderScoringReport(deps: ScoringReportDeps): string {
  return renderScoringReportMarkdown(buildScoringReportRows(deps));
}
