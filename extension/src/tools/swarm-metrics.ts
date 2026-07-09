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
import {
  computeDeliveryMetrics,
  DeliveryMetrics,
  VelocityResult,
  MilestoneBurndownResult,
  CycleTimeResult,
  ForecastResult,
  SuiteDurationTrendResult,
} from '../metrics/deliveryMetrics';
import { TrendResult } from '../metrics/trend';
import { computeCostTelemetry, RoleCostTelemetry } from '../metrics/costTelemetry';
import { readResourceSampleEvents, computeResourceTrends, RoleResourceTrend } from '../metrics/resourceTelemetry';

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

  // BL-098: per-role chase/nudge counts, durably logged by the daemon's
  // chase-sweep (absent telemetry - e.g. these older fixtures, or a fresh
  // target - reads as an empty per-role bucket, never a crash).
  const chaserLine =
    'Chaser telemetry: ' +
    roleNames
      .map((role) => {
        const t = metrics.chaserTelemetry?.[role] ?? { chases: 0, nudges: 0, recentDailyRate: 0 };
        return `${role} ${t.chases} chases/${t.nudges} nudges (${t.recentDailyRate.toFixed(2)}/day)`;
      })
      .join(', ');

  return [meanLine, busynessLine, retryLine, suiteLine, chaserLine].join('\n');
}

// BL-096: delivery metrics (velocity/burndown/cycle-time/forecasts) formatted
// the same "one line per metric" way formatOverview above already
// established, fed by the same computeDeliveryMetrics the bridge's /metrics
// endpoint calls (metrics-09: CLI and bridge report the same numbers).
function formatTrend(trend: TrendResult, unit: (v: number) => string): string {
  if (trend.direction === 'unknown' || trend.delta === null) {
    return '';
  }
  const sign = trend.direction === 'up' ? '+' : trend.direction === 'down' ? '-' : '±';
  return ` (${sign}${unit(Math.abs(trend.delta))} vs prior)`;
}

function formatVelocityLine(velocity: VelocityResult): string {
  const trendText = formatTrend(velocity.trend, (v) => `${v}`);
  return `Velocity: ${velocity.rollingWindowCount} closed in trailing ${velocity.rollingWindowDays}d${trendText}`;
}

function formatBurndownLine(burndown: MilestoneBurndownResult[]): string {
  if (burndown.length === 0) {
    return `Burndown: ${NO_SAMPLE_PLACEHOLDER} (no milestones)`;
  }
  return 'Burndown: ' + burndown.map((b) => `${b.milestone} ${b.currentRemaining} remaining`).join(', ');
}

function formatCycleTimeLine(cycleTime: CycleTimeResult): string {
  if (cycleTime.medianMs === null) {
    return `Cycle time: ${NO_SAMPLE_PLACEHOLDER} (0 closed)`;
  }
  return (
    `Cycle time: median ${formatDurationMs(cycleTime.medianMs)}, ` +
    `p85 ${formatDurationMs(cycleTime.p85Ms as number)} over ${cycleTime.sampleCount} ticket(s)`
  );
}

function formatDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function formatForecastsLine(forecasts: ForecastResult): string {
  if (forecasts.milestones.length === 0) {
    return `Forecasts: ${NO_SAMPLE_PLACEHOLDER} (no open milestone tickets)`;
  }
  return (
    'Forecasts: ' +
    forecasts.milestones
      .map(
        (m) =>
          `${m.milestone} p50 ${m.p50Iso ? formatDateOnly(m.p50Iso) : NO_SAMPLE_PLACEHOLDER} / ` +
          `p85 ${m.p85Iso ? formatDateOnly(m.p85Iso) : NO_SAMPLE_PLACEHOLDER}`
      )
      .join(', ')
  );
}

function formatSuiteDurationTrendLine(trend: SuiteDurationTrendResult): string {
  if (!trend.hasLocalData) {
    return 'Suite duration trend: no local data';
  }
  const latest = trend.dailySeries[trend.dailySeries.length - 1];
  return `Suite duration trend: ${formatSuiteDurationMs(latest.value)} latest${formatTrend(trend.trend, formatSuiteDurationMs)}`;
}

