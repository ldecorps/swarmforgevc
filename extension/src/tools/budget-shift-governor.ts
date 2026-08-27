#!/usr/bin/env node
/**
 * BL-666: CLI for shift-boundary governor verdict (shift_schedule_applier_lib host).
 */
import { readUsageAnchors } from '../metrics/usageAnchorStore';
import {
  DEFAULT_BUDGET_GOVERNOR_CONFIG,
  isAnchorStale,
  runBudgetShiftGovernor,
} from '../metrics/budgetShiftGovernor';
import { parseWeekResetConfig, nextWeeklyResetMs, MS_PER_DAY } from '../metrics/burnProjection';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';
import * as fs from 'fs';
import * as path from 'path';

function readConf(targetPath: string): string {
  const confPath = path.join(targetPath, 'swarmforge', 'swarmforge.conf');
  try {
    return fs.readFileSync(confPath, 'utf8');
  } catch {
    return '';
  }
}

export function budgetShiftGovernorVerdict(targetPath: string, nowMs: number) {
  const anchors = readUsageAnchors(targetPath);
  const reset = parseWeekResetConfig(readConf(targetPath));
  const latest = anchors.length > 0 ? anchors[anchors.length - 1] : null;
  const nextReset = reset.config
    ? nextWeeklyResetMs(nowMs, reset.config.resetDay, reset.config.resetLocal)
    : nowMs + 7 * MS_PER_DAY;
  const daysToReset = (nextReset - nowMs) / MS_PER_DAY;
  const remaining = latest ? 100 - latest.pct : 50;
  const degraded = latest
    ? isAnchorStale(latest.atMs, nowMs, DEFAULT_BUDGET_GOVERNOR_CONFIG.staleAnchorThresholdMs)
    : true;
  const result = runBudgetShiftGovernor(DEFAULT_BUDGET_GOVERNOR_CONFIG, {
    remainingPercent: remaining,
    daysToReset,
    measuredBurnPercentPerDay: 10,
    affordableBurnPercentPerDay: remaining / Math.max(daysToReset, 0.1),
    degradedMode: degraded,
  });
  return { verdict: result.verdict, announcement: result.announcement, degraded: result.degraded };
}

function main() {
  const ctx = resolveCliMainWorktreeContext(process.argv.slice(2));
  if ('error' in ctx) {
    console.error(ctx.error);
    process.exit(1);
  }
  let nowMs = Date.now();
  const args = process.argv.slice(2);
  const nowIdx = args.indexOf('--now');
  if (nowIdx >= 0 && args[nowIdx + 1]) {
    nowMs = Number(args[nowIdx + 1]);
  }
  printJsonToStdout(budgetShiftGovernorVerdict(ctx.targetPath, nowMs));
}

runCliMain(main);
