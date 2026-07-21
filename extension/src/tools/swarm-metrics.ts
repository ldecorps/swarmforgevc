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
  RoleWorktree,
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

// BL-208: providerNames defaults to empty so a caller that hasn't derived a
// provider roster (or a target where no role carries an `agent`) omits the
// line entirely rather than printing an empty "By provider: ".
export function formatOverview(metrics: SwarmMetrics, roleNames: string[], providerNames: string[] = []): string {
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

  // BL-208 brand-agnostic-read-02: the same chaser telemetry, grouped by
  // provider brand instead of role - proves an operator reader can compare
  // providers (which brand is slower/failing/idling) via the one common
  // field, with no per-brand branch (this loop is identical for
  // claude/aider/grok/codex/copilot/mock).
  const lines = [meanLine, busynessLine, retryLine, suiteLine, chaserLine];
  if (providerNames.length > 0) {
    lines.push(
      'By provider: ' +
        providerNames
          .map((provider) => {
            const t = metrics.providerTelemetry?.[provider] ?? { chases: 0, nudges: 0, recentDailyRate: 0 };
            return `${provider} ${t.chases} chases/${t.nudges} nudges (${t.recentDailyRate.toFixed(2)}/day)`;
          })
          .join(', ')
    );
  }

  return lines.join('\n');
}

