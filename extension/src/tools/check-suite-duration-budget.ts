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

// BL-1599: the whole-suite gate's wall-clock number jitters with host
// load (this module's own SUITE_DURATION_BUDGET_MS above, over budget
// since July, surfaces only - see the module doc). The specifier's
// delegated decision (2026-09-16, coordinator note 008676, recorded on
// BL-791): the line the gate REFUSES on is summed per-file WORK from the
// Vitest JSON report (extractFileDurations in check-suite-file-budget.ts),
// not wall, because work is fork-independent and stable across hosts
// (533.8s -> 546.1s across two hosts, two fork counts, 162 more files,
// while wall moved 689s -> 72s). The wall budget above stays a surfaced
// target, never refusing; this ratchet is the one that does.
export const SUITE_WORK_BUDGET_MS = 550000;
export const SUITE_WORK_TOLERANCE = 0.10;
// The operator's own ceiling (distinct from SUITE_DURATION_BUDGET_MS,
// the 10s architect-reviewed surfaced target above) - printed as a
// distance on every run, never itself a refusal boundary.
export const OPERATOR_WALL_CEILING_MS = 13000;

export type SuiteWorkVerdict = 'ok' | 'over-tolerance' | 'over-budget';

export interface SuiteWorkResult {
  verdict: SuiteWorkVerdict;
  workMs: number;
  forks: number;
  poleMs: number;
  budgetMs: number;
  tolerance: number;
  expectedWallMs: number;
  distanceMs: number;
}

// Pure: BL-1599 unit-suite-work-ratchet-01's whole decision table. At or
// under budget is ok; over budget but at or under budget*(1+tolerance) is
// over-tolerance (passes, prints the margin); above that refuses.
export function classifySuiteWork(
  workMs: number,
  budgetMs: number = SUITE_WORK_BUDGET_MS,
  tolerance: number = SUITE_WORK_TOLERANCE
): SuiteWorkVerdict {
  if (workMs <= budgetMs) return 'ok';
  return workMs <= budgetMs * (1 + tolerance) ? 'over-tolerance' : 'over-budget';
}

// Pure: the expected wall clock a WORK total would produce under a given
// fork pool - max(slowest single file, work spread evenly across forks),
// since no file can finish faster than its own duration regardless of how
// many forks run alongside it. An invalid fork count (0, negative, NaN)
// falls back to 1 rather than dividing by zero or returning NaN.
export function deriveExpectedWallMs(workMs: number, forks: number, poleMs: number): number {
  const f = Number.isFinite(forks) && forks > 0 ? forks : 1;
  return Math.max(poleMs, workMs / f);
}

export function buildSuiteWorkVerdict(
  workMs: number,
  forks: number,
  poleMs: number,
  budgetMs: number = SUITE_WORK_BUDGET_MS,
  tolerance: number = SUITE_WORK_TOLERANCE
): SuiteWorkResult {
  const expectedWallMs = deriveExpectedWallMs(workMs, forks, poleMs);
  return {
    verdict: classifySuiteWork(workMs, budgetMs, tolerance),
    workMs,
    forks,
    poleMs,
    budgetMs,
    tolerance,
    expectedWallMs,
    distanceMs: Math.max(0, expectedWallMs - OPERATOR_WALL_CEILING_MS),
  };
}

// BL-1983: half the host's logical cores - at or above this 5-minute load
// average, a measured run is unreliable (QA's BL-1958 gather read 613108ms
// of work at load ~15 on a 20-core host with every test green, then
// 391647ms 24 minutes later). Pure and load-independent itself (takes the
// load/cores as plain numbers), so BL-1599's own scenario stays
// deterministic - it never calls this.
export function isUnderHostLoad(loadAvg5: number, cores: number): boolean {
  return cores > 0 && loadAvg5 >= cores / 2;
}

export interface SuiteWorkExitDecision {
  exitCode: 0 | 1;
  unmeasuredUnderLoad: boolean;
}

// Pure: BL-1983's whole decision table, deliberately separate from
// classifySuiteWork/buildSuiteWorkVerdict above rather than folded into
// them, so a caller that never passes a load (every existing BL-1599 call
// site) gets EXACTLY BL-1599's own verdict and exit code - the ticket's
// declared invariant. Only an over-budget verdict measured under host
// load is ever skipped; ok and over-tolerance already exit 0 and are
// never marked.
export function decideSuiteWorkExit(verdict: SuiteWorkVerdict, loadAvg5: number, cores: number): SuiteWorkExitDecision {
  const unmeasuredUnderLoad = verdict === 'over-budget' && isUnderHostLoad(loadAvg5, cores);
  return { exitCode: verdict === 'over-budget' && !unmeasuredUnderLoad ? 1 : 0, unmeasuredUnderLoad };
}

// BL-1983 (hardener split, BL-956 differential complexity gate: inlining
// this into formatSuiteWorkVerdict took it from complexity 4 on main to 8,
// crossing CRAP's threshold at 100% coverage - extracted to bring the
// caller back to its own baseline; this helper's own complexity is 4). Pure
// label decision, isolated so the ternary chain below is independently
// testable and never grows with formatSuiteWorkVerdict's own string work.
function suiteWorkVerdictLabel(verdict: SuiteWorkVerdict, unmeasuredUnderLoad: boolean): string {
  if (unmeasuredUnderLoad) return 'unmeasured under host load';
  if (verdict === 'over-budget') return 'REFUSED';
  if (verdict === 'over-tolerance') return 'over tolerance';
  return 'ok';
}

// Prints every row a reader needs on every run (BL-1599): the work total
// against its budget, the fork count and slowest file that produced the
// derived wall, and the distance from that derived wall to the operator's
// 13s ceiling - so the operator sees on every run how far the poles keep
// the suite from it, whatever the fork count.
//
// BL-1983: loadAvg5/cores are optional so every existing call (BL-1599's
// own scenario, every pre-BL-1983 caller) prints exactly as before; passed,
// they re-derive the same decideSuiteWorkExit the exit code itself used -
// never a second, independently-drifting load check - and mark the line
// instead of calling it REFUSED when the skip applies.
export function formatSuiteWorkVerdict(r: SuiteWorkResult, loadAvg5?: number, cores?: number): string {
  const workS = (r.workMs / 1000).toFixed(1);
  const budgetS = (r.budgetMs / 1000).toFixed(1);
  const poleS = (r.poleMs / 1000).toFixed(1);
  const wallS = (r.expectedWallMs / 1000).toFixed(1);
  const distanceS = (r.distanceMs / 1000).toFixed(1);
  const ceilingS = (OPERATOR_WALL_CEILING_MS / 1000).toFixed(1);
  const unmeasuredUnderLoad =
    typeof loadAvg5 === 'number' && typeof cores === 'number' && decideSuiteWorkExit(r.verdict, loadAvg5, cores).unmeasuredUnderLoad;
  const label = suiteWorkVerdictLabel(r.verdict, unmeasuredUnderLoad);
  const loadSuffix = unmeasuredUnderLoad ? ` (5m load ${(loadAvg5 as number).toFixed(1)} >= half of ${cores} cores)` : '';
  return (
    `suite work ${label}: ${workS}s work (budget ${budgetS}s, ${r.forks} fork${r.forks === 1 ? '' : 's'}, slowest file ${poleS}s) ` +
    `-> expected wall ${wallS}s, ${distanceS}s from the ${ceilingS}s operator ceiling${loadSuffix}`
  );
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
