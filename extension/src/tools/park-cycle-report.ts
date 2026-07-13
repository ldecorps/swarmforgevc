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
import { RoleEntry } from '../swarm/swarmState';

export function parkCycleLogPath(projectRoot: string): string {
  return path.join(projectRoot, '.swarmforge', 'role-lifecycle', 'park-cycle-log.jsonl');
}

// Extracted so the lookup (and its "role not found" fallback) is unit-
// tested in-process rather than living only inside main(), where it would
// be exercised solely by a subprocess and read as 0%-covered, high-CRAP
// logic despite a passing smoke test (BL-233 CLI-entrypoint CRAP trap).
export function resolveRoleWorktreePath(roles: RoleEntry[], role: string): string | null {
  return roles.find((r) => r.role === role)?.worktreePath ?? null;
}

export function main(): void {
  const projectRoot = resolveProjectRoot(process.cwd());
  const roles = loadRoles(projectRoot);
  const logPath = parkCycleLogPath(projectRoot);
  const content = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  const events = parseParkCycleLog(content);

  const report = computeRoutingBreakEvenReport(
    events,
    (worktreePath) => readTranscriptUsage(worktreePath),
    (role) => resolveRoleWorktreePath(roles, role),
    DEFAULT_COLD_START_WINDOW_MS
  );

  printJsonToStdout(report);
}

if (require.main === module) {
  runCliMain(main);
}