// BL-096: delivery metrics (velocity/burndown/cycle-time/forecasts) formatted
// the same "one line per metric" way formatOverview above already
// established, fed by the same computeDeliveryMetrics the bridge's /metrics
// endpoint calls (metrics-09: CLI and bridge report the same numbers).
// BL-102: exported so stage-dwell-report.ts's presenter reuses this same
// trend-suffix formatting instead of a second copy.
export function formatTrend(trend: TrendResult, unit: (v: number) => string): string {
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

// BL-228: reuses the SAME forecast computeForecasts already produces (no
// parallel ETA model) - forecasts.milestones already drives the per-ticket
// ETAs on the PWA board, this just surfaces the same p50/p85 per milestone
// on the burndown line too.
function milestoneEtaSuffix(forecasts: ForecastResult, milestone: string): string {
  const forecast = forecasts.milestones.find((m) => m.milestone === milestone);
  if (!forecast || !forecast.p50Iso) {
    return ' (no ETA yet)';
  }
  const p50 = formatDateOnly(forecast.p50Iso);
  return forecast.p85Iso ? ` (ETA ${p50}, p85 ${formatDateOnly(forecast.p85Iso)})` : ` (ETA ${p50})`;
}

// The overall "all remaining work" ETA: the latest projected completion
// (max p50) across every open ticket's own forecast - not a new model,
// just the max of the same per-ticket forecasts.tickets p50s.
function overallEtaText(forecasts: ForecastResult): string {
  const p50Dates = forecasts.tickets.map((t) => t.p50Iso).filter((d): d is string => d !== null);
  if (p50Dates.length === 0) {
    return 'no ETA yet';
  }
  return formatDateOnly(p50Dates.reduce((max, d) => (d > max ? d : max)));
}

function formatBurndownLine(burndown: MilestoneBurndownResult[], forecasts: ForecastResult): string {
  if (burndown.length === 0) {
    return `Burndown: ${NO_SAMPLE_PLACEHOLDER} (no milestones)`;
  }
  const perMilestone = burndown
    .map((b) => `${b.milestone} ${b.currentRemaining} remaining${milestoneEtaSuffix(forecasts, b.milestone)}`)
    .join(', ');
  return `Burndown: ${perMilestone} — overall ETA ${overallEtaText(forecasts)}`;
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

// BL-252: exported so both formatDeliveryOverview below and the dedicated
// suite-duration-line.ts CLI (the daily briefing's data source) share the
// SAME "latest + trend + WARN prefix" line - one formatter, one place the
// BL-078 warn signal turns into text, never a second copy that could drift.
export function formatSuiteDurationTrendLine(trend: SuiteDurationTrendResult): string {
  if (!trend.hasLocalData) {
    return 'Suite duration trend: no local data';
  }
  const latest = trend.dailySeries[trend.dailySeries.length - 1];
  const warnPrefix = trend.warn ? 'WARN ' : '';
  return `${warnPrefix}Suite duration trend: ${formatSuiteDurationMs(latest.value)} latest${formatTrend(trend.trend, formatSuiteDurationMs)}`;
}

export function formatDeliveryOverview(metrics: DeliveryMetrics): string {
  return [
    formatVelocityLine(metrics.velocity),
    formatBurndownLine(metrics.burndown, metrics.forecasts),
    formatCycleTimeLine(metrics.cycleTime),
    formatForecastsLine(metrics.forecasts),
    formatSuiteDurationTrendLine(metrics.suiteDurationTrend),
  ].join('\n');
}

// BL-100 cost-01/02/03/04/07: cost & resource telemetry, one summarized
// line per role (per-day/per-ticket detail is available via the bridge's
// /cost-telemetry endpoint - the CLI stays a compact overview, matching
// formatOverview's own "one line per role" busyness convention).
export function formatCostTelemetryLine(costTelemetry: Record<string, RoleCostTelemetry>, roleNames: string[]): string {
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

export function formatResourceTrendsLine(resourceTrends: Record<string, RoleResourceTrend>, roleNames: string[]): string {
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

export interface CliMainWorktreeContext {
  projectRoot: string;
  roles: RoleEntry[];
  roleWorktrees: RoleWorktree[];
  mainWorktreePath: string;
}

// Shared by every headless "generate <thing>.json from repo state" CLI
// under tools/ (swarm-metrics.ts, generate-backlog-dashboard.ts,
// generate-docs-tree.ts): resolve the project root, its roles, and the
// main (specifier/coordinator) worktree that git-derived data should be
// read from - the same three calls each of those tools' own main() would
// otherwise repeat inline (jscpd flagged that exact repetition once a
// second generator existed).
export function resolveCliMainWorktreeContext(): CliMainWorktreeContext {
  const projectRoot = resolveProjectRoot(process.cwd());
  const roles = loadRoles(projectRoot);
  const roleWorktrees = roles.map((r) => ({ role: r.role, worktreePath: r.worktreePath }));
  const mainWorktreePath = resolveMainWorktreePath(projectRoot, roles);
  return { projectRoot, roles, roleWorktrees, mainWorktreePath };
}

// Shared by the same "generate <thing>.json" CLIs: the payload is always
// printed as pretty-printed JSON, and ONLY the payload, so a GitHub Action
// can redirect stdout straight to a file.
export function printJsonToStdout(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function reportFatalAndExit(error: unknown): void {
  console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

// Shared `require.main === module` entrypoint boilerplate for tools/ CLIs:
// run main(), and on any thrown error (or, BL-118, a rejected promise for
// an async main - e.g. generate-docs-tree.js's translation pass) report it
// and exit non-zero rather than dumping a raw stack trace or an unhandled
// rejection. A synchronous main's own callers/tests are unaffected: main()
// still runs and any synchronous throw is still caught in the same tick,
// exactly as before this ticket.
export function runCliMain(main: () => void | Promise<void>): void {
  try {
    const result = main();
    if (result && typeof result.then === 'function') {
      result.catch(reportFatalAndExit);
    }
  } catch (error) {
    reportFatalAndExit(error);
  }
}

// Shared "parse positional args or print usage and exit 1" skeleton for
// tools/ CLIs that take several required args (recruiter-run.ts,
// bakeoff-run.ts) - jscpd flagged the identical guard block once a second
// CLI grew the same shape as the first. parseArgs stays each CLI's own
// (its return shape differs per tool); this only owns the shared
// "no args -> usage + exit 1, otherwise run the body" wrapper.
export function makeArgsGuardedMain<T>(
  parseArgs: (argv: string[]) => T | null,
  usage: string,
  run: (args: T) => Promise<void>
): () => Promise<void> {
  return async () => {
    const args = parseArgs(process.argv.slice(2));
    if (!args) {
      process.stderr.write(usage);
      process.exitCode = 1;
      return;
    }
    await run(args);
  };
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
  const providerNames = [...new Set(roles.map((r) => r.agent).filter((a): a is string => Boolean(a)))];
  console.log(formatOverview(metrics, roles.map((r) => r.role), providerNames));

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
