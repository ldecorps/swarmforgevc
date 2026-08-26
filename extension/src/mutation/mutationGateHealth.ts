// BL-446: a completed mutation run's kill/survive counts are the mutation
// gate's own pass/fail signal - but "no survivors" reads identically whether
// every mutant was genuinely killed or Stryker's kill mechanism itself is
// broken and killed NOTHING (the incident this ticket fixes: 94 mutants, 0
// killed, while a plain `vitest run` caught the same mutations). This module
// classifies a run's counts so a zero-kill run is surfaced as suspect
// instead of silently read as a clean gate pass - root-cause-agnostic, so it
// guards against any future recurrence of the same failure mode, not just
// this one mechanism. Pure/testable, mirrors check-suite-file-budget.ts's
// and check-suite-duration-budget.ts's own decision-table shape.

export type MutationGateHealth = 'healthy' | 'zero-kill-suspect' | 'no-mutants';

export interface MutationGateHealthVerdict {
  health: MutationGateHealth;
  killed: number;
  survived: number;
}

// Pure: BL-446 mutation-gate-zero-kill-broken-01's whole decision table. ANY
// killed mutant proves the kill mechanism works, regardless of how many
// survived alongside it - survivors are a normal, expected hardening signal
// (something to fix), not a sign the TOOL is broken. Zero killed is only
// suspect when there were mutants to kill in the first place; zero-and-zero
// means the scope had nothing to mutate (e.g. a pure interface file), which
// is a legitimate, unremarkable outcome, not a broken gate.
export function classifyMutationGateHealth(killed: number, survived: number): MutationGateHealth {
  if (killed > 0) {
    return 'healthy';
  }
  return survived > 0 ? 'zero-kill-suspect' : 'no-mutants';
}

export function buildMutationGateHealthVerdict(killed: number, survived: number): MutationGateHealthVerdict {
  return { health: classifyMutationGateHealth(killed, survived), killed, survived };
}

// Names the run's counts alongside its health (BL-446
// mutation-gate-zero-kill-broken-02) - "suspect" alone sends the next reader
// back to the raw Stryker output to find out whether it was 0-of-1 or
// 0-of-94.
export function formatMutationGateHealthVerdict(verdict: MutationGateHealthVerdict): string {
  const counts = `${verdict.killed} killed / ${verdict.survived} survived`;
  switch (verdict.health) {
    case 'zero-kill-suspect':
      return `MUTATION GATE SUSPECT: ${counts} - Stryker killed nothing; this may be a broken kill mechanism, not a clean pass`;
    case 'no-mutants':
      return `mutation gate: no mutants to test (${counts})`;
    default:
      return `mutation gate healthy: ${counts}`;
  }
}
