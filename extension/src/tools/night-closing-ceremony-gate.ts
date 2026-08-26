#!/usr/bin/env node
/**
 * BL-658: gate for handoffd.bb's briefing-generation sweep.
 * When closure_stop_local is a usable schedule, the independent morning
 * trigger must NOT fire — the ceremony owns briefing. When absent/ambiguous,
 * today's fixed-time trigger remains.
 *
 * Usage: node night-closing-ceremony-gate.js [--conf <path>] [--now <epoch-ms>]
 * Prints one JSON object to stdout.
 */
import * as fs from 'fs';
import {
  resolveClosureSchedule,
  resolveCeremonyBegin,
  defaultBudgets,
  shouldConsultFixedMorningTrigger,
  minutesOfDay,
  formatLocalTime,
} from '../quality/nightClosingCeremony';
import { localMinutesOfDay } from './cooldownWindowCore';
import { parseConfigValue } from '../util/swarmforgeConfig';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';

export function parseArgs(argv: string[]): { confPath: string | null; nowMs: number } {
  let confPath: string | null = null;
  let nowMs = Date.now();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--conf' && argv[i + 1] !== undefined) {
      confPath = argv[++i];
    } else if (argv[i] === '--now' && argv[i + 1] !== undefined) {
      nowMs = Number(argv[++i]);
    }
  }
  return { confPath, nowMs };
}

function readBudgets(conf: string) {
  const budgets = defaultBudgets();
  const drain = parseConfigValue(conf, 'closing_drain_budget_minutes');
  const briefing = parseConfigValue(conf, 'closing_briefing_budget_minutes');
  if (drain && /^\d+$/.test(drain)) {
    budgets.drainBudgetMinutes = Number(drain);
  }
  if (briefing && /^\d+$/.test(briefing)) {
    budgets.briefingBudgetMinutes = Number(briefing);
  }
  return budgets;
}

function inCeremonyWindow(nowMs: number, beginMin: number, closureMin: number): boolean {
  const now = localMinutesOfDay(nowMs);
  if (beginMin <= closureMin) {
    return now >= beginMin && now < closureMin;
  }
  return now >= beginMin || now < closureMin;
}

export function evaluateGate(confContent: string, nowMs: number) {
  const schedule = resolveClosureSchedule(confContent);
  const consultFixed = shouldConsultFixedMorningTrigger(schedule);
  if (schedule.state !== 'ok') {
    return {
      mode: 'fixed-time' as const,
      scheduleState: schedule.state,
      surfaced: schedule.surfaced,
      consultFixedMorningTrigger: consultFixed,
      ceremonyDue: false,
    };
  }
  const budgets = readBudgets(confContent);
  const begin = resolveCeremonyBegin(schedule.closure, budgets);
  const beginMin = minutesOfDay(begin);
  const closureMin = minutesOfDay(schedule.closure);
  const ceremonyDue = inCeremonyWindow(nowMs, beginMin, closureMin);
  return {
    mode: 'ceremony' as const,
    scheduleState: schedule.state,
    surfaced: schedule.surfaced,
    consultFixedMorningTrigger: false,
    ceremonyDue,
    ceremonyBeginLocal: formatLocalTime(begin),
    closureStopLocal: formatLocalTime(schedule.closure),
  };
}

export async function main(): Promise<void> {
  const { projectRoot } = resolveCliMainWorktreeContext();
  const { confPath, nowMs } = parseArgs(process.argv.slice(2));
  const path = confPath ?? `${projectRoot}/swarmforge/swarmforge.conf`;
  const confContent = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
  printJsonToStdout(evaluateGate(confContent, nowMs));
}

if (require.main === module) {
  runCliMain(main);
}
