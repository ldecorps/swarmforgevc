#!/usr/bin/env node
/**
 * BL-343: reports whether the dynamic-routing epic's per-role park/unpark
 * (BL-324) actually saves money - derived ONLY from REAL recorded park/
 * unpark cycles (role_lifecycle_cli.bb's own park-cycle-log.jsonl) and
 * each cycle's REAL transcript token usage. Zero real cycles is reported
 * honestly as "unmeasured", never guessed.
 *
 * Usage: node park-cycle-report.js
 *
 * Runnable from the repo root or any .worktrees/<role>/ checkout, same
 * project-root resolution as swarm-metrics.ts. Read-only, headless: no VS
 * Code required.
 */
import * as fs from 'fs';
import * as path from 'path';
import { readTranscriptUsage } from '../metrics/transcriptUsage';
import { computeRoutingBreakEvenReport, parseParkCycleLog, DEFAULT_COLD_START_WINDOW_MS } from '../metrics/parkCycleReport';
import { resolveProjectRoot, loadRoles, printJsonToStdout, runCliMain } from './swarm-metrics';

export function parkCycleLogPath(projectRoot: string): string {
  return path.join(projectRoot, '.swarmforge', 'role-lifecycle', 'park-cycle-log.jsonl');
}

export function main(): void {
  const projectRoot = resolveProjectRoot(process.cwd());
  const roles = loadRoles(projectRoot);
  const logPath = parkCycleLogPath(projectRoot);
  const content = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  const events = parseParkCycleLog(content);

  const roleWorktreePath = (role: string): string | null => roles.find((r) => r.role === role)?.worktreePath ?? null;

  const report = computeRoutingBreakEvenReport(
    events,
    (worktreePath) => readTranscriptUsage(worktreePath),
    roleWorktreePath,
    DEFAULT_COLD_START_WINDOW_MS
  );

  printJsonToStdout(report);
}

if (require.main === module) {
  runCliMain(main);
}
