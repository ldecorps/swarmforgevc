#!/usr/bin/env node
/**
 * BL-445: the whole-suite sibling of check-suite-file-budget.ts's per-file
 * guard. That guard catches one file quietly becoming a wall-clock pole but
 * says nothing about the suite's own total - and the existing suite-duration
 * trend (swarmMetrics.ts's computeSuiteDuration, BL-078/BL-252) only reports
 * relative creep ("slower than before"), never draws a hard line at the
 * operator's 10-second target. This module classifies one recorded run
 * against that target and surfaces an over-budget run with its measured
 * duration, so a future regression cannot creep back silently.
 *
 * Surfaces rather than hard-fails by design (an architect-reviewed default,
 * BL-445): the recorded duration jitters under swarm load the way the per-file
 * guard's own 7s budget does not, and a hard fail at a 10000ms boundary would
 * flake on that jitter. The per-file guard stays the hard gate.
 *
 * Usage: node check-suite-duration-budget.js <duration-ms>
 */
import { runCliMain } from './swarm-metrics';

// The ONE named place for the whole-suite budget number - the operator's
// explicit "next absolute priority: bring the unit test suite below 10s".
export const SUITE_DURATION_BUDGET_MS = 10000;

export type SuiteBudgetVerdict = 'within-budget' | 'over-budget';

export interface SuiteBudgetResult {
  verdict: SuiteBudgetVerdict;
  durationMs: number;
  budgetMs: number;
}

// Pure: BL-445 unit-suite-below-10s-01's whole decision table. A run landing
// EXACTLY on the budget counts as over it (>=, not >) - the target is a
// guarantee of staying under, not of merely not exceeding it, so the
// boundary itself must not read as "within budget".
export function classifySuiteDuration(durationMs: number, budgetMs: number = SUITE_DURATION_BUDGET_MS): SuiteBudgetVerdict {
  return durationMs >= budgetMs ? 'over-budget' : 'within-budget';
}

export function buildSuiteBudgetVerdict(durationMs: number, budgetMs: number = SUITE_DURATION_BUDGET_MS): SuiteBudgetResult {
  return { verdict: classifySuiteDuration(durationMs, budgetMs), durationMs, budgetMs };
}

// Names the run as an offender with its measured duration (BL-445
// unit-suite-below-10s-02) - "over budget" alone sends the next reader back
// to .test-durations.jsonl to find out by how much.
export function formatSuiteBudgetVerdict(result: SuiteBudgetResult): string {
  const durationS = (result.durationMs / 1000).toFixed(1);
  const budgetS = (result.budgetMs / 1000).toFixed(1);
  return result.verdict === 'over-budget'
    ? `suite duration over budget: ${durationS}s exceeds the ${budgetS}s suite budget`
    : `suite duration OK: ${durationS}s within the ${budgetS}s suite budget`;
}

export function main(): void {
  const durationArg = process.argv[2];
  const durationMs = Number(durationArg);
  if (!durationArg || Number.isNaN(durationMs)) {
    process.stderr.write('Usage: node check-suite-duration-budget.js <duration-ms>\n');
    process.exitCode = 1;
    return;
  }
  console.log(formatSuiteBudgetVerdict(buildSuiteBudgetVerdict(durationMs)));
}

if (require.main === module) {
  runCliMain(main);
}
