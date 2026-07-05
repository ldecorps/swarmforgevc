#!/usr/bin/env node
/**
 * BL-071: agent-callable swarm-metrics CLI.
 *
 * Usage: node swarm-metrics.js
 *
 * Runnable from the repo root or any .worktrees/<role>/ checkout - anchors
 * path resolution at the git worktree/repo root (BL-056 lesson), not raw
 * cwd. Read-only, headless: no VS Code required. Prints a short plain-text
 * overview fed by the SAME computation module the panel uses
 * (metrics/swarmMetrics.ts) - this file is a thin presenter, not a second
 * metrics implementation.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { parseRolesTsv, RoleEntry } from '../swarm/swarmState';
import { loadRuns } from '../runs/runLog';
import {
  computeSwarmMetrics,
  formatDurationMs,
  formatSuiteDurationMs,
  NO_SAMPLE_PLACEHOLDER,
  SwarmMetrics,
} from '../metrics/swarmMetrics';

export function hasRolesTsv(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.swarmforge', 'roles.tsv'));
}

function getGitRoot(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function getGitCommonDir(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function resolveProjectRoot(cwd: string): string {
  const gitRoot = getGitRoot(cwd);
  if (gitRoot && hasRolesTsv(gitRoot)) {
    return gitRoot;
  }

  const commonDir = getGitCommonDir(cwd);
  if (commonDir) {
    const candidate = path.dirname(path.resolve(cwd, commonDir));
    if (hasRolesTsv(candidate)) {
      return candidate;
    }
  }

  throw new Error('Cannot resolve SwarmForge project root: no .swarmforge/roles.tsv found via git worktree/repo root.');
}

// Git history for backlog/ is shared across all worktrees, but the panel and
// the CLI must agree on ONE checkout to read active/done state from (BL-071
// scenario-08); other worktrees' backlog/ trees are whatever they last
// merged from main and may be stale. The specifier's (or, absent that, the
// coordinator's) worktree is the master checkout by swarmforge.conf's own
// convention.
export function resolveMainWorktreePath(projectRoot: string, roles: RoleEntry[]): string {
  const specifier = roles.find((r) => r.role === 'specifier') ?? roles.find((r) => r.role === 'coordinator');
  return specifier ? specifier.worktreePath : projectRoot;
}

export function formatOverview(metrics: SwarmMetrics, roleNames: string[]): string {
  const meanLine =
    metrics.meanTicketTimeMs === null
      ? `Mean ticket time: ${NO_SAMPLE_PLACEHOLDER} (0 tickets)`
      : `Mean ticket time: ${formatDurationMs(metrics.meanTicketTimeMs)} over ${metrics.ticketSampleCount} ticket(s)`;

  const busynessLine =
    'Busyness: ' + roleNames.map((role) => `${role} ${Math.round((metrics.busyness[role] ?? 0) * 100)}%`).join(', ');

  const worst = Object.entries(metrics.retryByTicket)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const worstText = worst.length > 0 ? ` (worst: ${worst.map(([id, count]) => `${id} x${count}`).join(', ')})` : '';
  const retryLine = `Retries: ${metrics.retryTotal} total${worstText}`;

  const suite = metrics.suiteDuration;
  const suiteLine =
    suite.latestMs === null
      ? `Suite duration: ${NO_SAMPLE_PLACEHOLDER} (0 runs)`
      : `${suite.warn ? 'WARN ' : ''}Suite duration: ${formatSuiteDurationMs(suite.latestMs)}` +
        ` (mean ${formatSuiteDurationMs(suite.meanMs as number)} over ${suite.sampleCount} run(s))`;

  return [meanLine, busynessLine, retryLine, suiteLine].join('\n');
}

export function main(): void {
  const projectRoot = resolveProjectRoot(process.cwd());
  const rolesTsv = fs.readFileSync(path.join(projectRoot, '.swarmforge', 'roles.tsv'), 'utf8');
  const roles = parseRolesTsv(rolesTsv);
  const mainWorktreePath = resolveMainWorktreePath(projectRoot, roles);

  const runLogPath = path.join(os.homedir(), '.swarmforge', 'runs.jsonl');
  const runs = loadRuns(runLogPath).filter((r) => r.targetPath === mainWorktreePath);
  runs.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const runStartMs = runs.length > 0 ? Date.parse(runs[0].startedAt) : null;

  const metrics = computeSwarmMetrics(mainWorktreePath, roles, runStartMs);
  console.log(formatOverview(metrics, roles.map((r) => r.role)));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
