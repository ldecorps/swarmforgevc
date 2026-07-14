import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';
import { commitScopedFile } from '../util/gitCommitScopedFile';
import { BenchmarkReport } from './types';

// Mirrors notify/costHealthSidecar.ts's own committed-sidecar pattern
// exactly (BL-213/BL-272): a deterministic path under docs/, an atomic
// write, and a scoped commit that touches ONLY this file. This is the
// ticket's own scope item 6 - the ONE sanctioned way a benchmark run's
// numbers cross into git-derivable state so BL-347's leaderboard can read
// them.
export function benchmarkReportPath(targetPath: string, dateIso: string): string {
  return path.join(targetPath, 'docs', 'benchmarks', `${dateIso}.json`);
}

export function writeBenchmarkReport(targetPath: string, report: BenchmarkReport, dateIso: string): string {
  const filePath = benchmarkReportPath(targetPath, dateIso);
  atomicWrite(filePath, JSON.stringify(report, null, 2));
  return filePath;
}

export function commitBenchmarkReport(targetPath: string, filePath: string, taskId: string, dateIso: string): boolean {
  return commitScopedFile(targetPath, filePath, `Role benchmark report for ${taskId} (${dateIso})\n\nBy coder (BL-340 slice 1).`);
}
