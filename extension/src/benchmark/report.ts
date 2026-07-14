import { BenchmarkRanking, BenchmarkReport, ModelAggregate } from './types';

export const BENCHMARK_REPORT_SCHEMA_VERSION = 1;

export interface BuildBenchmarkReportParams {
  generatedAtIso: string;
  taskId: string;
  qualityThreshold: number;
  models: ModelAggregate[];
  ranking: BenchmarkRanking;
}

// Stated, not implied (acceptance scenario 04) - this string travels with
// the report itself rather than living only in a role prompt or ticket.
export function qualityThresholdDescription(threshold: number): string {
  return (
    `A model is "cheapest acceptable" only if its mean quality score - the fraction of the pinned ` +
    `task's own tests passing, averaged across its repeated runs - is >= ${threshold}.`
  );
}

const PROVENANCE_STATEMENT =
  'Each recorded run executes the configured provider CLI headlessly against a fresh copy of the pinned task ' +
  'fixture; quality is scored afterward by running the fixture\'s own test suite. Excluded models (see ' +
  'exclusionReason) never ran a trial.';

export function buildBenchmarkReport(params: BuildBenchmarkReportParams): BenchmarkReport {
  return {
    schemaVersion: BENCHMARK_REPORT_SCHEMA_VERSION,
    generatedAtIso: params.generatedAtIso,
    taskId: params.taskId,
    qualityThreshold: params.qualityThreshold,
    qualityThresholdDescription: qualityThresholdDescription(params.qualityThreshold),
    provenance: PROVENANCE_STATEMENT,
    models: params.models,
    ranking: params.ranking,
  };
}