export function formatDeliveryOverview(metrics: DeliveryMetrics): string {
  return [
    formatVelocityLine(metrics.velocity),
    formatBurndownLine(metrics.burndown),
    formatCycleTimeLine(metrics.cycleTime),
    formatForecastsLine(metrics.forecasts),
    formatSuiteDurationTrendLine(metrics.suiteDurationTrend),
  ].join('\n');
}

// BL-100 cost-01/02/03/04/07: cost & resource telemetry, one summarized
// line per role (per-day/per-ticket detail is available via the bridge's
// /cost-telemetry endpoint - the CLI stays a compact overview, matching
// formatOverview's own "one line per role" busyness convention).
function formatCostTelemetryLine(costTelemetry: Record<string, RoleCostTelemetry>, roleNames: string[]): string {
  const parts = roleNames.map((role) => {
    const roleTelemetry = costTelemetry[role];
    const days = roleTelemetry ? Object.values(roleTelemetry.byDay) : [];
    if (days.length === 0) {
      return `${role} ${NO_SAMPLE_PLACEHOLDER}`;
    }
    const totalTokens = days.reduce((sum, d) => sum + d.usage.inputTokens + d.usage.outputTokens, 0);
    const totalCost = days.reduce((sum, d) => sum + (d.costUsd ?? 0), 0);
    return `${role} ${totalTokens} tok / $${totalCost.toFixed(2)}`;
  });
  return 'Cost telemetry: ' + parts.join(', ');
}

function formatResourceTrendsLine(resourceTrends: Record<string, RoleResourceTrend>, roleNames: string[]): string {
  const parts = roleNames.map((role) => {
    const trend = resourceTrends[role];
    if (!trend || trend.currentRssBytes === null || trend.currentCpuPercent === null) {
      return `${role} ${NO_SAMPLE_PLACEHOLDER}`;
    }
    const rssMb = Math.round(trend.currentRssBytes / (1024 * 1024));
    return `${role} ${rssMb}MB / ${trend.currentCpuPercent.toFixed(1)}% cpu`;
  });
  return 'Resource usage: ' + parts.join(', ');
}

// Shared by every headless CLI tool under tools/ that keys off roles.tsv
// (swarm-metrics.ts, list-dead-letters.ts): read and parse the current
// project's roles.tsv from its resolved root.
export function loadRoles(projectRoot: string): RoleEntry[] {
  const rolesTsv = fs.readFileSync(path.join(projectRoot, '.swarmforge', 'roles.tsv'), 'utf8');
  return parseRolesTsv(rolesTsv);
}

// Shared `require.main === module` entrypoint boilerplate for tools/ CLIs:
// run main(), and on any thrown error report it and exit non-zero rather
// than dumping a raw stack trace.
export function runCliMain(main: () => void): void {
  try {
    main();
  } catch (error) {
    console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export function main(): void {
  const projectRoot = resolveProjectRoot(process.cwd());
  const roles = loadRoles(projectRoot);
  const mainWorktreePath = resolveMainWorktreePath(projectRoot, roles);

  const runLogPath = path.join(os.homedir(), '.swarmforge', 'runs.jsonl');
  const runs = loadRuns(runLogPath).filter((r) => r.targetPath === mainWorktreePath);
  runs.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const runStartMs = runs.length > 0 ? Date.parse(runs[0].startedAt) : null;

  const metrics = computeSwarmMetrics(mainWorktreePath, roles, runStartMs);
  console.log(formatOverview(metrics, roles.map((r) => r.role)));

  const roleWorktrees = roles.map((r) => ({ role: r.role, worktreePath: r.worktreePath }));
  const deliveryMetrics = computeDeliveryMetrics(mainWorktreePath, roleWorktrees);
  console.log(formatDeliveryOverview(deliveryMetrics));

  const costTelemetry = computeCostTelemetry(mainWorktreePath, roleWorktrees);
  const resourceTrends = computeResourceTrends(readResourceSampleEvents(mainWorktreePath), roles.map((r) => r.role), Date.now());
  console.log(formatCostTelemetryLine(costTelemetry, roles.map((r) => r.role)));
  console.log(formatResourceTrendsLine(resourceTrends, roles.map((r) => r.role)));
}

if (require.main === module) {
  runCliMain(main);
}
