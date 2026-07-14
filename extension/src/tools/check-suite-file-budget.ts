#!/usr/bin/env node
/**
 * BL-378: guards against a single test file quietly becoming the suite's
 * next 10-second wall-clock pole. Wall clock is "slowest file + ~1s"
 * across the parallel worker pool, so ONE file breaching the budget costs
 * as much as every other file combined - and does so silently, since
 * every individual test inside it still passes (BL-078/BL-252's own
 * whole-suite trend cannot see this: it tells you the suite got slower,
 * never that one file did it). Reads Vitest's own JSON reporter output
 * (vitest run --reporter=json --outputFile=<path>) - per-file start/end
 * times are already emitted there, no second collection mechanism
 * needed. A per-TEST budget is deliberately out of scope: the unit of
 * parallelism is the FILE - a file of 200 fast tests is healthy; budgeting
 * individual tests would flag it for the wrong reason.
 *
 * Usage: node check-suite-file-budget.js <vitest-json-report-path>
 */
import * as fs from 'fs';
import { runCliMain } from './swarm-metrics';

// BL-378: the ONE named place for the budget number - never hardcoded or
// scattered across callers. Set from the real post-BL-375/376/377 profile
// (re-measured, not the ticket's own pre-fix estimate): the three fixed
// poles' now-real dependency-cruiser-engine tests peak around 4.2-4.8s,
// with an unrelated file (renderBriefingDiagramsCli.test.js) the current
// overall slowest at ~4.8s. 7s leaves honest headroom above that observed
// noise while still catching a file heading for the 10s this ticket
// exists to prevent.
export const PER_FILE_DURATION_BUDGET_MS = 7000;

export interface FileDuration {
  file: string;
  durationMs: number;
}

export interface BudgetOffender extends FileDuration {
  budgetMs: number;
}

export interface BudgetCheckResult {
  passed: boolean;
  offenders: BudgetOffender[];
}

// Vitest's own --reporter=json shape (Jest-compatible): testResults[] has
// one entry per FILE (not per test), each carrying startTime/endTime
// epoch ms - no separate top-level per-file duration field, so it is
// computed here.
export interface VitestJsonReport {
  testResults: Array<{ name: string; startTime: number; endTime: number }>;
}

export function extractFileDurations(report: VitestJsonReport): FileDuration[] {
  return report.testResults.map((r) => ({ file: r.name, durationMs: r.endTime - r.startTime }));
}

// Pure: the whole decision table (BL-378 scenarios 01-03) - one offender,
// none, or many. Every file over budget is reported, not just the first
// (scenario 03) - failing on the first would hide the others and turn
// one fix into N sequential rediscoveries.
export function checkFileDurationBudget(durations: FileDuration[], budgetMs: number): BudgetCheckResult {
  const offenders = durations.filter((d) => d.durationMs > budgetMs).map((d) => ({ ...d, budgetMs }));
  return { passed: offenders.length === 0, offenders };
}

// Names the offender, its duration, AND the budget it broke (scenario 01)
// - a report that says only "too slow" sends the next person back to
// re-profile from scratch, exactly the work this ticket exists to
// eliminate.
export function formatBudgetOffenders(offenders: BudgetOffender[]): string {
  return offenders
    .map((o) => `${o.file}: ${(o.durationMs / 1000).toFixed(1)}s exceeds the ${(o.budgetMs / 1000).toFixed(1)}s per-file budget`)
    .join('\n');
}

export function main(): void {
  const reportPath = process.argv[2];
  if (!reportPath) {
    process.stderr.write('Usage: node check-suite-file-budget.js <vitest-json-report-path>\n');
    process.exitCode = 1;
    return;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as VitestJsonReport;
  const durations = extractFileDurations(report);
  const result = checkFileDurationBudget(durations, PER_FILE_DURATION_BUDGET_MS);
  if (!result.passed) {
    process.stderr.write(`suite file budget exceeded (${result.offenders.length} offender(s)):\n${formatBudgetOffenders(result.offenders)}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`suite file budget OK: ${durations.length} files, all within ${(PER_FILE_DURATION_BUDGET_MS / 1000).toFixed(1)}s`);
}

if (require.main === module) {
  runCliMain(main);
}
